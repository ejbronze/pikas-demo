#!/usr/bin/env python3
"""Race Phase 4C register-session RPCs against the local foundation database only."""

from __future__ import annotations

import concurrent.futures
import shutil
import subprocess
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "supabase_db_pikas-foundation"
PROJECT_LABEL = "com.supabase.cli.project"
PHASE_4C_VERSION = "202610030001"
ITERATIONS = 10

AUTH_CASHIER = "00000000-0000-0000-0000-000000002008"
AUTH_SUPERVISOR = "00000000-0000-0000-0000-000000002011"
REGISTER_ONE = "00000000-0000-0000-0000-000000009401"
REGISTER_TWO = "00000000-0000-0000-0000-000000009402"
ASSIGNMENT_ONE = "00000000-0000-0000-0000-000000009501"
ASSIGNMENT_TWO = "00000000-0000-0000-0000-000000009502"
SUPERVISOR_ASSIGNMENT = "00000000-0000-0000-0000-000000009503"
CAFETERIA = "00000000-0000-0000-0000-000000000111"


def docker_path() -> str:
    installed = shutil.which("docker")
    desktop = Path("/Applications/Docker.app/Contents/Resources/bin/docker")
    if installed:
        return installed
    if desktop.is_file():
        return str(desktop)
    raise RuntimeError("Docker CLI is unavailable; no database connection was attempted.")


DOCKER = docker_path()


