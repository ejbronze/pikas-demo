#!/usr/bin/env python3
"""Local-only Phase 3C races: independent psql backends and observed locks.

The fixed private production clock is temporarily replaced by a database-owned
synthetic clock for two boundary scenarios, then restored. No caller clock input.
"""
from __future__ import annotations
import argparse
import sys
sys.dont_write_bytecode = True
import concurrent.futures
import importlib.util
import json
import subprocess
import time
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location('frozen3b', Path(__file__).with_name('test-pos-purchase-races.py'))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
h.PHASE_3B = '202610050001'
A='00000000-0000-0000-0000-000000000001'
S='00000000-0000-0000-0000-000000000011'
CM='00000000-0000-0000-0000-000000004601'
SM='00000000-0000-0000-0000-000000004603'
SP='00000000-0000-0000-0000-000000001011'
ITERATIONS=10
PROOFS=0
INDEPENDENCE=0
CLOCK_BODY="select pg_catalog.clock_timestamp()"
NAMES=[
 'partial-partial-ceiling','full-partial','wallet-purchase','replenishment','adjustment',
 'independent-allowance','single-approval','override-change','allowance-change',
 'normal-close','exceptional-close','identical-refund-key','changed-refund-key',
 'same-day-spend-boundary','customer-lifecycle','approval-revocation','approver-suspension',
 'requester-suspension','wallet-freeze','same-wallet-different-purchases','cross-cafeteria-spend',
 'expiry-while-blocked','midnight-while-blocked','unrelated-independent-refunds',
 'same-purchase-ordinal','different-purchase-ordinal','identical-approval-key',
 'changed-approval-key','semantic-approval-new-transport-key','same-person-self-approval','duplicate-supervisor-approvals']

def lit(value):
    if value is None: return 'null'
    return "'"+str(value).replace("'","''")+"'"

def key(): return str(uuid.uuid4())

def call(auth,sql):
    r=h.run_docker(h.psql_args(),sql=h.transaction_sql(auth,sql,0))
    if r.returncode: raise AssertionError(r.stderr)
    return r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ''

def refund(p,session,amount=1000,member=CM,approval=None,k=None):
    return 'select public.create_purchase_refund('+','.join(map(lit,[p,str(amount),'error',None,k or key(),member,session,approval]))+');'

def approve(p,session,amount=1000,k=None,requester=CM,issuer=SM):
    return 'select public.create_purchase_refund_approval('+','.join(map(lit,[p,str(amount),'error',None,k or key(),requester,issuer,session]))+');'

def policy(on=False,allowance=0):
    version=h.query(f"select version from public.cafeteria_refund_policies where cafeteria_id='{h.CAFETERIA}';")
    return f"select public.configure_cafeteria_refund_policy('{h.CAFETERIA}',{version},{str(on).lower()},{allowance});"

def usage():
    return int(h.query(f"select coalesce(sum(amount_minor::numeric),0) from public.refunds where cafeteria_id='{h.CAFETERIA}' and actor_person_id='{h.CASHIER_PERSON}' and authorization_mode='independent' and business_date=(clock_timestamp() at time zone (select business_timezone from public.schools where id='{S}'))::date;"))

def purchase(auth,session,wallet=False,customer=None,product=None):
    payload=h.payload(session,key(),customer=customer or (h.CUSTOMER if wallet else None),tender='student_wallet' if wallet else 'cash')
    if product: payload['items'][0]['product_id']=product
    return json.loads(call(auth,h.checkout_sql(payload)))['purchase_id']

CAPTURE="""
create function pg_temp.capture(statement text) returns jsonb language plpgsql as $$
declare result jsonb; code text; message text;
begin
 execute 'select to_jsonb(x) from ('||rtrim(statement,';')||') x' into result;
 return jsonb_build_object('sqlstate','00000','result',result);
exception when others then
 get stacked diagnostics code=returned_sqlstate,message=message_text;
 return jsonb_build_object('sqlstate',code,'message',message);
end $$;
"""

