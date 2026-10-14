#!/usr/bin/env python3
"""LOCAL ONLY activation races. Fictional fixture data retained; no reset/production access."""
import json,subprocess,time,uuid
DOCKER='/Applications/Docker.app/Contents/Resources/bin/docker'
CMD=[DOCKER,'exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','postgres']
def sql(q):
 p=subprocess.run(CMD,input=q,text=True,capture_output=True,timeout=30)
 assert p.returncode==0,p.stderr
 return p.stdout.strip()
assert subprocess.check_output([DOCKER,'inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],text=True).strip()=='pikas-4d6'
uid,person=str(uuid.uuid4()),str(uuid.uuid4())
sql(f"insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password) values('{uid}','authenticated','authenticated','local-4d8-race-op-{uid}@example.invalid',clock_timestamp(),'synthetic');insert into persons(id,auth_user_id,display_name) values('{person}','{uid}','Fictional Activation Race Operator');insert into pikas_private.platform_memberships(person_id,role_code) values('{person}','platform_admin');")
def claims(sid):return json.dumps({'sub':uid,'role':'authenticated','session_id':sid})
def initialize(sid):sql(f"insert into auth.sessions(id,user_id,created_at,updated_at) values('{sid}','{uid}',clock_timestamp(),clock_timestamp());set request.jwt.claims='{claims(sid)}';select public.pikas_session_start();")
def connection(sid):
 p=subprocess.Popen(CMD,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 p.stdin.write(f"begin;set local statement_timeout='20s';set local request.jwt.claims='{claims(sid)}';set local role authenticated;select 'READY:'||pg_backend_pid();\n");p.stdin.flush()
 for line in p.stdout:
  if line.startswith('READY:'):return p,int(line.split(':')[1])
 raise AssertionError(p.stderr.read())
def write(p,q):p.stdin.write(q+'\n');p.stdin.flush()
def finish(p):
 p.stdin.close();p.wait(timeout=25);return p.returncode,p.stdout.read(),p.stderr.read()
def blocked(b,a):
 for _ in range(100):
  if sql(f'select {a}=any(pg_blocking_pids({b}))')=='t':return
  time.sleep(.03)
 raise AssertionError('Actual blocking not observed')
for case in ['replacement_replacement','replacement_completion_pending','completion_replacement_ready','exact_completion_retry','session_timeout_wait']:
 sa,sb=str(uuid.uuid4()),str(uuid.uuid4());a=b=None
 try:
  initialize(sa);initialize(sb);prefix=f"set request.jwt.claims='{claims(sa)}';"
  digests={k:uuid.uuid4().hex+uuid.uuid4().hex for k in ['1','2','3']}
  tag=uuid.uuid4().hex[:12];email=f'local-4d8-race-{tag}@example.invalid'
  tenant=json.loads(sql(prefix+f"select public.platform_provision_tenant('{uuid.uuid4()}','RACE-ACT-{tag}','Fictional Activation Race','SCHOOL','Fictional School','America/Santo_Domingo','LOCATION','Fictional Location','CAFE','Fictional Cafe');"));account=tenant['account_id']
  intent=json.loads(sql(prefix+f"select public.platform_prepare_customer_admin('{uuid.uuid4()}','{account}','account',null,null,'account_admin','{email}',clock_timestamp()+interval '7 days');"))['intent_id']
  def reserve():return json.loads(sql(prefix+f"select public.platform_prepare_customer_activation('{intent}');"))['handle']
  original=reserve();target=str(uuid.uuid4())
  sql(f"insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data) select '{target}','authenticated','authenticated',email_key,clock_timestamp(),'baseline',jsonb_build_object('pikas_activation_owner',owner_key) from pikas_private.account_activation_flows where source_kind='initial_customer_admin' and source_handle='{intent}';")
  sql(prefix+f"select public.platform_bind_customer_activation('{intent}','{original}','{digests['1']}');")
  ha=reserve();hb=reserve();key=str(uuid.uuid4())
  bind=lambda h,d:f"select public.platform_bind_customer_activation('{intent}','{h}','{digests[d]}');"
  complete=f"select public.platform_complete_initial_customer_admin('{key}','{intent}','Fictional Admin');"
  if case in ['completion_replacement_ready','exact_completion_retry']:sql(f"update auth.users set encrypted_password='ready-password' where id='{target}';")
  a,ap=connection(sa)
  if case=='session_timeout_wait':write(a,f"reset role;select id from pikas_private.platform_customer_admin_intents where id='{intent}' for update;select 'HOLD';")
  else:write(a,(complete if case in ['completion_replacement_ready','exact_completion_retry'] else bind(ha,'2'))+"select 'HOLD';")
  first=None
  for line in a.stdout:
   if line.startswith('{'):first=json.loads(line)
   if line.strip()=='HOLD':break
  b,bp=connection(sb)
  operation=complete if case in ['replacement_completion_pending','exact_completion_retry'] else (f"select public.platform_prepare_customer_activation('{intent}');" if case=='completion_replacement_ready' else bind(hb,'3'))
  write(b,operation+'commit;');blocked(bp,ap)
  if case=='session_timeout_wait':sql(f"update pikas_private.application_sessions set started_at=clock_timestamp()-interval '1 hour',last_active_at=clock_timestamp()-interval '31 minutes' where session_id='{sb}';")
  write(a,'commit;');assert finish(a)[0]==0
  code,out,error=finish(b)
  if case=='exact_completion_retry':
   assert code==0,error
   second=next(json.loads(line) for line in out.splitlines() if line.startswith('{'));assert second==first
  else:
   expected={'replacement_replacement':'invitation_unavailable','replacement_completion_pending':'activation_password_pending','completion_replacement_ready':'pending_intent_required','session_timeout_wait':'application_session_expired'}[case]
   assert code!=0 and expected in error,error
  expected_grants='1' if case in ['completion_replacement_ready','exact_completion_retry'] else '0'
  assert sql(f"select count(*) from account_memberships where account_id='{account}' and role_code='account_admin'")==expected_grants
  assert sql(f"select count(*) from pikas_private.platform_requests where request_id='{key}'")==expected_grants
  if case=='replacement_replacement':assert sql(f"select count(*) from pikas_private.account_activation_invitations ai join pikas_private.account_activation_flows f on f.id=ai.flow_id where f.source_handle='{intent}' and ai.token_digest is not null and ai.revoked_at is null")=='1'
  if case=='session_timeout_wait':assert sql(f"select token_digest is null from pikas_private.account_activation_invitations where handle='{hb}'")=='t'
  print(f'PASS {case}: pg_blocking_pids({bp}) observed {ap}; loser/replay created no duplicate authority or journal')
 finally:
  for p in [a,b]:
   if p and p.poll() is None:p.kill();p.wait()
print('PASS 5/5 focused activation races; fictional local fixture rows retained')
