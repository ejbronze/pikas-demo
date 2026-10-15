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
for case in ['replacement','competing_completion','revoked_during_wait','source_expiry_wait','target_identity_wait']:
 u,p,a,s,l,c,sa,sb,target_auth=[uid() for _ in range(9)];tag=uuid.uuid4().hex[:10];da=uuid.uuid4().hex+uuid.uuid4().hex;db=uuid.uuid4().hex+uuid.uuid4().hex
 email=f'staff-race-target-{tag}@example.invalid'
 sql(f"insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password) values('{u}','authenticated','authenticated','staff-race-admin-{tag}@example.invalid',clock_timestamp(),'synthetic');insert into persons(id,auth_user_id,display_name) values('{p}','{u}','Fictional Staff Administrator');insert into accounts(id,code,name) values('{a}','STAFF-RACE-{tag}','Fictional Account');insert into schools(id,account_id,code,name) values('{s}','{a}','S','Fictional School');insert into school_locations(id,account_id,school_id,code,name) values('{l}','{a}','{s}','L','Fictional Location');insert into cafeterias(id,account_id,school_id,school_location_id,code,name) values('{c}','{a}','{s}','{l}','C','Fictional Cafe');insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code) values('{a}','{s}','{c}','{p}','cafeteria_admin');")
 for sid in [sa,sb]:sql(f"insert into auth.sessions(id,user_id,created_at,updated_at) values('{sid}','{u}',clock_timestamp(),clock_timestamp());set request.jwt.claims='{claims(u,sid)}';select pikas_session_start();")
 prefix=f"set request.jwt.claims='{claims(u,sa)}';"
 invitation=json.loads(sql(prefix+f"select cafeteria_admin_command('{c}','{uid()}','staff_prepare','{json.dumps({'email':email,'role':'pos_cashier'})}');"))['target_id']
 if case!='replacement':sql(f"insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password) values('{target_auth}','authenticated','authenticated','{email}',clock_timestamp(),'synthetic');")
 payload=json.dumps({'invitation_id':invitation,'display_name':'Fictional Cashier'});ka,kb=uid(),uid()
 def complete(key):return f"select cafeteria_admin_command('{c}','{key}','staff_complete','{payload}');"
 def issue():return f"select cafeteria_prepare_staff_activation('{invitation}');"
 if case=='replacement':
  first=json.loads(sql(prefix+issue()))['handle'];sql(f"insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data) select '{target_auth}','authenticated','authenticated',email_key,'baseline',jsonb_build_object('pikas_activation_owner',owner_key) from pikas_private.account_activation_flows where source_kind='cafeteria_staff' and source_handle='{invitation}';")
  second=json.loads(sql(prefix+issue()))['handle']
 x=y=None
 try:
  x,xpid=conn(u,sa,case in ['revoked_during_wait','source_expiry_wait','target_identity_wait']);y,ypid=conn(u,sb)
  if case=='replacement':acmd=f"select cafeteria_bind_staff_activation('{invitation}','{first}','{da}');";bcmd=f"select cafeteria_bind_staff_activation('{invitation}','{second}','{db}');"
  elif case=='competing_completion':acmd=complete(ka);bcmd=complete(kb)
  elif case=='revoked_during_wait':acmd=f"update cafeteria_memberships set status='suspended' where person_id='{p}' and cafeteria_id='{c}';";bcmd=issue()
  elif case=='source_expiry_wait':acmd=f"update invitations set expires_at=clock_timestamp()+interval '2 seconds' where id='{invitation}';";bcmd=issue()
  else:acmd=f"update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='{target_auth}';";bcmd=complete(kb)
  write(x,acmd+"select 'HELD';")
  held=False
  for line in x.stdout:
   if line.strip()=='HELD':held=True;break
  assert held,x.stderr.read()
  write(y,bcmd+'commit;');blocked(ypid,xpid)
  if case=='source_expiry_wait':time.sleep(2.1)
  write(x,'commit;');xc,xout,xerr=finish(x);assert xc==0,xerr
  yc,yout,yerr=finish(y);assert yc!=0,yout
  expected={'replacement':'invitation_unavailable','competing_completion':'pending_staff_invitation_required','revoked_during_wait':'cafeteria_authority_required','source_expiry_wait':'pending_intent_required','target_identity_wait':'confirmed_identity_pending'}[case];assert expected in yerr,yerr
  expected_count=1 if case=='competing_completion' else 0
  assert sql(f"select count(*) from cafeteria_memberships where cafeteria_id='{c}' and role_code='pos_cashier'")==str(expected_count)
  assert sql(f"select count(*) from pikas_private.cafeteria_admin_requests where request_id='{kb}'")=='0'
  if case=='replacement':assert sql(f"select count(*) from pikas_private.account_activation_invitations i join pikas_private.account_activation_flows f on f.id=i.flow_id where f.source_kind='cafeteria_staff' and f.source_handle='{invitation}' and token_digest is not null and revoked_at is null")=='1'
  print(f'PASS {case}: pg_blocking_pids({ypid}) observed {xpid}; loser left no membership/request')
 finally:
  for proc in [x,y]:
   if proc and proc.poll() is None:proc.kill();proc.wait()
print('PASS 5/5 focused staff activation races')