def race(one,two,*,first=0,fence='',blocked=True,after_block=None):
    global PROOFS,INDEPENDENCE
    calls=[one,two]; processes=[]; outputs=[None,None]; label='p3c-'+key()
    command=[h.DOCKER,*h.psql_args()]
    leader=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    processes.append(leader)
    try:
        auth,statement=calls[first]
        leader.stdin.write('begin; set local statement_timeout=\'20s\';\n'+CAPTURE+'\n'+fence+'\n'+
            f"set local request.jwt.claim.sub={lit(auth)}; set local role authenticated;\n"+
            f"select pg_temp.capture({lit(statement)}); select 'READY:'||pg_backend_pid();\n")
        leader.stdin.flush()
        lines=[]
        def ready():
            for line in leader.stdout:
                if line.startswith('READY:'): return int(line.split(':')[1])
                if line.startswith('{'): lines.append(line)
            raise AssertionError('Leader handshake failed: '+leader.stderr.read())
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool: pid=pool.submit(ready).result(timeout=25)
        follower=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        processes.append(follower)
        auth,statement=calls[1-first]
        follower.stdin.write(f"set application_name={lit(label)}; begin; set local statement_timeout='20s';\n"+CAPTURE+
            f"set local request.jwt.claim.sub={lit(auth)}; set local role authenticated;\n"+
            f"select pg_temp.capture({lit(statement)}); commit;\n")
        follower.stdin.close(); follower.stdin=None
        if blocked:
            deadline=time.monotonic()+12
            while time.monotonic()<deadline:
                proof=h.query(f"select count(*) from pg_stat_activity where application_name={lit(label)} and {pid}=any(pg_blocking_pids(pid));")
                if proof=='1': PROOFS+=1; break
                if follower.poll() is not None: raise AssertionError('Required blocking was not observed')
                time.sleep(.02)
            else: raise AssertionError('No blocking proof')
            if after_block: after_block()
            leader.stdin.write('commit;\n'); leader.stdin.close();leader.stdin=None
            fo,fe=follower.communicate(timeout=25)
        else:
            fo,fe=follower.communicate(timeout=5)
            if h.query(f"select count(*) from pg_stat_activity where pid={pid} and xact_start is not null;")!='1':
                raise AssertionError('Leader transaction was not held during independent completion')
            INDEPENDENCE+=1
            leader.stdin.write('commit;\n');leader.stdin.close();leader.stdin=None
        lo,le=leader.communicate(timeout=25)
        if leader.returncode or follower.returncode: raise AssertionError(le+'\n'+fe)
        outputs[first]=json.loads(lines[-1]); outputs[1-first]=json.loads([x for x in fo.splitlines() if x.startswith('{')][-1])
        return outputs
    finally:
        for proc in processes:
            if proc.poll() is None: proc.kill();proc.communicate()

def wallet_status(status):
    return f"select public.set_student_wallet_status('{A}','{S}','{h.WALLET}',{lit(status)});"

def membership(person,role,status):
    return f"select * from public.set_cafeteria_pos_membership('{h.CAFETERIA}',{lit(person)},{lit(role)},{lit(status)});"

def clock_fixture(value):
    h.query("create table if not exists pikas_private.refund_race_clock(value timestamptz not null);")
    h.query('truncate pikas_private.refund_race_clock; insert into pikas_private.refund_race_clock values('+lit(value)+');')
    h.query("create or replace function pikas_private.refund_clock() returns timestamptz language sql volatile set search_path='' as $$ select value from pikas_private.refund_race_clock $$;")

def restore_clock():
    h.query(f"create or replace function pikas_private.refund_clock() returns timestamptz language sql volatile set search_path='' as $$ {CLOCK_BODY} $$;")
    h.query('drop table if exists pikas_private.refund_race_clock;')

