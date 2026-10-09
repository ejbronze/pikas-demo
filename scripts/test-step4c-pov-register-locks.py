#!/usr/bin/env python3
"""Local-only regression: delegated register authority must survive the actual lock boundary.

Requires clean local foundation fixtures, seeds synthetic Step 4C identities, and leaves those
fixtures for inspection. Run scripts/db-foundation.sh reset afterward; never targets a remote DB.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "supabase_db_pikas-foundation"
DOCKER = shutil.which("docker") or "/Applications/Docker.app/Contents/Resources/bin/docker"
AUTH = "ec08ad21-4020-4b0d-b041-ee4a1fe09471"
PERSON = "6c000000-0000-4000-8000-000000000001"
MEMBER = "6c000000-0000-4000-8000-000000000002"
ACCOUNT = "03e71159-69e9-4387-9b3b-65799d49faf0"
CAFETERIA = "b9496342-5079-46ae-83b8-05c39bcbd7fe"
REGISTER = "4c000000-0000-4000-8000-000000000010"
ASSIGNMENT = "4c000000-0000-4000-8000-000000000011"
COMMAND = [DOCKER, "exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"]


def run(sql: str) -> str:
    result = subprocess.run(COMMAND, input=sql, capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise AssertionError(result.stderr.strip())
    return result.stdout.strip()


def auth(sql: str, user: str = AUTH) -> str:
    return run(f"set request.jwt.claim.sub='{user}'; set role authenticated; {sql}")


def local_preflight() -> None:
    endpoint = os.environ.get("DOCKER_HOST")
    if not endpoint:
        endpoint = subprocess.check_output([DOCKER, "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], text=True).strip()
    if endpoint not in {"unix:///var/run/docker.sock", "unix://" + str(Path.home() / ".docker/run/docker.sock")}:
        raise RuntimeError("Refusing non-local Docker endpoint")
    label = subprocess.check_output([DOCKER, "inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', CONTAINER], text=True).strip()
    if label != "pikas-foundation" or run("select max(version) from supabase_migrations.schema_migrations;") != "202610090006":
        raise RuntimeError("Refusing unexpected local project/migration")
    clean = run(f"select not exists(select 1 from public.register_sessions) and not exists(select 1 from public.purchases) and not exists(select 1 from pikas_private.sandbox_pov_sessions) and not exists(select 1 from public.accounts where id='{ACCOUNT}') and not exists(select 1 from public.persons where id='{PERSON}');")
    if clean != "t":
        raise RuntimeError("Clean-reset local fixtures required; no setup was performed")


def fixture_setup() -> None:
    # Reuse the exact synthetic identities and unchanged bootstrap exercised by pgTAP.
    test = (ROOT / "supabase/tests/step4c_pilot_ready.test.sql").read_text()
    fixture = test.split("-- Synthetic fixture identities only;", 1)[1].split("create temp table before_bootstrap", 1)[0]
    fixture = fixture[fixture.index("insert into auth.users"):]
    migration = (ROOT / "supabase/migrations/202610090006_horizonte_pilot_ready.sql").read_text()
    bootstrap = migration[migration.index("do $bootstrap$"):migration.index("$bootstrap$;", migration.index("do $bootstrap$")) + len("$bootstrap$;")]
    run("begin;\n" + fixture + bootstrap + "\ncommit;")


def new_pov(expiring: bool) -> str:
    run(f"update pikas_private.sandbox_pov_sessions set status='exited',ended_at=clock_timestamp(),end_reason='exited' where initiator_auth_user_id='{AUTH}' and status='active'; update public.cafeteria_memberships set status='active' where id='{MEMBER}';")
    if not expiring:
        response = json.loads(auth(f"select public.platform_enter_sandbox_pov('{uuid.uuid4()}','{ACCOUNT}','{CAFETERIA}','cashier');"))
        return response["session_id"]
    # Only the rolled-forward local test fixture has a short lifetime; production contracts unchanged.
    return run(f"insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,expires_at) select '{uuid.uuid4()}', '82af93c4-730f-468c-9e4c-2c5238f226f1','{AUTH}',account_id,school_id,cafeteria_id,pov_code,id,person_id,cafeteria_membership_id,clock_timestamp()+interval '20 seconds' from pikas_private.sandbox_pov_personas where person_id='{PERSON}' returning id;")


def handshake(process: subprocess.Popen[str]) -> int:
    for line in process.stdout:
        if line.startswith("READY:"):
            return int(line.strip().split(":")[1])
    raise AssertionError("Lock holder failed: " + process.stderr.read())


def register_race(lock: str, change: str, ordinary: bool = False, opening: bool = False) -> None:
    user = "00000000-0000-0000-0000-000000002008" if ordinary else AUTH
    register = "00000000-0000-0000-0000-000000009401" if ordinary else REGISTER
    assignment = "00000000-0000-0000-0000-000000009501" if ordinary else ASSIGNMENT
    pov = None if ordinary else new_pov(change == "expire")
    session = None if opening else auth(f"select session_id from public.open_register_session('{register}','{assignment}',0,'{uuid.uuid4()}');", user)
    snapshot_sql = f"select coalesce(jsonb_agg(to_jsonb(rs) order by id),'[]'::jsonb) from public.register_sessions rs where register_id='{register}';" if opening else f"select to_jsonb(rs) from public.register_sessions rs where id='{session}';"
    before = run(snapshot_sql)
    audit_sql = "select count(*) from public.audit_events where action='register_session_opened';" if opening else "select count(*) from public.audit_events where action='register_session_closed';"
    audit_before = run(audit_sql)
    links_before = run("select count(*) from pikas_private.sandbox_pov_operation_links;")
    actor = PERSON if opening else json.loads(before)["operator_person_id"]
    statement = {"advisory": f"select pg_advisory_xact_lock(hashtextextended('{actor}',20261005));",
                 "register": f"select id from public.cafeteria_registers where id='{register}' for update;",
                 "session": f"select id from public.register_sessions where id='{session}' for update;"}[lock]
    holder = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    worker = None
    try:
        holder.stdin.write("begin; set statement_timeout='45s';\n" + statement + "\nselect 'READY:'||pg_backend_pid();\n")
        holder.stdin.flush()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            holder_pid = pool.submit(handshake, holder).result(timeout=25)
        name = "step4c-lock-" + str(uuid.uuid4())
        key = str(uuid.uuid4())
        worker = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        operation = f"select * from public.open_register_session('{register}','{assignment}',0,'{key}');" if opening else f"select * from public.close_my_register_session('{session}',1,0,'{key}');"
        worker.stdin.write(f"set application_name='{name}'; set statement_timeout='45s'; set request.jwt.claim.sub='{user}'; set role authenticated; " + operation)
        worker.stdin.close(); worker.stdin = None
        deadline = time.monotonic() + 15
        while run(f"select count(*) from pg_stat_activity where application_name='{name}' and {holder_pid}=any(pg_blocking_pids(pid));") != "1":
            if time.monotonic() >= deadline or worker.poll() is not None:
                raise AssertionError("No real register/session lock overlap proved")
            time.sleep(0.05)
        # Ensure the delegated actor was valid when the request reached the proven wait.
        if not ordinary:
            assert auth("select public.platform_get_active_sandbox_pov()->>'session_id';") == pov
        if change == "expire":
            while run(f"select expires_at<=clock_timestamp() from pikas_private.sandbox_pov_sessions where id='{pov}';") != "t":
                time.sleep(0.1)
        elif change in {"exit", "replace"}:
            auth(f"select public.platform_exit_sandbox_pov('{uuid.uuid4()}');")
            if change == "replace":
                replacement = json.loads(auth(f"select public.platform_enter_sandbox_pov('{uuid.uuid4()}','{ACCOUNT}','{CAFETERIA}','cashier');"))
                assert replacement["session_id"] != pov
        elif change == "membership":
            run(f"update public.cafeteria_memberships set status='inactive' where id='{MEMBER}';")
        elif change == "ordinary_assignment":
            run(f"update public.cafeteria_register_assignments set status='inactive',version=version+1 where id='{assignment}';")
        holder.stdin.write("commit;\n"); holder.stdin.close(); holder.stdin = None
        holder.communicate(timeout=25)
        output, error = worker.communicate(timeout=25)
        denied = change in {"expire", "exit", "replace", "membership"}
        if denied:
            assert worker.returncode != 0 and "42501" in error and ("active_pos_session_open_capability_required" if opening else "not_authorized") in error, (output, error)
            assert run(snapshot_sql) == before
            assert run(audit_sql) == audit_before
            assert run("select count(*) from pikas_private.sandbox_pov_operation_links;") == links_before
            # Keep subsequent cases independent: close only with a newly authorized, explicit request.
            if not opening:
                new_pov(False)
                auth(f"select * from public.close_my_register_session('{session}',1,0,'{uuid.uuid4()}');")
        else:
            assert worker.returncode == 0, error
            assert run(f"select status||':'||version from public.register_sessions where id='{session}';") == "closed:2"
            assert run(f"select counted_cash_minor=0 and close_request_key='{key}' from public.register_sessions where id='{session}';") == "t"
        print(f"PASS {'open' if opening else 'close'}/{lock}/{change}: pg_blocking_pids overlap proved; {'42501, unchanged session/audit/link state' if denied else 'authorized close preserved'}", flush=True)
    finally:
        for process in (worker, holder):
            if process is not None and process.poll() is None:
                process.kill(); process.communicate(timeout=10)


def main() -> None:
    local_preflight()
    fixture_setup()
    for lock, change in [("advisory", "expire"), ("register", "expire"), ("register", "exit"),
                         ("session", "replace"), ("session", "membership"), ("session", "unchanged")]:
        register_race(lock, change)
    register_race("register", "ordinary_assignment", ordinary=True)
    register_race("register", "exit", opening=True)
    register_race("register", "replace", opening=True)
    print("9 independent-session regressions passed; 9 observed blocking proofs. Reset the local DB afterward.")


if __name__ == "__main__":
    main()