def docker_run(arguments: list[str], *, input_text: str | None = None, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [DOCKER, *arguments],
        input=input_text,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def verify_local_target() -> None:
    inspect = docker_run(
        ["inspect", "--format", f"{{{{index .Config.Labels \"{PROJECT_LABEL}\"}}}}", CONTAINER]
    )
    if inspect.returncode or inspect.stdout.strip() != "pikas-foundation":
        raise RuntimeError("Refusing race tests: target is not the local pikas-foundation container.")
    version = query("select version from supabase_migrations.schema_migrations order by version desc limit 1;")
    if version != PHASE_4C_VERSION:
        raise RuntimeError(f"Refusing race tests: expected local migration {PHASE_4C_VERSION}, got {version!r}.")
    sessions = query("select count(*) from public.register_sessions;")
    if sessions != "0":
        raise RuntimeError("Refusing race tests: local register_sessions is not empty; reset the local project first.")
    fixtures = query(
        "select ("
        "exists(select 1 from public.cafeteria_register_assignments where id='00000000-0000-0000-0000-000000009501') "
        "and exists(select 1 from public.cafeteria_register_assignments where id='00000000-0000-0000-0000-000000009503')"
        ");"
    )
    if fixtures != "t":
        raise RuntimeError("Refusing race tests: expected synthetic cashier/supervisor assignments are missing.")


def query(sql: str) -> str:
    result = docker_run(
        ["exec", CONTAINER, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", sql]
    )
    if result.returncode:
        raise RuntimeError(f"Local SQL probe failed: {result.stderr.strip()}")
    return result.stdout.strip()


def psql_arguments() -> list[str]:
    return ["exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"]


def worker_sql(auth_id: str, operation_sql: str) -> str:
    return (
        "begin;\n"
        f"set local request.jwt.claim.sub='{auth_id}';\n"
        "set local role authenticated;\n"
        # Both independent DB transactions remain active together before entering the RPC.
        "select pg_catalog.pg_sleep(0.08);\n"
        f"{operation_sql}\n"
        "commit;\n"
    )


def run_worker(auth_id: str, operation_sql: str, barrier: threading.Barrier) -> subprocess.CompletedProcess[str]:
    barrier.wait(timeout=10)
    return docker_run(psql_arguments(), input_text=worker_sql(auth_id, operation_sql), timeout=30)


def race(first: tuple[str, str], second: tuple[str, str]) -> tuple[list[subprocess.CompletedProcess[str]], list[str]]:
    barrier = threading.Barrier(3)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        first_future = pool.submit(run_worker, first[0], first[1], barrier)
        second_future = pool.submit(run_worker, second[0], second[1], barrier)
        barrier.wait(timeout=10)
        outcomes = [first_future.result(timeout=35), second_future.result(timeout=35)]
    successful = [result.stdout.strip().splitlines()[-1] for result in outcomes if result.returncode == 0 and result.stdout.strip()]
    failures = [result.stderr for result in outcomes if result.returncode != 0]
    if len(successful) != 1 or len(failures) != 1:
        detail = "\n".join(result.stderr or result.stdout for result in outcomes)
        raise AssertionError(f"Expected exactly one concurrent winner and one loser. Outcomes:\n{detail}")
    if "23505" not in failures[0]:
        raise AssertionError(f"Expected deterministic unique/open-session conflict (SQLSTATE 23505), got:\n{failures[0]}")
    return outcomes, successful


def result_session_id(result_line: str) -> str:
    value = result_line.split("|")[0].strip()
    if len(value) != 36:
        raise AssertionError(f"Unexpected RPC return row: {result_line!r}")
    return value


def open_statement(register_id: str, assignment_id: str, request_key: str) -> str:
    return (
        "select session_id::text || '|' || status from public.open_register_session("
        f"'{register_id}','{assignment_id}',0,'{request_key}');"
    )


def close_owner(session_id: str, operator_auth_id: str, race_name: str, iteration: int) -> None:
    result = docker_run(
        psql_arguments(),
        input_text=worker_sql(
            operator_auth_id,
            "select session_id::text || '|' || status from public.close_my_register_session("
            f"'{session_id}',1,0,'race-owner-close-{race_name}-{iteration:03d}');",
        ),
        timeout=30,
    )
    if result.returncode:
        raise AssertionError(f"Winning session could not be normally closed: {result.stderr.strip()}")


def open_race(iteration: int, same_register: bool) -> None:
    suffix = f"{iteration:03d}"
    if same_register:
        first = (AUTH_CASHIER, open_statement(REGISTER_ONE, ASSIGNMENT_ONE, f"race-same-register-cashier-{suffix}"))
        second = (AUTH_SUPERVISOR, open_statement(REGISTER_ONE, SUPERVISOR_ASSIGNMENT, f"race-same-register-supervisor-{suffix}"))
        race_name = "same-register-open"
    else:
        first = (AUTH_CASHIER, open_statement(REGISTER_ONE, ASSIGNMENT_ONE, f"race-same-operator-register-one-{suffix}"))
        second = (AUTH_CASHIER, open_statement(REGISTER_TWO, ASSIGNMENT_TWO, f"race-same-operator-register-two-{suffix}"))
        race_name = "same-operator-two-registers"
    outcomes, _ = race(first, second)
    invariant = "register_id" if same_register else "operator_person_id"
    identity = REGISTER_ONE if same_register else "00000000-0000-0000-0000-000000001008"
    open_count = query(
        f"select count(*) from public.register_sessions where status='open' and {invariant}='{identity}';"
    )
    all_open_count = query("select count(*) from public.register_sessions where status='open';")
    if open_count != "1" or all_open_count != "1":
        raise AssertionError(f"{race_name} left unexpected open-session state: target={open_count}, all={all_open_count}")
    winner_index = next(index for index, result in enumerate(outcomes) if result.returncode == 0)
    winner = outcomes[winner_index].stdout.strip().splitlines()[-1]
    session_id = result_session_id(winner)
    winner_auth_id = first[0] if winner_index == 0 else second[0]
    close_owner(session_id, winner_auth_id, race_name, iteration)
    print(f"{race_name} iteration {iteration + 1}: one open committed; loser received SQLSTATE 23505; winner closed")


def close_race(iteration: int) -> None:
    suffix = f"{iteration:03d}"
    opened = docker_run(
        psql_arguments(),
        input_text=worker_sql(AUTH_CASHIER,
            "select session_id::text || '|' || status from public.open_register_session("
            f"'{REGISTER_ONE}','{ASSIGNMENT_ONE}',0,'race-close-open-{suffix}');"),
        timeout=30,
    )
    if opened.returncode:
        raise AssertionError(f"Could not create race fixture session: {opened.stderr.strip()}")
    session_id = result_session_id(opened.stdout.strip().splitlines()[-1])
    normal = (AUTH_CASHIER,
        "select session_id::text || '|' || close_type from public.close_my_register_session("
        f"'{session_id}',1,0,'race-normal-close-{suffix}');")
    exceptional = (AUTH_SUPERVISOR,
        "select session_id::text || '|' || close_type from public.exceptionally_close_register_session("
        f"'{session_id}',1,0,'administrative_recovery',null,'race-exceptional-close-{suffix}');")
    outcomes, successful = race(normal, exceptional)
    owner_result = query(
        "select status || '|' || close_type || '|' || operator_person_id::text || '|' || "
        "closed_by_person_id::text || '|' || coalesce(close_reason_code,'<null>') || '|' || counted_cash_minor::text "
        f"from public.register_sessions where id='{session_id}';"
    )
    fields = owner_result.split("|")
    if len(fields) != 6 or fields[0] != "closed" or fields[2] != "00000000-0000-0000-0000-000000001008":
        raise AssertionError(f"Session did not reach exactly one terminal state: {owner_result}")
    if fields[1] == "normal":
        expected = ["normal", "00000000-0000-0000-0000-000000001008",
            "00000000-0000-0000-0000-000000001008", "<null>", "0"]
    elif fields[1] == "exceptional":
        expected = ["exceptional", "00000000-0000-0000-0000-000000001008",
            "00000000-0000-0000-0000-000000001011", "administrative_recovery", "0"]
    else:
        raise AssertionError(f"Unknown close type in terminal evidence: {owner_result}")
    if fields[1:] != expected:
        raise AssertionError(f"Close winner produced hybrid or unexpected evidence: {owner_result}")
    if len(successful) != 1 or len([r for r in outcomes if r.returncode != 0]) != 1:
        raise AssertionError("Normal and exceptional close did not yield exactly one winner.")
    print(f"normal-vs-exceptional-close iteration {iteration + 1}: {owner_result}; one terminal transition")


def main() -> None:
    verify_local_target()
    print(f"Verified local container {CONTAINER}, Phase 4C migration {PHASE_4C_VERSION}, zero existing sessions.")
    for iteration in range(ITERATIONS):
        open_race(iteration, same_register=True)
        open_race(iteration, same_register=False)
        close_race(iteration)
    remaining = query("select count(*) from public.register_sessions where status='open';")
    if remaining != "0":
        raise AssertionError(f"Race harness left {remaining} open register sessions.")
    print(f"All three races passed {ITERATIONS} iterations each (30 independent-session races); no open sessions remain.")
    print("This harness leaves closed synthetic race sessions; run scripts/db-foundation.sh reset afterward.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(f"Phase 4C local race tests failed: {error}") from error