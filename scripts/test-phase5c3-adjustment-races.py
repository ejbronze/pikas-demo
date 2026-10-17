#!/usr/bin/env python3
"""LOCAL ONLY Phase 5C.3 administrative-adjustment races; every concurrent pair proves pg_blocking_pids.
Requires the Auth-enabled pikas-4d6 synthetic environment with 202610200001 applied.
"""
import json,subprocess,sys,time,uuid
D='/Applications/Docker.app/Contents/Resources/bin/docker'
C=[D,'exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']
S='00000000-0000-0000-0000-000000000011';ST='00000000-0000-0000-0000-000000005201';W='00000000-0000-0000-0000-000000007001';CAFE='00000000-0000-0000-0000-000000000111'
SCHOOL_ADMIN='00000000-0000-0000-0000-000000002002';ACCOUNT_ADMIN='00000000-0000-0000-0000-000000002001';CAFE_ADMIN='00000000-0000-0000-0000-000000002003';CASH='00000000-0000-0000-0000-000000002008'
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
assert subprocess.check_output([D,'inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],text=True).strip()=='pikas-4d6'
assert sql('select max(version) from supabase_migrations.schema_migrations')>='202610200001'
def adjust(amount,key=None,reason='administrative_correction'):return f"select school_wallet_adjust('{S}','{ST}',{amount},'{reason}','Corrección de carrera local','{key or uid()}');"
def cafe_adjust(amount,key=None):return f"select cafeteria_wallet_adjust('{CAFE}','{ST}',{amount},'administrative_correction','Corrección de carrera local','{key or uid()}');"
def credit(amount=5000,key=None):return f"select school_wallet_replenish('{S}','{ST}',{amount},'{key or uid()}','Local race','Verified fictional funds');"
def balance():return int(sql(f"select current_balance_minor from student_wallets where id='{W}';"))
def adjustments(key):return int(sql(f"select count(*) from wallet_adjustments where idempotency_key='{key}';"))
def consistent():return sql(f"select current_balance_minor::numeric=(select sum(amount_minor::numeric) from wallet_ledger_entries where wallet_id='{W}') and (select bool_and(balance_after_minor=balance_before_minor+amount_minor) from wallet_adjustments where wallet_id='{W}' and actor_source is not null) from student_wallets where id='{W}';")=='t'
sid=sql(auth(CASH)+f"select session_id from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',0,'{uid()}');")
def sale():
 b={'request_key':uid(),'register_session_id':sid,'cafeteria_customer_id':'00000000-0000-0000-0000-000000006901','expected_total_minor':'5000',
    'items':[{'product_id':'00000000-0000-0000-0000-000000008101','quantity':1,'expected_product_version':1,'expected_unit_price_minor':'5000'}],'tender':{'type':'student_wallet'}}
 return "select checkout_purchase('"+json.dumps(b)+"');"
def race(name,holder_actor,holder_sql,worker_actor,worker_sql,expect_error,delta,check=lambda:True,after=None):
 before=balance();a=b=None
 try:
  a,ap=connect(holder_actor);b,bp=connect(worker_actor)
  write(a,holder_sql+"select 'HELD';");held(a)
  write(b,worker_sql+'commit;');blocked(bp,ap);write(a,'commit;');ac,ao,ae=finish(a);assert ac==0,ae
  bc,bo,be=finish(b)
  if expect_error:assert bc!=0 and expect_error in be,(name,be)
  else:assert bc==0,(name,be)
  assert balance()==before+delta,(name,before,balance())
  assert check(),name
  assert consistent(),name
  print(f'PASS {name}: pg_blocking_pids({bp}) observed holder {ap}; balance/ledger/evidence reconciled')
 finally:
  for p in [a,b]:
   if p and p.poll() is None:p.kill();p.communicate(timeout=5)
  if after:after()
CASES=sys.argv[1:] or ['duplicate_retry','concurrent_adjustments','adjustment_vs_purchase','adjustment_vs_replenishment','adjustment_vs_reversal','authority_revoked','relationship_revoked']
sql(auth(SCHOOL_ADMIN)+credit(100000))
if 'duplicate_retry' in CASES:
 key=uid();race('duplicate_retry',SCHOOL_ADMIN,adjust(3000,key),SCHOOL_ADMIN,adjust(3000,key),None,3000,lambda:adjustments(key)==1)
if 'concurrent_adjustments' in CASES:
 race('concurrent_adjustments',SCHOOL_ADMIN,adjust(4000),ACCOUNT_ADMIN,adjust(-9000,reason='authorized_debit'),None,-5000)
if 'adjustment_vs_purchase' in CASES:
 race('adjustment_vs_purchase',CASH,sale(),CAFE_ADMIN,cafe_adjust(-1000),None,-6000)
if 'adjustment_vs_replenishment' in CASES:
 race('adjustment_vs_replenishment',SCHOOL_ADMIN,credit(7000),ACCOUNT_ADMIN,adjust(-2000,reason='authorized_debit'),None,5000)
if 'adjustment_vs_reversal' in CASES:
 rep=json.loads(sql(auth(SCHOOL_ADMIN)+credit(6000)))['replenishment_id']
 race('adjustment_vs_reversal',SCHOOL_ADMIN,f"select school_wallet_reverse_replenishment('{S}','{ST}','{rep}','wrong_amount',null,'{uid()}');",ACCOUNT_ADMIN,adjust(1500),None,-4500)
if 'authority_revoked' in CASES:
 race('authority_revoked',None,"update school_memberships set status='suspended' where person_id='00000000-0000-0000-0000-000000001002';",
  SCHOOL_ADMIN,adjust(1000),'school_authority_required',0,
  after=lambda:sql("update school_memberships set status='active' where person_id='00000000-0000-0000-0000-000000001002';"))
if 'relationship_revoked' in CASES:
 race('relationship_revoked',None,"update cafeteria_customers set status='inactive' where id='00000000-0000-0000-0000-000000006901';",
  CAFE_ADMIN,cafe_adjust(-1000),'cafeteria_authority_required',0,
  after=lambda:sql("update cafeteria_customers set status='active' where id='00000000-0000-0000-0000-000000006901';"))
v=sql(f"select version from register_sessions where id='{sid}';");e=sql(f"select pikas_private.register_cash_summary('{sid}')->>'expected_minor';")
assert e=='0','Adjustments and wallet purchases create no register cash'
sql(auth(CASH)+f"select close_my_register_session('{sid}',{v},0,'{uid()}');")
print('PASS selected adjustment races; register expected cash unchanged')
