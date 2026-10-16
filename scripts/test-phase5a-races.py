#!/usr/bin/env python3
"""LOCAL ONLY Phase 5A; independent sessions with pg_blocking_pids evidence.
Requires setup-step4d6-local.py. Leaves synthetic sessions; no remote target option.
"""
import json, os, subprocess, time, uuid
from pathlib import Path
D='/Applications/Docker.app/Contents/Resources/bin/docker'
CONTAINER='supabase_db_pikas-4d6'
C=[D,'exec','-i',CONTAINER,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','postgres']
CA='00000000-0000-0000-0000-000000000111'
REG='00000000-0000-0000-0000-000000009401'
ASSIGN='00000000-0000-0000-0000-000000009501'
ADMIN='00000000-0000-0000-0000-000000002003'
CASHIER='00000000-0000-0000-0000-000000002008'
def sql(q):
 r=subprocess.run(C,input=q,text=True,capture_output=True,timeout=35)
 assert r.returncode==0,r.stderr
 return r.stdout.strip()
def auth(a):return f"set request.jwt.claim.sub='{a}';set role authenticated;"
def connection(a=None):
 p=subprocess.Popen(C,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 write(p,"begin;set local statement_timeout='25s';"+(auth(a) if a else '')+"select 'READY:'||pg_backend_pid();")
 for line in p.stdout:
  if line.startswith('READY:'):return p,int(line.split(':')[1])
 raise AssertionError(p.stderr.read())
def write(p,q):p.stdin.write(q+'\n');p.stdin.flush()
def marker(p):
 for line in p.stdout:
  if line.strip()=='HELD':return
 raise AssertionError(p.stderr.read())
def finish(p):
 out,err=p.communicate(timeout=30);return p.returncode,out,err

def blocked(worker,holder):
 end=time.monotonic()+10
 while time.monotonic()<end:
  if sql(f'select {holder}=any(pg_blocking_pids({worker}));')=='t':return
  time.sleep(.04)
 raise AssertionError('Expected actual blocking was not observed')
def uid():return str(uuid.uuid4())
def close(sid,key,expected=10000,counted=10000):return f"select cafeteria_operations_close('{CA}','{sid}',1,{counted},'administrative_recovery','Synthetic race','{key}',{expected});"
def sale(sid):
 body={'request_key':uid(),'register_session_id':sid,'cafeteria_customer_id':None,'expected_total_minor':'5000','items':[{'product_id':'00000000-0000-0000-0000-000000008101','quantity':1,'expected_product_version':1,'expected_unit_price_minor':'5000'}],'tender':{'type':'cash','cash_received_minor':'10000'}}
 return "select checkout_purchase('"+json.dumps(body)+"');"
endpoint=os.environ.get('DOCKER_HOST') or subprocess.check_output([D,'context','inspect','--format','{{.Endpoints.docker.Host}}'],text=True).strip()
assert endpoint in {'unix:///var/run/docker.sock','unix://'+str(Path.home()/'.docker/run/docker.sock')},'Local Docker required'
assert subprocess.check_output([D,'inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}',CONTAINER],text=True).strip()=='pikas-4d6'
assert sql('select max(version) from supabase_migrations.schema_migrations;')=='202610160001'
for case in ['exact_close','double_close','changed_retry','sale_before_close','close_before_sale','revoked_admin']:
 sid=sql(auth(CASHIER)+f"select session_id from open_register_session('{REG}','{ASSIGN}',10000,'{uid()}');")
 key=uid();a=b=None
 try:
  a,ap=connection(None if case=='revoked_admin' else CASHIER if case=='sale_before_close' else ADMIN)
  b,bp=connection(CASHIER if case=='close_before_sale' else ADMIN)
  if case=='revoked_admin':work="update cafeteria_memberships set status='suspended' where person_id='00000000-0000-0000-0000-000000001003';"
  elif case=='sale_before_close':work=sale(sid)
  else:work=close(sid,key)
  write(a,work+"select 'HELD';");marker(a)
  if case=='close_before_sale':other=sale(sid)
  elif case=='changed_retry':other=close(sid,key,counted=9000)
  else:other=close(sid,key if case=='exact_close' else uid())
  write(b,other+'commit;');blocked(bp,ap)
  write(a,'commit;');ac,ao,ae=finish(a);assert ac==0,ae
  bc,bo,be=finish(b)
  if case=='exact_close':assert bc==0,be
  else:
   expected={'double_close':'register_session_already_closed','changed_retry':'request_key_reused','sale_before_close':'stale_expected_cash','close_before_sale':'SESSION_CLOSED','revoked_admin':'cafeteria_authority_required'}[case]
   assert bc!=0 and expected in be,be
  if case=='revoked_admin':
   sql("update cafeteria_memberships set status='active' where person_id='00000000-0000-0000-0000-000000001003';")
   assert sql(f"select status from register_sessions where id='{sid}';")=='open'
   sql(auth(ADMIN)+close(sid,uid()))
  if case=='sale_before_close':
   assert sql(f"select status from register_sessions where id='{sid}';")=='open'
   sql(auth(ADMIN)+close(sid,uid(),15000,15000))
  expected='15000' if case=='sale_before_close' else '10000'
  assert sql(f"select summary->>'expected_minor' from pikas_private.register_close_reconciliations where session_id='{sid}';")==expected
  assert sql(f"select count(*) from pikas_private.register_close_reconciliations where session_id='{sid}';")=='1'
  print(f'PASS {case}: pg_blocking_pids({bp}) observed {ap}; permanent close and authoritative expected verified')
 finally:
  for p in [a,b]:
   if p and p.poll() is None:p.kill();p.communicate(timeout=5)
print('PASS all 6 Phase 5A observed-blocking races')