def inspect_integrity():
    probes=[
     "not exists(select 1 from public.refunds r where r.refund_ordinal<>(select count(*) from public.refunds x where x.purchase_id=r.purchase_id and x.refund_ordinal<=r.refund_ordinal))",
     "not exists(select 1 from public.refunds r where r.authorization_mode='independent' and r.supervisor_override_enabled and r.independent_allowance_minor<(select sum(x.amount_minor::numeric) from public.refunds x where x.cafeteria_id=r.cafeteria_id and x.actor_person_id=r.actor_person_id and x.business_date=r.business_date and x.currency_code=r.currency_code and x.authorization_mode='independent' and x.occurred_at<=r.occurred_at))",
     "not exists(select 1 from public.financial_approvals a where a.consumed_refund_id is not null and not exists(select 1 from public.refunds r where r.id=a.consumed_refund_id and r.approval_id=a.id and r.semantic_fingerprint=a.semantic_fingerprint and r.prior_matching_refund_id is not distinct from a.prior_matching_refund_id and r.occurred_at=a.consumed_at and a.issued_at<=r.occurred_at and r.occurred_at<a.expires_at and a.revoked_at is null))",
     "not exists(select 1 from public.wallet_refund_credits c join public.refunds r on r.id=c.refund_id join public.purchase_wallet_tenders t on t.tender_id=r.original_tender_id where c.original_tender_id<>t.tender_id or c.original_purchase_debit_id<>t.wallet_purchase_debit_id or c.wallet_id<>t.wallet_id or c.student_id<>t.student_id or c.amount_minor<>r.amount_minor or c.currency_code<>r.currency_code)",
     "not exists(select 1 from public.refund_cash_outflows c join public.refunds r on r.id=c.refund_id where c.original_cash_tender_id<>r.original_tender_id or c.register_session_id<>r.register_session_id or c.amount_minor<>r.amount_minor or c.currency_code<>r.currency_code)",
     "not exists(select 1 from public.purchases p where (select coalesce(sum(amount_minor::numeric),0) from public.refunds r where r.purchase_id=p.id)>p.total_minor)",
     "not exists(select 1 from public.student_wallets w where w.current_balance_minor<>(select coalesce(sum(amount_minor::numeric),0) from public.wallet_ledger_entries l where l.wallet_id=w.id) or w.balance_version<>(select coalesce(max(balance_version_after),0) from public.wallet_ledger_entries l where l.wallet_id=w.id))",
     "not exists(select 1 from public.refunds r where (select count(*) from public.refund_cash_outflows c where c.refund_id=r.id)+(select count(*) from public.wallet_refund_credits c where c.refund_id=r.id)<>1)",
     "not exists(select 1 from public.refunds r where r.authorization_mode='supervisor_approved' and not exists(select 1 from public.financial_approvals a where a.id=r.approval_id and a.consumed_refund_id=r.id and a.requester_person_id=r.actor_person_id and a.requester_person_id<>a.approver_person_id))",
     "not exists(select 1 from public.wallet_refund_credits c where (select count(*) from public.wallet_ledger_entries l where l.refund_credit_id=c.id and l.amount_minor=c.amount_minor and l.entry_type='refund')<>1)",
     "not exists(select 1 from public.refunds r join public.purchases p on p.id=r.purchase_id where (select count(*) from public.student_daily_spend_events d where d.refund_id=r.id)<>case when p.student_id is not null and p.business_date=r.business_date then 1 else 0 end)",
     "not exists(select 1 from public.student_daily_spend_events d join public.refunds r on r.id=d.refund_id where d.amount_minor<>-r.amount_minor or d.business_date<>r.business_date)",
     "not exists(select 1 from public.refunds r where (select count(*) from public.audit_events e where e.action='refund_committed' and e.target_id=r.id)<>1)"]
    if h.query('select '+' and '.join('('+x+')' for x in probes)+';')!='t': raise AssertionError('Financial integrity probe failed')


