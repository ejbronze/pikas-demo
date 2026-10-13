#!/usr/bin/env python3
"""LOCAL ONLY: two anonymous replay races on the existing pikas-4d6 fixture.

No remote target accepted. Appends tagged test purchases and closes its own
register session; does not reset fixtures or modify memberships. Blocking
is observed with pg_blocking_pids, not inferred from sleeps.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid

DOCKER = shutil.which('docker') or '/Applications/Docker.app/Contents/Resources/bin/docker'
CONTAINER = 'supabase_db_pikas-4d6'
DATABASE = 'postgres'
AUTH = 'ec08ad21-4020-4b0d-b041-ee4a1fe09471'
CAF = 'b9496342-5079-46ae-83b8-05c39bcbd7fe'
ACCOUNT = '03e71159-69e9-4387-9b3b-65799d49faf0'


def command(database):
    return [DOCKER, 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', database]


def run(sql, database=DATABASE):
    p = subprocess.run(command(database), input=sql, text=True, capture_output=True, timeout=40)
    if p.returncode:
        raise AssertionError(p.stderr)
    return p.stdout.strip()


def actor(sql):
    return run(f"set request.jwt.claim.sub='{AUTH}';set role authenticated;" + sql)


def connection():
    p = subprocess.Popen(command(DATABASE), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    p.stdin.write(f"begin;set statement_timeout='20s';set local request.jwt.claim.sub='{AUTH}';set local role authenticated;select 'READY:'||pg_backend_pid();\n")
    p.stdin.flush()
    for line in p.stdout:
        if line.startswith('READY:'):
            return p, int(line.split(':')[1])
    raise AssertionError(p.stderr.read())


def checkout(payload):
    # JSON contains only locally generated UUIDs, fixed tender/items and amounts.
    literal = json.dumps(payload, separators=(',', ':')).replace("'", "''")
    return "select public.checkout_purchase('" + literal + "'::jsonb);"


def race(session, changed):
    request = {'request_key': str(uuid.uuid4()), 'register_session_id': session, 'cafeteria_customer_id': None,
               'expected_total_minor': '9500', 'items': [{'product_id': '4c000000-0000-4000-8000-000000000033',
               'quantity': 1, 'expected_product_version': 1, 'expected_unit_price_minor': '9500'}],
               'tender': {'type': 'cash', 'cash_received_minor': '10000'}}
    second = json.loads(json.dumps(request))
    if changed:
        second['tender']['cash_received_minor'] = '11000'
    a = b = None
    try:
        a, a_pid = connection()
        a.stdin.write(checkout(request) + "select 'HOLD';\n"); a.stdin.flush()
        first_receipt = None
        for line in a.stdout:
            if line.startswith('{'):
                first_receipt = json.loads(line)
            if line.strip() == 'HOLD':
                break
        assert first_receipt, 'First transaction did not complete checkout'
        b, b_pid = connection()
        b.stdin.write(checkout(second) + 'commit;\n'); b.stdin.flush()
        blocking = []
        for _ in range(100):
            blocking = json.loads(run(f'select array_to_json(pg_blocking_pids({b_pid}));'))
            if a_pid in blocking:
                break
            time.sleep(.05)
        assert a_pid in blocking, 'Required observed blocking absent'
        out_a, err_a = a.communicate('commit;\n', timeout=25)
        assert a.returncode == 0, err_a
        out_b, err_b = b.communicate(timeout=25)
        if changed:
            assert b.returncode != 0 and '23505' in err_b and 'IDEMPOTENCY_CONFLICT' in err_b, err_b
        else:
            assert b.returncode == 0, err_b
            replay = next(json.loads(line) for line in out_b.splitlines() if line.startswith('{'))
            assert replay == first_receipt, 'Concurrent exact replay changed receipt'
        purchase = first_receipt['purchase_id']
        assert run(f"select count(*) from public.purchases where request_key='{request['request_key']}';") == '1'
        assert run(f"select count(*) from public.purchase_tenders where purchase_id='{purchase}';") == '1'
        assert run(f"select count(*) from public.purchase_cash_tenders c join public.purchase_tenders t on t.id=c.tender_id where t.purchase_id='{purchase}';") == '1'
        assert run(f"select count(*) from public.purchase_items where purchase_id='{purchase}';") == '1'
        assert run(f"select count(*) from public.audit_events where target_id='{purchase}' and action='purchase_committed' and authenticated_user_id='{AUTH}' and sandbox_pov_session_id is not null;") == '1'
        assert run(f"select count(*) from public.wallet_purchase_debits where purchase_id='{purchase}';") == '0'
        assert run(f"select count(*) from public.student_daily_spend_events where purchase_id='{purchase}';") == '0'
        result = {'case': 'changed_payload_conflict' if changed else 'exact_replay', 'blocking_pids': blocking,
                  'blocked_pid': b_pid, 'holder_pid': a_pid, 'purchases': 1, 'cash_tenders': 1, 'audit_events': 1}
        print('PASS ' + json.dumps(result))
        return result
    finally:
        for p in (a, b):
            if p and p.poll() is None:
                p.communicate('rollback;\n', timeout=25)


def main():
    endpoint = os.environ.get('DOCKER_HOST') or subprocess.check_output([DOCKER, 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], text=True).strip()
    assert endpoint in {'unix:///var/run/docker.sock', 'unix://' + str(Path.home() / '.docker/run/docker.sock')}, 'Non-local Docker refused'
    assert subprocess.check_output([DOCKER, 'inspect', '--format', '{{index .Config.Labels "com.supabase.cli.project"}}', CONTAINER], text=True).strip() == 'pikas-4d6'
    assert run('select max(version) from supabase_migrations.schema_migrations;', 'postgres') == '202610120003'
    assert run(f"select tenant_kind from public.accounts where id='{ACCOUNT}';", 'postgres') == 'sandbox'
    assert run("select count(*) from public.register_sessions where register_id='4c000000-0000-4000-8000-000000000010' and status='open';") == '0', 'Preexisting open fixture session: stop'
    actor(f"select public.platform_enter_sandbox_pov('{uuid.uuid4()}','{ACCOUNT}','{CAF}','cashier');")
    opened = json.loads(actor(f"select to_jsonb(x) from public.open_register_session('4c000000-0000-4000-8000-000000000010','4c000000-0000-4000-8000-000000000011',0,'{uuid.uuid4()}') x;"))
    try:
        results = [race(opened['session_id'], False), race(opened['session_id'], True)]
        Path('/private/tmp/pikas-pos-anonymous-replays.json').write_text(json.dumps(results, indent=2) + '\n')
    finally:
        session_id = opened['session_id']
        total = run(f"select coalesce(sum(p.total_minor),0) from public.purchases p join public.purchase_tenders t on t.purchase_id=p.id where p.register_session_id='{session_id}' and t.tender_type='cash';")
        actor(f"select public.close_my_register_session('{session_id}',1,{total},'{uuid.uuid4()}');")
    print('PASS focused local replay cases; tagged purchases retained and own test register session closed.')


if __name__ == '__main__':
    main()
