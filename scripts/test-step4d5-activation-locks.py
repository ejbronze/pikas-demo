#!/usr/bin/env python3
"""Only remediation state races, using independent local sessions and observed blocking."""
import importlib.util
from pathlib import Path
import time
import uuid
spec=importlib.util.spec_from_file_location('local_locks',Path(__file__).with_name('test-step4d4-team-locks.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
h.CONTAINER='supabase_db_pikas-activation'
h.CMD=[h.DOCKER,'exec','-i',h.CONTAINER,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','postgres']
def fixture():
 auth,person,flow,source=[str(uuid.uuid4()) for _ in range(4)]
 invitation=uuid.uuid4().hex;digest=uuid.uuid4().hex+uuid.uuid4().hex;marker=uuid.uuid4().hex+uuid.uuid4().hex
 email='activation-lock-'+uuid.uuid4().hex+'@example.invalid'
 h.run(f"insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data) values('{auth}','authenticated','authenticated','{email}',now(),'',jsonb_build_object('pikas_activation_owner','{marker}'));insert into public.persons(id,display_name) values('{person}','Synthetic intent creator');insert into pikas_private.platform_team_intents(handle,display_name,email_key,demo,created_by) values('{source.replace('-','')}','Synthetic','{email}',false,'{person}');insert into pikas_private.account_activation_flows(id,source_kind,source_handle,email_key,owner_key,auth_id,password_baseline) values('{flow}','platform_team','{source.replace('-','')}','{email}','{marker}','{auth}',encode(extensions.digest('','sha256'),'hex'));insert into pikas_private.account_activation_invitations(handle,flow_id,created_by,token_digest,expires_at) values('{invitation}','{flow}','{person}','{digest}',clock_timestamp()+interval '60 seconds');")
 return auth,flow,invitation,digest

def consume_case(expiry):
 auth,flow,invitation,digest=fixture();holder=first=second=None
 try:
  if expiry:h.run(f"update pikas_private.account_activation_invitations set expires_at=clock_timestamp()+interval '3 seconds' where handle='{invitation}';")
  holder,hp=h.connection(f"begin;select id from auth.users where id='{auth}' for update;")
  prefix=f"set request.jwt.claim.sub='{auth}';set role authenticated;";command=f"select public.activation_consume('{digest}');\n"
  first,fp=h.connection(prefix);first.stdin.write(command);first.stdin.flush();h.blocked(fp,hp)
  if expiry:
   deadline=time.monotonic()+8
   while h.run(f"select expires_at<=clock_timestamp() from pikas_private.account_activation_invitations where handle='{invitation}';")!='t':
    if time.monotonic()>deadline:raise AssertionError('Expiry timeout')
    time.sleep(.04)
  else:
   second,sp=h.connection(prefix);second.stdin.write(command);second.stdin.flush();h.blocked(sp,fp)
  assert h.finish(holder,'commit;')[0]==0
  code,_,error=h.finish(first)
  if expiry:assert code!=0 and '42501' in error,error
  else:
   assert code==0,error
   code,_,error=h.finish(second);assert code==0,error
  assert h.run(f"select count(*) from pikas_private.account_activation_events where invitation_handle='{invitation}' and action='activated';")==('0' if expiry else '1')
  assert h.run(f"select count(*) from public.persons where auth_user_id='{auth}';")=='0'
  print('PASS: '+('expiry during observed Auth lock wait fails closed' if expiry else 'concurrent recovery yields one transition/audit and zero authority'))
 finally:h.stop(holder,first,second)

def claim_case():
 auth,flow,invitation,digest=fixture();holder=first=second=None
 h.run(f"set request.jwt.claim.sub='{auth}';set role authenticated;select public.activation_consume('{digest}');")
 try:
  holder,hp=h.connection(f"begin;select id from pikas_private.account_activation_flows where id='{flow}' for update;")
  prefix=f"set request.jwt.claim.sub='{auth}';set role authenticated;"
  first,fp=h.connection(prefix);first.stdin.write(f"select public.activation_claim_password('{invitation}','{'a'*64}');\n");first.stdin.flush();h.blocked(fp,hp)
  second,sp=h.connection(prefix);second.stdin.write(f"select public.activation_claim_password('{invitation}','{'b'*64}');\n");second.stdin.flush();h.blocked(sp,fp)
  assert h.finish(holder,'commit;')[0]==0
  code,_,err=h.finish(first);assert code==0,err
  code,_,err=h.finish(second);assert code!=0 and '42501' in err,err
  assert h.run(f"select password_fingerprint from pikas_private.account_activation_flows where id='{flow}';")=='a'*64
  print('PASS: observed concurrent first-password claims preserve exactly one immutable payload')
 finally:h.stop(holder,first,second)

def ready_case():
 auth,flow,invitation,digest=fixture();holder=worker=None
 h.run(f"set request.jwt.claim.sub='{auth}';set role authenticated;select public.activation_consume('{digest}');")
 try:
  holder,hp=h.connection(f"begin;update auth.users set encrypted_password='synthetic-success' where id='{auth}';")
  worker,wp=h.connection(f"set request.jwt.claim.sub='{auth}';set role authenticated;")
  worker.stdin.write(f"select public.activation_consume('{digest}');\n");worker.stdin.flush();h.blocked(wp,hp)
  assert h.finish(holder,'commit;')[0]==0
  code,_,err=h.finish(worker);assert code!=0 and '42501' in err,err
  assert h.run(f"set request.jwt.claim.sub='{auth}';set role authenticated;select public.activation_password_status('{invitation}');")=='ready'
  assert h.run(f"select public.activation_preview('{digest}') is null;")=='t'
  assert h.run(f"select count(*) from public.persons where auth_user_id='{auth}';")=='0'
  print('PASS: committed Auth password closes a waiting recovery before finalize acknowledgement')
 finally:h.stop(holder,worker)

def reissue_case():
 auth,flow,invitation,digest=fixture();holder=consumer=binder=None
 admin=str(uuid.uuid4())
 person=h.run(f"select created_by from pikas_private.account_activation_invitations where handle='{invitation}';")
 source=h.run(f"select source_handle from pikas_private.account_activation_flows where id='{flow}';")
 h.run(f"insert into auth.users(id,aud,role,email,email_confirmed_at) values('{admin}','authenticated','authenticated','race-admin-{admin}@example.invalid',now());update public.persons set auth_user_id='{admin}' where id='{person}';insert into pikas_private.platform_memberships(person_id,role_code) values('{person}','platform_admin');")
 admin_prefix=f"set request.jwt.claim.sub='{admin}';set role authenticated;"
 new_inv=h.run(admin_prefix+f"select public.platform_prepare_activation('{source}')->>'handle';")
 new_digest=uuid.uuid4().hex+uuid.uuid4().hex
 try:
  holder,hp=h.connection(f"begin;select id from auth.users where id='{auth}' for update;")
  consumer,cp=h.connection(f"set request.jwt.claim.sub='{auth}';set role authenticated;")
  consumer.stdin.write(f"select public.activation_consume('{digest}');\n");consumer.stdin.flush();h.blocked(cp,hp)
  binder,bp=h.connection(admin_prefix)
  binder.stdin.write(f"select public.platform_bind_activation('{new_inv}','{new_digest}');\n");binder.stdin.flush();h.blocked(bp,cp)
  assert h.finish(holder,'commit;')[0]==0
  code,_,err=h.finish(consumer);assert code==0,err
  code,_,err=h.finish(binder);assert code==0,err
  assert h.run(f"select public.activation_preview('{digest}') is null;")=='t'
  assert h.run(f"select public.activation_preview('{new_digest}') is not null;")=='t'
  assert h.run(f"select count(*) from public.persons where auth_user_id='{auth}';")=='0'
  print('PASS: reissue waits for in-flight consumption then revokes the exact old credential')
 finally:h.stop(holder,consumer,binder)

def expiry_context_case(password_claim):
 auth,flow,invitation,digest=fixture();holder=worker=None
 if password_claim:h.run(f"set request.jwt.claim.sub='{auth}';set role authenticated;select public.activation_consume('{digest}');")
 h.run(f"update pikas_private.account_activation_invitations set expires_at=clock_timestamp()+interval '3 seconds' where handle='{invitation}';")
 try:
  holder,hp=h.connection(f"begin;select id from auth.users where id='{auth}' for update;")
  prefix=f"set request.jwt.claim.sub='{auth}';set role authenticated;" if password_claim else "set role service_role;"
  worker,wp=h.connection(prefix)
  sql=f"select public.activation_claim_password('{invitation}','{'a'*64}');" if password_claim else f"select public.activation_provider_context(null,'{digest}');"
  worker.stdin.write(sql+'\n');worker.stdin.flush();h.blocked(wp,hp)
  deadline=time.monotonic()+8
  while h.run(f"select expires_at<=clock_timestamp() from pikas_private.account_activation_invitations where handle='{invitation}';")!='t':
   if time.monotonic()>deadline:raise AssertionError('Expiry timeout')
   time.sleep(.04)
  assert h.finish(holder,'commit;')[0]==0
  code,_,err=h.finish(worker);assert code!=0 and '42501' in err,err
  print('PASS: '+('password claim' if password_claim else 'privileged provider context')+' revalidates expiry after observed Auth wait')
 finally:h.stop(holder,worker)

endpoint=h.os.environ.get('DOCKER_HOST') or h.subprocess.check_output([h.DOCKER,'context','inspect','--format','{{.Endpoints.docker.Host}}'],text=True).strip()
if endpoint not in {'unix:///var/run/docker.sock','unix://'+str(Path.home()/'.docker/run/docker.sock')}:raise RuntimeError('Non-local Docker refused')
label=h.subprocess.check_output([h.DOCKER,'inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}',h.CONTAINER],text=True).strip()
if label!='pikas-activation' or h.run('select max(version) from supabase_migrations.schema_migrations;')!='202610120001':raise RuntimeError('Wrong local project/migration')
consume_case(False);consume_case(True);claim_case();ready_case();reissue_case();expiry_context_case(False);expiry_context_case(True)
print('7 focused remediation races passed; reset local DB afterward.')
