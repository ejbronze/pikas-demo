#!/usr/bin/env python3
"""LOCAL ONLY: focused application-session races with observed PostgreSQL blocking.
No reset, production URL, financial write, or membership mutation is supported.
"""
import json
import subprocess
import time
import uuid

DOCKER = '/Applications/Docker.app/Contents/Resources/bin/docker'
CONTAINER = 'supabase_db_pikas-4d6'
CMD = [DOCKER, 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres']


def sql(text):
    p = subprocess.run(CMD, input=text, text=True, capture_output=True, timeout=20)
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


label = subprocess.check_output([DOCKER, 'inspect', '--format', '{{index .Config.Labels "com.supabase.cli.project"}}', CONTAINER], text=True).strip()
assert label == 'pikas-4d6'
uid = sql("select auth_user_id from persons where id='4d6b0000-0000-4000-8000-000000000001'")
assert str(uuid.UUID(uid)) == uid


def connection(sid):
    p = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    claims = json.dumps({'sub': uid, 'role': 'authenticated', 'session_id': sid})
    p.stdin.write(f"begin;set local statement_timeout='15s';set local request.jwt.claims='{claims}';select 'READY:'||pg_backend_pid();\n")
    p.stdin.flush()
    for line in p.stdout:
        if line.startswith('READY:'):
            return p, int(line.split(':')[1])
    raise AssertionError(p.stderr.read())


def write(p, text):
    p.stdin.write(text + '\n')
    p.stdin.flush()


def hold(p):
    for line in p.stdout:
        if line.strip() == 'HOLD':
            return
    raise AssertionError(p.stderr.read())


def blocked(pid, owner):
    for _ in range(100):
        if sql(f"select {owner}=any(pg_blocking_pids({pid}))") == 't':
            return
        time.sleep(.03)
    raise AssertionError('No observed blocking')


def finish(p):
    p.stdin.close()
    p.wait(timeout=20)
    return p.returncode, p.stdout.read(), p.stderr.read()


for case in ['two_activity', 'expires_while_waiting', 'logout_wins', 'pos_policy']:
    sid = str(uuid.uuid4())
    a = b = None
    try:
        sql(f"insert into auth.sessions(id,user_id,created_at,updated_at) values('{sid}','{uid}',clock_timestamp(),clock_timestamp());insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) select id,user_id,created_at,created_at from auth.sessions where id='{sid}';")
        started = sql(f"select started_at from pikas_private.application_sessions where session_id='{sid}'")
        if case == 'expires_while_waiting':
            sql(f"update pikas_private.application_sessions set started_at=clock_timestamp()-interval '1 hour',last_active_at=clock_timestamp()-interval '30 minutes'+interval '1 second' where session_id='{sid}'")
        a, apid = connection(sid)
        if case == 'logout_wins':
            write(a, f"set local role authenticated;select public.pikas_session_end('{sid}');select 'HOLD';")
        elif case == 'expires_while_waiting':
            write(a, f"select 1 from pikas_private.application_sessions where session_id='{sid}' for update;select 'HOLD';")
        else:
            write(a, f"set local role authenticated;select public.pikas_session_activity('{sid}');select 'HOLD';")
        hold(a)
        b, bpid = connection(sid)
        operation = f"public.pikas_session_status('{sid}',true)" if case == 'pos_policy' else f"public.pikas_session_activity('{sid}')"
        write(b, f"set local role authenticated;select {operation};commit;")
        blocked(bpid, apid)
        if case == 'expires_while_waiting':
            while sql(f"select clock_timestamp()>=last_active_at+interval '30 minutes' from pikas_private.application_sessions where session_id='{sid}'") != 't':
                time.sleep(.03)
        write(a, 'commit;')
        assert finish(a)[0] == 0
        code, out, err = finish(b)
        if case in ['expires_while_waiting', 'logout_wins']:
            assert code != 0 and '42501' in err and 'application_session_expired' in err, err
        else:
            assert code == 0, err
            final = json.loads(sql(f"select row_to_json(s) from pikas_private.application_sessions s where session_id='{sid}'"))
            assert sql(f"select started_at from pikas_private.application_sessions where session_id='{sid}'") == started
            assert final['idle_seconds'] == (900 if case == 'pos_policy' else 1800)
            assert sql(f"select last_active_at<=clock_timestamp() and last_active_at>=started_at from pikas_private.application_sessions where session_id='{sid}'") == 't'
        print(f'PASS {case}: pg_blocking_pids({bpid}) observed owner {apid}; deadlines/expiry preserved')
    finally:
        for p in [a, b]:
            if p and p.poll() is None:
                p.kill()
                p.wait()
        sql(f"delete from auth.sessions where id='{sid}' and user_id='{uid}'")
print('PASS 4/4 application-session race cases')