def scenario(category,index,self_member,super_cashier,super_assignment,cross_product,cross_customer,other_supervisor):
    call(h.ADMIN,policy())
    call(h.ADMIN,membership(h.CASHIER_PERSON,'pos_cashier','active'))
    call(h.ADMIN,membership(SP,'pos_supervisor','active'))
    call(h.SCHOOL_ADMIN,wallet_status('active'))
    h.query(f"update public.cafeteria_customers set status='active' where id='{h.CUSTOMER}';")
    h.set_limit(0,False)
    h.top_up(20000,1000+category*10+index)
    cs,ss=h.open_pair(1000+category*10+index)
    wallet=category in [3,4,5,15,19,20,24]
    p=purchase(h.CASHIER,cs,wallet)
    q=None; approval=None; blocked=True; fence=''; callback=None; first=index%2
    one=(h.CASHIER,refund(p,None if wallet else cs));two=None
    owner_fence=f"select pg_advisory_xact_lock(hashtextextended('{h.CASHIER_PERSON}',20261005));"
    student_fence=f"select pg_advisory_xact_lock(hashtextextended('{h.STUDENT}',0));"
    if category==1: one=(h.CASHIER,refund(p,cs,3000));two=(h.SUPERVISOR,refund(p,ss,3000,SM))
    elif category==2: one=(h.CASHIER,refund(p,cs,5000));two=(h.SUPERVISOR,refund(p,ss,1000,SM))
    elif category==3: two=(h.SUPERVISOR,h.checkout_sql(h.payload(ss,key(),customer=h.CUSTOMER,tender='student_wallet')))
    elif category==4: two=(h.SCHOOL_ADMIN,f"select * from public.post_manual_wallet_replenishment('{h.WALLET}',1000,{lit(key())},'synthetic race','local evidence',null);")
    elif category==5: two=(h.SCHOOL_ADMIN,f"select * from public.post_student_wallet_adjustment('{h.WALLET}',1000,'administrative_correction',{lit(key())},'synthetic race','local evidence');")
    elif category==6:
        q=purchase(h.CASHIER,cs);call(h.ADMIN,policy(True,usage()+3000))
        one=(h.CASHIER,refund(p,cs,3000));two=(h.CASHIER,refund(q,cs,3000))
    elif category in [7,16,17,22,29]:
        approval=json.loads(call(h.SUPERVISOR,approve(p,cs)))['approval_id']
        one=(h.CASHIER,refund(p,cs,approval=approval))
        if category==7: two=(h.CASHIER,refund(p,cs,approval=approval))
        elif category==16: two=(h.SUPERVISOR,f'select public.revoke_financial_approval({lit(approval)});')
        elif category==17: two=(h.ADMIN,membership(SP,'pos_supervisor','suspended'))
        elif category==22:
            first=1;clock_fixture(h.query('select clock_timestamp();'))
            two=(h.ADMIN,policy());callback=lambda: h.query("update pikas_private.refund_race_clock set value=value+interval '11 minutes';")
        elif category==29:
            first=0;fence=owner_fence
            h.query("update public.supported_currencies set status='disabled' where currency_code='DOP';")
            callback=lambda: h.query("update public.supported_currencies set status='enabled' where currency_code='DOP';")
            one=(h.CASHIER,refund(p,cs,approval=approval));two=(h.CASHIER,refund(p,cs,approval=approval))
    elif category in [8,9]:
        if category==9: call(h.ADMIN,policy(True,usage()+1000))
        two=(h.ADMIN,policy(True,0))
    elif category==10: two=(h.CASHIER,f"select * from public.close_my_register_session('{cs}',1,0,{lit(key())});")
    elif category==11: two=(h.SUPERVISOR,f"select * from public.exceptionally_close_register_session('{cs}',1,0,'administrative_recovery',null,{lit(key())});")
    elif category in [12,13]:
        k=key();one=(h.CASHIER,refund(p,cs,k=k));two=(h.CASHIER,refund(p,cs,1001 if category==13 else 1000,k=k))
    elif category in [14,21]:
        # Create an identified original purchase, then leave only 3000 capacity.
        p=purchase(h.CASHIER,cs,False,h.CUSTOMER)
        h.set_limit(h.spent_today()+3000)
        one=(h.CASHIER,refund(p,cs,2000));buyer_session=ss;product=None;customer=h.CUSTOMER
        if category==21:
            h.close_session(h.SUPERVISOR,ss,key())
            buyer_session=h.open_session(h.SUPERVISOR,'00000000-0000-0000-0000-000000009404','00000000-0000-0000-0000-000000009505',key())
            product=cross_product;customer=cross_customer
        value=h.payload(buyer_session,key(),customer=customer)
        if product: value['items'][0]['product_id']=product
        two=(h.SUPERVISOR,h.checkout_sql(value))
        if first==1: fence=f"select pg_advisory_xact_lock(hashtextextended('{SP}',20261005));"+student_fence
    elif category==15:
        two=(h.SCHOOL_ADMIN,f"select public.deactivate_cafeteria_customer('{A}','{S}','{h.CUSTOMER}');");blocked=False
    elif category==18: two=(h.ADMIN,membership(h.CASHIER_PERSON,'pos_cashier','suspended'))
    elif category==19: two=(h.SCHOOL_ADMIN,wallet_status('frozen'))
    elif category==20:
        q=purchase(h.CASHIER,cs,True);two=(h.SUPERVISOR,refund(q,None,1000,SM))
    elif category==23:
        p=purchase(h.CASHIER,cs,False,h.CUSTOMER);one=(h.CASHIER,refund(p,cs))
        first=1;clock_fixture(h.query(f"select ((clock_timestamp() at time zone (select business_timezone from public.schools where id='{S}'))::date+time '23:59:59') at time zone (select business_timezone from public.schools where id='{S}');"))
        two=(h.ADMIN,policy());callback=lambda: h.query("update pikas_private.refund_race_clock set value=value+interval '2 seconds';")
    elif category==24:
        # Two anonymous cash refunds under distinct Cashier memberships/sessions.
        h.close_session(h.SUPERVISOR,ss,key())
        ss=h.open_session(h.SUPERVISOR,h.REGISTER_B,super_assignment,key())
        p=purchase(h.CASHIER,cs);q=purchase(h.SUPERVISOR,ss)
        one=(h.CASHIER,refund(p,cs));two=(h.SUPERVISOR,refund(q,ss,1000,super_cashier));blocked=False
    elif category==25: two=(h.SUPERVISOR,refund(p,ss,1000,SM))
    elif category==26:
        q=purchase(h.SUPERVISOR,ss);two=(h.SUPERVISOR,refund(q,ss,1000,SM));blocked=False
    elif category in [27,28]:
        k=key();one=(h.SUPERVISOR,approve(p,cs,k=k));two=(h.SUPERVISOR,approve(p,cs,1001 if category==28 else 1000,k=k))
    elif category==30:
        first=0;fence=f"select 1 from public.persons where id='{h.CASHIER_PERSON}' for update;"
        one=(h.CASHIER,approve(p,cs,issuer=self_member));two=(h.CASHIER,approve(p,cs,issuer=self_member))
    elif category==31:
        a1=json.loads(call(h.SUPERVISOR,approve(p,cs)))['approval_id']
        a2=json.loads(call(h.ADMIN,approve(p,cs,issuer=other_supervisor)))['approval_id']
        one=(h.CASHIER,refund(p,cs,approval=a1));two=(h.CASHIER,refund(p,cs,approval=a2))
    else: raise AssertionError(category)
    original_query=f"select md5(jsonb_build_object('purchase',(select to_jsonb(x) from public.purchases x where id='{p}'),'items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.purchase_items x where purchase_id='{p}'),'tenders',(select jsonb_agg(to_jsonb(x) order by x.id) from public.purchase_tenders x where purchase_id='{p}'),'cash',(select jsonb_agg(to_jsonb(x) order by x.tender_id) from public.purchase_cash_tenders x join public.purchase_tenders t on t.id=x.tender_id where t.purchase_id='{p}'),'wallet_tender',(select jsonb_agg(to_jsonb(x) order by x.tender_id) from public.purchase_wallet_tenders x join public.purchase_tenders t on t.id=x.tender_id where t.purchase_id='{p}'),'debit',(select jsonb_agg(to_jsonb(x) order by x.id) from public.wallet_purchase_debits x where purchase_id='{p}'),'debit_ledger',(select jsonb_agg(to_jsonb(x) order by x.id) from public.wallet_ledger_entries x join public.wallet_purchase_debits d on d.id=x.purchase_debit_id where d.purchase_id='{p}'),'spend',(select jsonb_agg(to_jsonb(x) order by x.id) from public.student_daily_spend_events x where purchase_id='{p}' and event_type='purchase'))::text);"
    original_before=h.query(original_query)
    balance_before=int(h.query(f"select current_balance_minor from public.student_wallets where id='{h.WALLET}';"))
    version_before=int(h.query(f"select balance_version from public.student_wallets where id='{h.WALLET}';"))
    results=race(one,two,first=first,fence=fence,blocked=blocked,after_block=callback)
    if category in [22,23]: restore_clock()
    codes=[x['sqlstate'] for x in results]
    expected={1:['00000','23514'],2:['00000','23514'],6:['00000','42501'],7:['00000','23514'],
      13:['00000','23505'],28:['00000','23505'],29:['23514','00000'],30:['42501','42501'],31:['00000','23514']}
    if category in expected and sorted(codes)!=sorted(expected[category]): raise AssertionError((category,results))
    allowed={8:{'00000','42501'},9:{'00000','42501'},10:{'00000','23514'},11:{'00000','23514'},
      14:{'00000','23514'},16:{'00000','23514'},17:{'00000','42501'},18:{'00000','42501'},21:{'00000','23514'},22:{'00000','23514'}}
    if category not in expected and any(c not in allowed.get(category,{'00000'}) for c in codes): raise AssertionError((category,results))
    expected_messages={1:'REFUND_EXCEEDS_REMAINING',2:'REFUND_EXCEEDS_REMAINING',6:'REFUND_APPROVAL_REQUIRED',7:'APPROVAL_ALREADY_USED',
      8:'REFUND_APPROVAL_REQUIRED',9:'REFUND_APPROVAL_REQUIRED',10:'SESSION_CLOSED',11:'SESSION_CLOSED',12:'',13:'IDEMPOTENCY_CONFLICT',
      14:'DAILY_LIMIT_EXCEEDED',16:None,17:'APPROVER_NOT_AUTHORIZED',18:'REFUND_NOT_AUTHORIZED',21:'DAILY_LIMIT_EXCEEDED',
      22:'APPROVAL_EXPIRED',28:'IDEMPOTENCY_CONFLICT',29:'CURRENCY_DISABLED',30:'SELF_APPROVAL_NOT_ALLOWED',31:'APPROVAL_INVALID'}
    for result in results:
        if category==2: expected_messages[2]='NOT_REFUNDABLE' if first==0 else 'REFUND_EXCEEDS_REMAINING'
        if category==16 and result['sqlstate']!='00000' and result.get('message') not in ['APPROVAL_INVALID','APPROVAL_ALREADY_USED']: raise AssertionError((category,result))
        if result['sqlstate']!='00000' and expected_messages.get(category) and result.get('message')!=expected_messages[category]:
            raise AssertionError((category,result))
    wallet_changes={3:(-4000,2),4:(2000,2),5:(2000,2),15:(1000,1),19:(1000,1),20:(2000,2)}
    delta,versions=wallet_changes.get(category,(0,0))
    if int(h.query(f"select current_balance_minor from public.student_wallets where id='{h.WALLET}';"))!=balance_before+delta or int(h.query(f"select balance_version from public.student_wallets where id='{h.WALLET}';"))!=version_before+versions:
        raise AssertionError((category,'Unexpected wallet balance/version transition'))
    if category in [1,2,7,12,13,31]:
        if h.query(f"select count(*) from public.refunds where purchase_id='{p}';")!='1': raise AssertionError((category,'Wrong refund count'))
    if category==12 and results[0]['result']!=results[1]['result']: raise AssertionError('Replay result changed')
    if category==6 and h.query(f"select count(*) from public.refunds where purchase_id in('{p}','{q}');")!='1': raise AssertionError('Allowance admitted two independent refunds')
    if category==22 and results[0].get('message')!='APPROVAL_EXPIRED': raise AssertionError('Blocked approval did not expire')
    if category==29 and results[1]['sqlstate']!='00000': raise AssertionError('New transport key invalidated semantic approval')
    if category==23 and h.query(f"select count(*) from public.student_daily_spend_events where refund_id in(select id from public.refunds where purchase_id='{p}');")!='0':
        raise AssertionError('Later-day refund created spend compensation')
    if category in [25,26]:
        expected_ord='1,2' if category==25 else '1'
        actual=h.query(f"select string_agg(refund_ordinal::text,',' order by refund_ordinal) from public.refunds where purchase_id='{p}';")
        if actual!=expected_ord: raise AssertionError((category,actual))
    if h.query(original_query)!=original_before: raise AssertionError('Original purchase evidence mutated')
    if category==31 and h.query(f"select count(*) from public.financial_approvals where id in('{a1}','{a2}') and consumed_refund_id is not null;")!='1': raise AssertionError('Sibling approvals funded proposal twice')
    inspect_integrity()
    call(h.ADMIN,membership(h.CASHIER_PERSON,'pos_cashier','active'));call(h.ADMIN,membership(SP,'pos_supervisor','active'))
    for auth,session in [(h.CASHIER,cs),(h.SUPERVISOR,ss)]:
        if h.query(f"select status from public.register_sessions where id='{session}';")=='open': h.close_session(auth,session,key())
    if category==21: h.close_session(h.SUPERVISOR,buyer_session,key())
    print(json.dumps({'category':category,'name':NAMES[category-1],'iteration':index+1,'outcomes':results,'blocking_proofs':PROOFS,'independence_proofs':INDEPENDENCE}),flush=True)


