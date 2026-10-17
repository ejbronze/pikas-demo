#!/usr/bin/env python3
"""LOCAL ONLY wallet races; every concurrent pair proves pg_blocking_pids.
Requires a freshly reset Auth-enabled pikas-4d6 synthetic environment.
"""
import json,subprocess,time,uuid
D='/Applications/Docker.app/Contents/Resources/bin/docker'
C=[D,'exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']
S='00000000-0000-0000-0000-000000000011';ST='00000000-0000-0000-0000-000000005201';W='00000000-0000-0000-0000-000000007001'
ADMIN='00000000-0000-0000-0000-000000002002';CASH='00000000-0000-0000-0000-000000002008'
def uid():return str(uuid.uuid4())
def sql(q):
 r=subprocess.run(C,input=q,text=True,capture_output=True,timeout=35);assert r.returncode==0,r.stderr;return r.stdout.strip()
def auth(a):return f"set request.jwt.claim.sub='{a}';set role authenticated;"
def write(p,q):p.stdin.write(q+'\n');p.stdin.flush()
def connect(a=None):
 p=subprocess.Popen(C,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 write(p,"begin;set local statement_timeout='25s';"+(auth(a) if a else '')+"select 'PID:'||pg_backend_pid();")
 for line in p.stdout:
  if line.startswith('PID:'):return p,int(line[4:])
 raise AssertionError(p.stderr.read())
def held(p):
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
 raise AssertionError('Actual blocking not observed')
def credit(key=None,amount=5000,student=ST):return f"select school_wallet_replenish('{S}','{student}',{amount},'{key or uid()}','Local race','Verified fictional funds');"
def balance():return int(sql(f"select current_balance_minor from student_wallets where id='{W}';"))
assert subprocess.check_output([D,'inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],text=True).strip()=='pikas-4d6'
assert sql('select max(version) from supabase_migrations.schema_migrations')=='202610160002'
sid=sql(auth(CASH)+f"select session_id from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',0,'{uid()}');")
def sale():
 b={'request_key':uid(),'register_session_id':sid,'cafeteria_customer_id':'00000000-0000-0000-0000-000000006901','expected_total_minor':'5000','items':[{'product_id':'00000000-0000-0000-0000-000000008101','quantity':1,'expected_product_version':1,'expected_unit_price_minor':'5000'}],'tender':{'type':'student_wallet'}}
 return "select checkout_purchase('"+json.dumps(b)+"');"
for case in ['same_credit','changed_credit','distinct_credits','credit_vs_purchase','two_purchases','revoked_authority','legacy_revoked','cross_tenant']:
 if case=='two_purchases':
  while balance()>5000:sql(auth(CASH)+sale())
 before=balance();key=uid();a=b=None
 try:
  a,ap=connect(None if case in ['revoked_authority','legacy_revoked','cross_tenant'] else CASH if case=='two_purchases' else ADMIN)
  b,bp=connect(CASH if case in ['two_purchases','credit_vs_purchase'] else ADMIN)
  if case in ['revoked_authority','legacy_revoked']:first="update school_memberships set status='suspended' where person_id='00000000-0000-0000-0000-000000001002';"
  elif case=='cross_tenant':first=f"select pg_advisory_xact_lock(hashtextextended('99999999-0000-4000-8000-000000000001',0));"
  else:first=sale() if case=='two_purchases' else credit(key)
  if case=='legacy_revoked':first+=f"select pg_advisory_xact_lock(hashtextextended('{ST}',0));"
  write(a,first+"select 'HELD';");held(a)
  second=f"select post_manual_wallet_replenishment('{W}',5000,'{uid()}','Local','Verified local',null);" if case=='legacy_revoked' else sale() if case in ['two_purchases','credit_vs_purchase'] else credit(key,10000) if case=='changed_credit' else credit(key) if case=='same_credit' else credit(student='99999999-0000-4000-8000-000000000001') if case=='cross_tenant' else credit()
  write(b,second+'commit;');blocked(bp,ap);write(a,'commit;');ac,ao,ae=finish(a);assert ac==0,ae
  bc,bo,be=finish(b)
  if case in ['changed_credit','two_purchases','revoked_authority','legacy_revoked','cross_tenant']:
   expected={'changed_credit':'idempotency_key_reused_with_different_payload','two_purchases':'INSUFFICIENT_BALANCE','revoked_authority':'school_authority_required','legacy_revoked':'not_authorized','cross_tenant':'wallet_authority_required'}[case]
   assert bc!=0 and expected in be,be
  else:assert bc==0,be
  delta={'same_credit':5000,'changed_credit':5000,'distinct_credits':10000,'credit_vs_purchase':0,'two_purchases':-5000,'revoked_authority':0,'legacy_revoked':0,'cross_tenant':0}[case]
  assert balance()==before+delta,(case,before,balance())
  if case in ['revoked_authority','legacy_revoked']:sql("update school_memberships set status='active' where person_id='00000000-0000-0000-0000-000000001002';")
  assert sql(f"select current_balance_minor::numeric=(select coalesce(sum(amount_minor::numeric),0) from wallet_ledger_entries where wallet_id='{W}') from student_wallets where id='{W}';")=='t'
  print(f'PASS {case}: pg_blocking_pids({bp}) observed holder {ap}; balance/ledger reconciled')
 finally:
  for p in [a,b]:
   if p and p.poll() is None:p.kill();p.communicate(timeout=5)
sql(auth(CASH)+f"select close_my_register_session('{sid}',1,0,'{uid()}');")
print('PASS 8 wallet races; no register cash from wallet movements')
