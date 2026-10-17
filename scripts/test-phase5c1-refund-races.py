#!/usr/bin/env python3
"""LOCAL ONLY Phase 5C.1 refund races; every concurrent pair proves pg_blocking_pids.
Requires the Auth-enabled pikas-4d6 synthetic environment with 202610180001 applied.
"""
import json,subprocess,sys,time,uuid
D='/Applications/Docker.app/Contents/Resources/bin/docker'
C=[D,'exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']
CAFE='00000000-0000-0000-0000-000000000111';W='00000000-0000-0000-0000-000000007001';CUSTOMER='00000000-0000-0000-0000-000000006901'
CASHIER='00000000-0000-0000-0000-000000002008';SUPER='00000000-0000-0000-0000-000000002011';ADMIN='00000000-0000-0000-0000-000000002003'
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
assert sql('select max(version) from supabase_migrations.schema_migrations')>='202610180001'
def limits(count,amount):
 v=sql(auth(ADMIN)+f"select get_cashier_refund_limits('{CAFE}')->>'version';")
 sql(auth(ADMIN)+f"select configure_cashier_refund_limits('{CAFE}',{v},{count},{amount});")
sql(auth('00000000-0000-0000-0000-000000002002')+f"select school_wallet_replenish('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201',1000000,'{uid()}','Local race','Verified fictional funds');")
limits(1000,100000000)
cs=sql(auth(CASHIER)+f"select session_id from open_register_session('00000000-0000-0000-0000-000000009402','00000000-0000-0000-0000-000000009502',100000,'{uid()}');")
ss=sql(auth(SUPER)+f"select session_id from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009503',100000,'{uid()}');")
def sale(qty,tender,actor=CASHIER,session=None):
 b={'request_key':uid(),'register_session_id':session or cs,'cafeteria_customer_id':CUSTOMER,'expected_total_minor':str(5000*qty),
    'items':[{'product_id':'00000000-0000-0000-0000-000000008101','quantity':qty,'expected_product_version':1,'expected_unit_price_minor':'5000'}],
    'tender':{'type':'cash','cash_received_minor':str(5000*qty)} if tender=='cash' else {'type':'student_wallet'}}
 return sql(auth(actor)+"select checkout_purchase('"+json.dumps(b)+"')->>'purchase_id';")
def refund_sql(session,purchase,qty,key):
 item=sql(f"select id from purchase_items where purchase_id='{purchase}';")
 return f"select create_purchase_item_refund('{session}','{purchase}','[{{\"purchase_item_id\":\"{item}\",\"quantity\":{qty}}}]','wrong_product',null,'{key}');"
def count(purchase):return int(sql(f"select count(*) from refunds where purchase_id='{purchase}';"))
def wallet_ok():return sql(f"select current_balance_minor::numeric=(select sum(amount_minor::numeric) from wallet_ledger_entries where wallet_id='{W}') from student_wallets where id='{W}';")=='t'
def race(name,holder_actor,holder_sql,worker_actor,worker_sql,expect_error=None,check=lambda:True,after=None):
 a=b=None
 try:
  a,ap=connect(holder_actor);b,bp=connect(worker_actor)
  write(a,holder_sql+"select 'HELD';");held(a)
  write(b,worker_sql+'commit;');blocked(bp,ap);write(a,'commit;');ac,ao,ae=finish(a);assert ac==0,ae
  bc,bo,be=finish(b)
  if expect_error:assert bc!=0 and expect_error in be,(name,be)
  else:assert bc==0,(name,be)
  assert check(),name
  assert wallet_ok(),name
  print(f'PASS {name}: pg_blocking_pids({bp}) observed holder {ap}')
 finally:
  for p in [a,b]:
   if p and p.poll() is None:p.kill();p.communicate(timeout=5)
  if after:after()
