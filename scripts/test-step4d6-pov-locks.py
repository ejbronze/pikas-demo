#!/usr/bin/env python3
"""Focused LOCAL ONLY races; real connections and pg_blocking_pids evidence.

Requires pikas-4d6 local project and restored Horizonte fixture. No remote URL
or target accepted. Failed commands must leave data, request journal and audit
unchanged. Reset/reload local fixtures after validation.
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
CMD = [DOCKER, 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres']
AUTH = 'ec08ad21-4020-4b0d-b041-ee4a1fe09471'
ACTOR = '82af93c4-730f-468c-9e4c-2c5238f226f1'
ACCOUNT = '03e71159-69e9-4387-9b3b-65799d49faf0'
SCHOOL = 'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488'
CAF = 'b9496342-5079-46ae-83b8-05c39bcbd7fe'


def run(sql):
    result = subprocess.run(CMD, input=sql, text=True, capture_output=True, timeout=35)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def auth(sql):
    return run(f"set request.jwt.claim.sub='{AUTH}';set role authenticated;" + sql)


def connect(sql):
    p = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    p.stdin.write("set statement_timeout='30s';" + sql + "\nselect 'READY:'||pg_backend_pid();\n")
    p.stdin.flush()
    for line in p.stdout:
        if line.startswith('READY:'):
            return p, int(line.split(':')[1])
    raise AssertionError(p.stderr.read())


def finish(p, sql=''):
    out, err = p.communicate(sql + '\n', timeout=35)
    return p.returncode, out, err


def preflight():
    endpoint = os.environ.get('DOCKER_HOST') or subprocess.check_output([DOCKER, 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], text=True).strip()
    if endpoint not in {'unix:///var/run/docker.sock', 'unix://' + str(Path.home() / '.docker/run/docker.sock')}:
        raise RuntimeError('Non-local Docker refused')
    label = subprocess.check_output([DOCKER, 'inspect', '--format', '{{index .Config.Labels "com.supabase.cli.project"}}', CONTAINER], text=True).strip()
    if label != 'pikas-4d6' or run('select max(version) from supabase_migrations.schema_migrations;') != '202610120002':
        raise RuntimeError('Wrong project/migration')


def new_pov(code, expiry=False):
    response = json.loads(auth(f"select public.platform_enter_sandbox_pov('{uuid.uuid4()}','{ACCOUNT}','{CAF}','{code}');"))
    if not expiry:
        return response['session_id']
    # Short-lived LOCAL test session, through the same immutable snapshot contract.
    return run(f"begin;update pikas_private.sandbox_pov_sessions set status='exited',ended_at=clock_timestamp(),end_reason='superseded' where id='{response['session_id']}';insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,persona_school_membership_id,expires_at) select '{uuid.uuid4()}',initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,persona_school_membership_id,clock_timestamp()+interval '3 seconds' from pikas_private.sandbox_pov_sessions where id='{response['session_id']}' returning id;commit;")


def race(code, change):
    school = code == 'school_admin'
    table = 'students' if school else 'cafeteria_products'
    target = '4c000000-0000-4000-8000-000000000201' if school else '4c000000-0000-4000-8000-000000000030'
    member = '4d600000-0000-4000-8000-000000000011' if school else '4d600000-0000-4000-8000-000000000012'
    member_table = 'school_memberships' if school else 'cafeteria_memberships'
    persona = '4d600000-0000-4000-8000-000000000021' if school else '4d600000-0000-4000-8000-000000000022'
    pov = new_pov(code, change == 'expiry')
    key = str(uuid.uuid4())
    snapshot = f"select to_jsonb(t) from public.{table} t where id='{target}';"
    before = run(snapshot)
    if school:
        command = f"select public.school_admin_command('{SCHOOL}','{key}','student_update','{{\"student_id\":\"{target}\",\"first_name\":\"Race\",\"last_name\":\"Denied\",\"student_code\":\"DEMO-HZ-001\"}}');"
    else:
        command = f"select public.cafeteria_admin_command('{CAF}','{key}','product_save','{{\"id\":\"{target}\",\"version\":1,\"name\":\"Race denied\",\"description\":\"local test\",\"category\":\"Bebidas\",\"price_minor\":2500,\"active\":true,\"available\":true,\"ingredients\":[],\"allergens\":[]}}');"
    if change == 'revocation':
        lock = f"update pikas_private.platform_memberships set status='suspended' where person_id='{ACTOR}' and role_code='platform_sandbox_operator';"
    elif change == 'persona':
        lock = f"update pikas_private.sandbox_pov_personas set status='inactive' where id='{persona}';"
    elif change == 'membership':
        lock = f"update public.{member_table} set status='suspended' where id='{member}';"
    else:
        lock = f"select id from public.{table} where id='{target}' for update;"
    holder = worker = None
    try:
        holder, holder_pid = connect('begin;' + lock)
        worker, worker_pid = connect(f"set request.jwt.claim.sub='{AUTH}';set role authenticated;")
        worker.stdin.write(command + '\n');worker.stdin.flush()
        deadline = time.monotonic() + 10
        while run(f"select {holder_pid}=any(pg_blocking_pids({worker_pid}));") != 't':
            if time.monotonic() > deadline or worker.poll() is not None:
                raise AssertionError('No actual blocking: ' + (worker.stderr.read() if worker.poll() is not None else 'timeout'))
            time.sleep(.04)
        if change in {'exit', 'switch'}:
            auth(f"select public.platform_exit_sandbox_pov('{uuid.uuid4()}');")
            if change == 'switch':
                new_pov('cafeteria_admin' if school else 'school_admin')
        elif change == 'expiry':
            while run(f"select expires_at<=clock_timestamp() from pikas_private.sandbox_pov_sessions where id='{pov}';") != 't':
                time.sleep(.05)
        assert finish(holder, 'commit;')[0] == 0
        status, _, err = finish(worker)
        assert status != 0 and '42501' in err, err
        assert run(snapshot) == before
        assert run(f"select count(*) from pikas_private.{'school' if school else 'cafeteria'}_admin_requests where request_id='{key}';") == '0'
        assert run(f"select count(*) from public.audit_events where request_id='{key}';") == '0'
        print(f'PASS {code}/{change}: pg_blocking_pids proved; 42501; data and request unchanged', flush=True)
    finally:
        for p in (worker, holder):
            if p is not None and p.poll() is None:
                p.kill();p.communicate(timeout=5)
    if change == 'revocation':
        run(f"update pikas_private.platform_memberships set status='active' where person_id='{ACTOR}' and role_code='platform_sandbox_operator';")
    elif change == 'membership':
        run(f"update public.{member_table} set status='active' where id='{member}';")



def main():
    preflight()
    for code in ('school_admin','cafeteria_admin'):
        for change in ('exit','switch','revocation','membership','expiry'):
            race(code, change)
    for code in ('school_admin','cafeteria_admin'):
        race(code, 'persona')
    print('12 focused races passed; 12 independent-session blocking proofs.')


if __name__ == '__main__':
    main()