def main():
    global ITERATIONS
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frozen3b',action='store_true')
    parser.add_argument('--category',type=int,choices=range(1,32))
    parser.add_argument('--iterations',type=int,choices=[1,10],default=10)
    args=parser.parse_args()
    if args.frozen3b:
        h.main(); return
    ITERATIONS=args.iterations
    categories=[args.category] if args.category else list(range(1,32))
    h.verify_local_db()
    for table in ['refunds','refund_cash_outflows','wallet_refund_credits','financial_approvals']:
        if h.query(f'select count(*) from public.{table};')!='0': raise RuntimeError('Refusing nonempty refund history')
    if h.query("select prosrc from pg_proc where oid='pikas_private.refund_clock()'::regprocedure;").strip()!=CLOCK_BODY:
        raise RuntimeError('Refusing modified production clock')
    h.query(f"update public.schools set business_timezone='Etc/GMT'||case when extract(hour from clock_timestamp() at time zone 'UTC')>=12 then '+' else '-' end||abs(extract(hour from clock_timestamp() at time zone 'UTC')::integer-12)::text where id='{S}';")
    h.spent_today=lambda: int(h.query(f"select coalesce(sum(amount_minor::numeric),0) from public.student_daily_spend_events where student_id='{h.STUDENT}' and business_date=(clock_timestamp() at time zone (select business_timezone from public.schools where id='{S}'))::date;"))
    h.add_supervisor_assignment()
    call(h.ADMIN,membership(h.CASHIER_PERSON,'pos_supervisor','active'))
    call(h.ADMIN,membership('00000000-0000-0000-0000-000000001003','pos_supervisor','active'))
    other_supervisor=h.query(f"select id from public.cafeteria_memberships where person_id='00000000-0000-0000-0000-000000001003' and cafeteria_id='{h.CAFETERIA}' and role_code='pos_supervisor';")
    self_member=h.query(f"select id from public.cafeteria_memberships where person_id='{h.CASHIER_PERSON}' and cafeteria_id='{h.CAFETERIA}' and role_code='pos_supervisor';")
    call(h.ADMIN,membership(SP,'pos_cashier','active'))
    super_cashier=h.query(f"select id from public.cafeteria_memberships where person_id='{SP}' and cafeteria_id='{h.CAFETERIA}' and role_code='pos_cashier';")
    super_assignment=str(uuid.uuid4())
    call(h.ADMIN,f"select * from public.create_cafeteria_register_assignment('{h.CAFETERIA}','{super_assignment}','{super_cashier}','{h.REGISTER_B}');")
    cross_product='00000000-0000-0000-0000-000000098101';cross_customer='00000000-0000-0000-0000-000000096901'
    call(h.SUPERVISOR,f"select * from public.create_cafeteria_product('00000000-0000-0000-0000-000000000113','{cross_product}','Synthetic race product',null,null,5000,true,true);")
    h.query(f"insert into public.school_cafeteria_shares(account_id,school_id,cafeteria_id) values('{A}','{S}','00000000-0000-0000-0000-000000000113') on conflict(cafeteria_id) do update set status='active';")
    h.query(f"insert into public.school_cafeteria_share_categories(account_id,school_id,cafeteria_id,share_id,category,enabled) select '{A}','{S}',cafeteria_id,id,'basic_identification',true from public.school_cafeteria_shares where cafeteria_id='00000000-0000-0000-0000-000000000113' on conflict(share_id,category) do update set enabled=true;")
    h.query(f"insert into public.cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id) values('{cross_customer}','{A}','{S}','00000000-0000-0000-0000-000000000113','{h.STUDENT}');")
    try:
        for category in categories:
            for index in range(ITERATIONS): scenario(category,index,self_member,super_cashier,super_assignment,cross_product,cross_customer,other_supervisor)
        print(json.dumps({'iterations':len(categories)*ITERATIONS,'checkpoint_matrix':len(categories)==31 and ITERATIONS>=10,'blocking_proofs':PROOFS,'independence_proofs':INDEPENDENCE,'result':'PASS'}),flush=True)
    finally: restore_clock()

if __name__=='__main__': main()