CASES=sys.argv[1:] or ['duplicate_retry','concurrent_over_refund','concurrent_partial_same_item','cashier_limit','authority_revoked','register_closed','wallet_refund_vs_purchase']
if 'duplicate_retry' in CASES:
 p=sale(2,'cash');key=uid()
 race('duplicate_retry',CASHIER,refund_sql(cs,p,1,key),CASHIER,refund_sql(cs,p,1,key),check=lambda:count(p)==1)
if 'concurrent_over_refund' in CASES:
 p=sale(1,'cash')
 race('concurrent_over_refund',CASHIER,refund_sql(cs,p,1,uid()),SUPER,refund_sql(ss,p,1,uid()),'REFUND_EXCEEDS_REMAINING',lambda:count(p)==1)
if 'concurrent_partial_same_item' in CASES:
 p=sale(3,'wallet')
 race('concurrent_partial_same_item',SUPER,refund_sql(ss,p,2,uid()),CASHIER,refund_sql(cs,p,2,uid()),'REFUND_EXCEEDS_REMAINING',
  lambda:sql(f"select sum(quantity) from refund_items where purchase_id='{p}';")=='2')
if 'cashier_limit' in CASES:
 # One autonomous refund left today (all cashier-initiated refunds count): the waiting one must require override.
 used=int(sql(f"select count(*) from refunds r join persons x on x.id=r.actor_person_id where x.auth_user_id='{CASHIER}' and r.actor_role_code='pos_cashier' and r.cafeteria_id='{CAFE}';"))
 limits(used+1,100000000)
 p1=sale(1,'cash');p2=sale(1,'cash')
 race('cashier_limit',CASHIER,refund_sql(cs,p1,1,uid()),CASHIER,refund_sql(cs,p2,1,uid()),'REFUND_APPROVAL_REQUIRED',lambda:count(p1)==1 and count(p2)==0,
  after=lambda:limits(1000,100000000))
if 'authority_revoked' in CASES:
 p=sale(1,'cash')
 race('authority_revoked',None,"update cafeteria_memberships set status='suspended' where id='00000000-0000-0000-0000-000000004601';",
  CASHIER,refund_sql(cs,p,1,uid()),'REFUND_NOT_AUTHORIZED',lambda:count(p)==0,
  after=lambda:sql("update cafeteria_memberships set status='active' where id='00000000-0000-0000-0000-000000004601';"))
if 'wallet_refund_vs_purchase' in CASES:
 p=sale(1,'wallet')
 b={'request_key':uid(),'register_session_id':ss,'cafeteria_customer_id':CUSTOMER,'expected_total_minor':'5000',
    'items':[{'product_id':'00000000-0000-0000-0000-000000008101','quantity':1,'expected_product_version':1,'expected_unit_price_minor':'5000'}],'tender':{'type':'student_wallet'}}
 race('wallet_refund_vs_purchase',SUPER,"select checkout_purchase('"+json.dumps(b)+"');",CASHIER,refund_sql(cs,p,1,uid()),check=lambda:count(p)==1)
if 'register_closed' in CASES:
 p=sale(1,'cash')
 v=sql(f"select version from register_sessions where id='{cs}';");expected=sql(f"select pikas_private.register_cash_summary('{cs}')->>'expected_minor';")
 race('register_closed',CASHIER,f"select close_my_register_session('{cs}',{v},{expected},'{uid()}');",CASHIER,refund_sql(cs,p,1,uid()),'SESSION_CLOSED',lambda:count(p)==0)
 cs=None
for s,actor in [(cs,CASHIER),(ss,SUPER)]:
 if s and sql(f"select status from register_sessions where id='{s}';")=='open':
  v=sql(f"select version from register_sessions where id='{s}';");e=sql(f"select pikas_private.register_cash_summary('{s}')->>'expected_minor';")
  sql(auth(actor)+f"select close_my_register_session('{s}',{v},{e},'{uid()}');")
print('PASS selected refund races; wallet balance equals ledger after each case')
