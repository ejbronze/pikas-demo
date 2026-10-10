#!/usr/bin/env python3
"""Local Docker only: real row-lock races for school authority and administrator grants.

Synthetic fixtures remain in the local database; reset locally after inspection.
No credentials, network database URLs or remote CLI commands are accepted.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

DOCKER = shutil.which("docker") or "/Applications/Docker.app/Contents/Resources/bin/docker"
CONTAINER = "supabase_db_pikas-foundation"
CMD = [DOCKER, "exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"]
SCHOOL = "00000000-0000-0000-0000-000000000011"
AUTH = "00000000-0000-0000-0000-000000002002"
MEMBER = "00000000-0000-0000-0000-000000003101"
IDENTITY = "4d2c0000-0000-4000-8000-000000000001"
REQUEST = "4d2c0000-0000-4000-8000-000000000002"
PREPARE = "4d2c0000-0000-4000-8000-000000000003"
REVOKED_REQUEST = "4d2c0000-0000-4000-8000-000000000004"


def run(sql):
    result = subprocess.run(CMD, input=sql, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def preflight():
    endpoint = os.environ.get("DOCKER_HOST") or subprocess.check_output([DOCKER, "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], text=True).strip()
    if endpoint not in {"unix:///var/run/docker.sock", "unix://" + str(Path.home() / ".docker/run/docker.sock")}:
        raise RuntimeError("Refusing non-local Docker")
    label = subprocess.check_output([DOCKER, "inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', CONTAINER], text=True).strip()
    if label != "pikas-foundation" or run("select max(version) from supabase_migrations.schema_migrations;") != "202610100002":
        raise RuntimeError("Unexpected local project/migration")
    if run(f"select exists(select 1 from auth.users where id='{IDENTITY}');") != "f":
        raise RuntimeError("Reset local fixtures before running this harness")


def connection(sql):
    process = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write("set statement_timeout='25s';\n" + sql + "\nselect 'READY:'||pg_backend_pid();\n")
    process.stdin.flush()
    for line in process.stdout:
        if line.startswith("READY:"):
            return process, int(line.split(":")[1])
    raise AssertionError(process.stderr.read())


def blocked(worker_pid, holder_pid):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if run(f"select {holder_pid}=any(pg_blocking_pids({worker_pid}));") == "t":
            return
        time.sleep(.04)
    raise AssertionError("Actual lock blocking was not observed")


def finish(process, statement=""):
    output, error = process.communicate(statement + "\n", timeout=30)
    return process.returncode, output.strip(), error


def stop(*processes):
    for process in processes:
        if process is not None and process.poll() is None:
            process.kill()
            process.communicate(timeout=10)


def auth_prefix():
    return f"set request.jwt.claim.sub='{AUTH}'; set role authenticated;"


def revocation_race():
    holder = worker = None
    try:
        holder, holder_pid = connection(f"begin; update public.school_memberships set status='suspended' where id='{MEMBER}';")
        worker, worker_pid = connection(auth_prefix())
        worker.stdin.write(f"select public.school_admin_command('{SCHOOL}','{REVOKED_REQUEST}','admin_prepare','{{\"email\":\"revoked@example.invalid\"}}');\n")
        worker.stdin.flush()
        blocked(worker_pid, holder_pid)
        assert finish(holder, "commit;")[0] == 0
        code, _, error = finish(worker)
        assert code != 0 and "42501" in error and "school_authority_required" in error, error
        assert run(f"select count(*) from pikas_private.school_admin_requests where request_id='{REVOKED_REQUEST}';") == "0"
        assert run(f"select count(*) from public.audit_events where request_id='{REVOKED_REQUEST}';") == "0"
        assert run("select count(*) from public.invitations where email_key='revoked@example.invalid';") == "0"
        print("PASS: committed revocation across the real membership lock denies mutation/journal/audit")
    finally:
        stop(holder, worker)
        run(f"update public.school_memberships set status='active' where id='{MEMBER}';")


def completion_race(change_identity=False):
    holder = first = second = None
    invitation = json.loads(run(auth_prefix() + f"select public.school_admin_command('{SCHOOL}','{PREPARE}','admin_prepare','{{\"email\":\"4d2-race@example.invalid\"}}');"))["invitation_id"]
    payload = json.dumps({"invitation_id": invitation, "display_name": "Synthetic concurrent administrator"})
    command = f"select public.school_admin_command('{SCHOOL}','{REQUEST}','admin_complete','{payload}');\n"
    try:
        holder, holder_pid = connection(f"begin; select id from auth.users where id='{IDENTITY}' for update;")
        first, first_pid = connection(auth_prefix())
        first.stdin.write(command); first.stdin.flush()
        blocked(first_pid, holder_pid)
        if change_identity:
            assert finish(holder, f"update auth.users set email='changed-identity@example.invalid' where id='{IDENTITY}'; commit;")[0] == 0
            code, _, error = finish(first)
            assert code != 0 and "confirmed_identity_pending" in error, error
            assert run(f"select count(*) from public.persons where auth_user_id='{IDENTITY}';") == "0"
            assert run(f"select count(*) from public.audit_events where request_id='{REQUEST}';") == "0"
            run(f"update auth.users set email='4d2-race@example.invalid' where id='{IDENTITY}';")
            print("PASS: identity email changed across the Auth row lock cannot grant/link")
            return
        second, second_pid = connection(auth_prefix())
        second.stdin.write(command); second.stdin.flush()
        blocked(second_pid, first_pid)
        assert finish(holder, "commit;")[0] == 0
        code1, out1, error1 = finish(first)
        code2, out2, error2 = finish(second)
        assert code1 == code2 == 0, error1 + error2
        assert json.loads(out1) == json.loads(out2)
        assert run(f"select count(*) from public.persons where auth_user_id='{IDENTITY}';") == "1"
        assert run(f"select count(*) from public.school_memberships m join public.persons p on p.id=m.person_id where p.auth_user_id='{IDENTITY}' and m.school_id='{SCHOOL}' and m.role_code='school_admin';") == "1"
        assert run(f"select count(*) from public.audit_events where request_id='{REQUEST}';") == "1"
        print("PASS: concurrent completion with the same key yields one Person, membership and audit")
    finally:
        stop(holder, first, second)


if __name__ == "__main__":
    preflight()
    revocation_race()
    run(f"insert into auth.users(id,aud,role,email,confirmed_at) values('{IDENTITY}','authenticated','authenticated','4d2-race@example.invalid',now());")
    completion_race(change_identity=True)
    completion_race()
    print("3 real concurrency cases passed; pg_blocking_pids verified each boundary")
