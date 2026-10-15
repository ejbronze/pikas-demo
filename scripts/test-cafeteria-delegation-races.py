#!/usr/bin/env python3
"""LOCAL ONLY: independent sessions and observed blocking; fictional fixtures retained."""
import json,subprocess,time,uuid
D='/Applications/Docker.app/Contents/Resources/bin/docker'
C=[D,'exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']
def sql(q):
 r=subprocess.run(C,input=q,text=True,capture_output=True,timeout=30);assert r.returncode==0,r.stderr;return r.stdout.strip()
assert subprocess.check_output([D,'inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],text=True).strip()=='pikas-4d6'
def uid():return str(uuid.uuid4())
def claims(u,s):return json.dumps({'sub':u,'role':'authenticated','session_id':s})
def conn(u,s,privileged=False):
 p=subprocess.Popen(C,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 write(p,f"begin;set local statement_timeout='20s';set local request.jwt.claims='{claims(u,s)}';"+('' if privileged else 'set local role authenticated;')+"select 'READY:'||pg_backend_pid();")
 for line in p.stdout:
  if line.startswith('READY:'):return p,int(line.split(':')[1])
 raise AssertionError(p.stderr.read())
def write(p,q):p.stdin.write(q+'\n');p.stdin.flush()
def finish(p):p.stdin.close();p.wait(timeout=25);return p.returncode,p.stdout.read(),p.stderr.read()
def blocked(b,a):
 for _ in range(100):
  if sql(f'select {a}=any(pg_blocking_pids({b}))')=='t':return
  time.sleep(.03)
 raise AssertionError('No observed blocking')
for case in ['competing_grants','exact_replay','revoked_during_wait','timeout_during_wait','replacement']:
 u,p,a,s,l,c,sa,sb=[uid() for _ in range(8)];tag=uuid.uuid4().hex[:10];da=uuid.uuid4().hex+uuid.uuid4().hex;db=uuid.uuid4().hex+uuid.uuid4().hex
 sql(f"insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password) values('{u}','authenticated','authenticated','del-race-{tag}@example.invalid',clock_timestamp(),'synthetic');insert into persons(id,auth_user_id,display_name) values('{p}','{u}','Fictional Delegator');insert into accounts(id,code,name) values('{a}','DEL-RACE-{tag}','Fictional Account');insert into schools(id,account_id,code,name) values('{s}','{a}','S','Fictional School');insert into school_locations(id,account_id,school_id,code,name) values('{l}','{a}','{s}','L','Fictional Location');insert into cafeterias(id,account_id,school_id,school_location_id,code,name) values('{c}','{a}','{s}','{l}','C','Fictional Cafeteria');insert into account_memberships(account_id,person_id,role_code) values('{a}','{p}','account_admin');")
 for sid in [sa,sb]:sql(f"insert into auth.sessions(id,user_id,created_at,updated_at) values('{sid}','{u}',clock_timestamp(),clock_timestamp());set request.jwt.claims='{claims(u,sid)}';select pikas_session_start();")
 key=uid();payload=json.dumps({'cafeteria_id':c})
 def command(k):return f"select public.cafeteria_delegation_command('{s}','{c}','{k}','cafeteria_admin_self','{payload}');"
 x=y=None
 try:
  x,xpid=conn(u,sa,case=='revoked_during_wait');y,ypid=conn(u,sb)
  if case=='revoked_during_wait':write(x,f"update account_memberships set status='suspended' where person_id='{p}' and account_id='{a}';select 'HELD';")
  elif case=='replacement':
   prefix=f"set request.jwt.claims='{claims(u,sa)}';"
   inv=json.loads(sql(prefix+f"select cafeteria_delegation_command('{s}','{c}','{uid()}','cafeteria_admin_prepare','{json.dumps({'cafeteria_id':c,'email':f'del-new-{tag}@example.invalid'})}');"))['invitation_id']
   first=json.loads(sql(prefix+f"select cafeteria_prepare_admin_activation('{inv}');"))['handle']
   sql(f"insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data) select '{uid()}','authenticated','authenticated',email_key,'baseline',jsonb_build_object('pikas_activation_owner',owner_key) from pikas_private.account_activation_flows where source_handle='{inv}';")
   second=json.loads(sql(prefix+f"select cafeteria_prepare_admin_activation('{inv}');"))['handle']
   write(x,f"select cafeteria_bind_admin_activation('{inv}','{first}','{da}');select 'HELD';")
   bcmd=f"select cafeteria_bind_admin_activation('{inv}','{second}','{db}');"
  else:write(x,command(key)+"select 'HELD';")
  for line in x.stdout:
   if line.strip()=='HELD':break
  write(y,(bcmd if case=='replacement' else command(key if case=='exact_replay' else uid()))+'commit;')
  blocked(ypid,xpid)
  if case=='timeout_during_wait':sql(f"update pikas_private.application_sessions set started_at=clock_timestamp()-interval '2 hours',last_active_at=clock_timestamp()-interval '31 minutes' where session_id='{sb}';")
  write(x,'commit;');xc,xout,xerr=finish(x);assert xc==0,xerr
  yc,yout,yerr=finish(y)
  if case=='replacement':assert yc!=0 and 'invitation_unavailable' in yerr,yerr
  elif case in ['revoked_during_wait','timeout_during_wait']:
   assert yc!=0 and ('customer_account_admin_required' if case=='revoked_during_wait' else 'application_session_expired') in yerr,yerr
  else:assert yc==0,yerr
  expected=0 if case in ['revoked_during_wait','replacement'] else 1
  assert sql(f"select count(*) from cafeteria_memberships where cafeteria_id='{c}'")==str(expected)
  if case=='replacement':assert sql(f"select count(*) from pikas_private.account_activation_invitations i join pikas_private.account_activation_flows f on f.id=i.flow_id where f.source_handle='{inv}' and token_digest is not null and revoked_at is null")=='1'
  if case in ['revoked_during_wait','timeout_during_wait','exact_replay']:assert sql(f"select count(*) from pikas_private.school_admin_requests where school_id='{s}'")==str(expected)
  print(f'PASS {case}: pg_blocking_pids({ypid}) observed {xpid}; authority/journal checks passed')
 finally:
  for proc in [x,y]:
   if proc and proc.poll() is None:proc.kill();proc.wait()
print('PASS 5/5 focused delegation races')
