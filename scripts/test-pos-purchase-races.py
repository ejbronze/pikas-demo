#!/usr/bin/env python3
"""Run Phase 3B financial races against the local pikas-foundation DB only."""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

CONTAINER = "supabase_db_pikas-foundation"
PROJECT_LABEL = "com.supabase.cli.project"
PHASE_3B = "202610040001"
ITERATIONS = 10

ADMIN = "00000000-0000-0000-0000-000000002003"
SCHOOL_ADMIN = "00000000-0000-0000-0000-000000002002"
CASHIER = "00000000-0000-0000-0000-000000002008"
SUPERVISOR = "00000000-0000-0000-0000-000000002011"
CASHIER_PERSON = "00000000-0000-0000-0000-000000001008"
CAFETERIA = "00000000-0000-0000-0000-000000000111"
STUDENT = "00000000-0000-0000-0000-000000005201"
CUSTOMER = "00000000-0000-0000-0000-000000006901"
WALLET = "00000000-0000-0000-0000-000000007001"
REGISTER_A = "00000000-0000-0000-0000-000000009401"
REGISTER_B = "00000000-0000-0000-0000-000000009402"
ASSIGNMENT_A = "00000000-0000-0000-0000-000000009501"
ASSIGNMENT_SUPERVISOR_A = "00000000-0000-0000-0000-000000009503"
ASSIGNMENT_SUPERVISOR_B = "00000000-0000-0000-0000-000000009512"
PRODUCT = "00000000-0000-0000-0000-000000008101"
CATEGORY = "00000000-0000-0000-0000-000000008001"
BASE_PRICE = 5000


def docker_path() -> str:
    installed = shutil.which("docker")
    desktop = Path("/Applications/Docker.app/Contents/Resources/bin/docker")
    if installed:
        return installed
    if desktop.is_file():
        return str(desktop)
    raise RuntimeError("Docker CLI unavailable; no database connection attempted.")


DOCKER = docker_path()


def run_docker(args: list[str], *, sql: str | None = None, timeout: int = 40) -> subprocess.CompletedProcess[str]:
    return subprocess.run([DOCKER, *args], input=sql, text=True, capture_output=True,
                          timeout=timeout, check=False)


def psql_args() -> list[str]:
    return ["exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
            "-v", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"]


def query(sql: str) -> str:
    result = run_docker(["exec", CONTAINER, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
                         "-U", "postgres", "-d", "postgres", "-c", sql])
    if result.returncode:
        raise RuntimeError(f"Local SQL probe failed: {result.stderr.strip()}")
    return result.stdout.strip()


def verify_local_db() -> None:
    override = os.environ.get('DOCKER_HOST')
    endpoint = override
    if not endpoint:
        context = run_docker(['context','inspect','--format','{{.Endpoints.docker.Host}}'])
        if context.returncode:
            raise RuntimeError('Refusing tests: cannot verify Docker endpoint.')
        endpoint = context.stdout.strip()
    allowed_endpoints = {'unix:///var/run/docker.sock',
        'unix://' + str(Path.home() / '.docker/run/docker.sock')}
    if endpoint not in allowed_endpoints:
        raise RuntimeError('Refusing tests: Docker endpoint is not an allowlisted local Unix socket.')
    inspected = run_docker(["inspect", "--format", f"{{{{index .Config.Labels \"{PROJECT_LABEL}\"}}}}", CONTAINER])
    if inspected.returncode or inspected.stdout.strip() != "pikas-foundation":
        raise RuntimeError("Refusing tests: target is not the local pikas-foundation container.")
    version = query("select version from supabase_migrations.schema_migrations order by version desc limit 1;")
    if version != PHASE_3B:
        raise RuntimeError(f"Refusing tests: expected migration {PHASE_3B}, got {version!r}.")
    for table in ("purchases", "purchase_items", "purchase_tenders", "purchase_cash_tenders",
                  "purchase_wallet_tenders", "wallet_purchase_debits", "student_daily_spend_events", "register_sessions"):
        if query(f"select count(*) from public.{table};") != "0":
            raise RuntimeError(f"Refusing tests: {table} is not empty; clean-reset the local project first.")
    if query("select count(*) from public.register_sessions where status='open';") != "0":
        raise RuntimeError("Refusing tests: an open session exists; clean-reset the local project first.")
    if query(f"select current_balance_minor from public.student_wallets where id='{WALLET}';") != "0":
        raise RuntimeError("Refusing tests: synthetic wallet is not at its clean zero balance.")
    if query(f"select count(*) from public.wallet_ledger_entries where wallet_id='{WALLET}';") != "0":
        raise RuntimeError("Refusing tests: synthetic wallet history exists; reset the local project first.")
    if query(f"select count(*) from public.student_spending_controls where student_id='{STUDENT}';") != "0":
        raise RuntimeError("Refusing tests: synthetic spending control exists; reset the local project first.")
    if query(f"select count(*) from public.student_daily_spend_events where student_id='{STUDENT}';") != "0":
        raise RuntimeError("Refusing tests: synthetic daily usage exists; reset the local project first.")
    clean = query(f"select (exists(select 1 from public.cafeteria_operation_settings where cafeteria_id='{CAFETERIA}' and not scheduling_enabled) "
        f"and exists(select 1 from public.cafeteria_products where id='{PRODUCT}' and version=1 and price_minor={BASE_PRICE} and active and available) "
        "and not exists(select 1 from public.cafeteria_purchase_counters where last_purchase_number<>0));")
    if clean != 't':
        raise RuntimeError('Refusing tests: settings, product or counter differ from clean fixtures.')
    fixtures = query(
        "select (exists(select 1 from public.cafeteria_register_assignments where id='" + ASSIGNMENT_A + "') "
        "and exists(select 1 from public.cafeteria_register_assignments where id='" + ASSIGNMENT_SUPERVISOR_A + "') "
        "and exists(select 1 from public.student_wallets where id='" + WALLET + "') "
        "and exists(select 1 from public.cafeteria_customers where id='" + CUSTOMER + "'));"
    )
    if fixtures != "t":
        raise RuntimeError("Refusing tests: required synthetic Phase 3B fixtures are missing.")


def transaction_sql(auth_id: str, statement: str, delay: float = 0.08) -> str:
    return ("begin;\n" + f"set local request.jwt.claim.sub='{auth_id}';\n" +
            "set local role authenticated;\n" + f"select pg_catalog.pg_sleep({delay});\n" +
            statement + "\ncommit;\n")


RACE_SERIAL = 0
BLOCKING_PROOFS = 0


def race(a: tuple[str, str], b: tuple[str, str]) -> list[subprocess.CompletedProcess[str]]:
    """Hold the first real RPC uncommitted; prove the second backend waits on it.

    Alternate winners. The stdin handshake holds real financial/operational locks,
    not a sleep pretending to be overlap. PostgreSQL supplies the blocking proof.
    """
    global RACE_SERIAL, BLOCKING_PROOFS
    RACE_SERIAL += 1
    leader_index = RACE_SERIAL % 2
    calls = [a, b]
    leader_auth, leader_stmt = calls[leader_index]
    follower_auth, follower_stmt = calls[1 - leader_index]
    label = f"p3b-race-{RACE_SERIAL}"
    command = [DOCKER, *psql_args()]
    leader = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, bufsize=1)
    leader_lines = []
    follower = None
    try:
        leader.stdin.write("begin;\nset local statement_timeout='15s';\n" +
            f"set local request.jwt.claim.sub='{leader_auth}';\nset local role authenticated;\n" +
            leader_stmt + "\nselect 'READY:'||pg_backend_pid();\n")
        leader.stdin.flush()
        def ready():
            for line in leader.stdout:
                leader_lines.append(line)
                if line.startswith("READY:"):
                    return int(line.strip().split(":")[1])
            raise AssertionError("Leader RPC failed before overlap handshake: " + leader.stderr.read())
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            leader_pid = pool.submit(ready).result(timeout=20)
        follower = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True)
        follower.stdin.write(f"set application_name='{label}';\n" +
            transaction_sql(follower_auth, "set local statement_timeout='15s';\n" + follower_stmt, 0))
        follower.stdin.close()
        follower.stdin = None
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            proof = query("select count(*) from pg_stat_activity where application_name='" + label +
                          f"' and {leader_pid}=any(pg_blocking_pids(pid));")
            if proof == "1":
                BLOCKING_PROOFS += 1
                break
            if follower.poll() is not None:
                raise AssertionError("Contender finished without the required database blocking proof")
            time.sleep(0.02)
        else:
            raise AssertionError("No independent-backend blocking proof before deadline")
        leader.stdin.write("commit;\n")
        leader.stdin.close()
        leader.stdin = None
        leader_out, leader_err = leader.communicate(timeout=20)
        follower_out, follower_err = follower.communicate(timeout=20)
        results = [None, None]
        results[leader_index] = subprocess.CompletedProcess(command, leader.returncode,
            ''.join(line for line in leader_lines if not line.startswith('READY:')) + leader_out, leader_err)
        results[1-leader_index] = subprocess.CompletedProcess(command, follower.returncode, follower_out, follower_err)
        return results
    finally:
        for process in (leader, follower):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate()


def state(result: subprocess.CompletedProcess[str]) -> str | None:
    if result.returncode == 0:
        return None
    match = re.search(r"(?:SQLSTATE:\s*|ERROR:\s*)([0-9A-Z]{5})", result.stderr)
    return match.group(1) if match else None


def assert_state(result: subprocess.CompletedProcess[str], expected: str, name: str) -> None:
    actual = state(result)
    if actual != expected:
        raise AssertionError(f"{name}: expected SQLSTATE {expected}, got {actual!r}: {result.stderr}")


def json_result(result: subprocess.CompletedProcess[str], name: str) -> dict[str, object]:
    if result.returncode:
        raise AssertionError(f"{name} failed: {result.stderr.strip()}")
    try:
        return json.loads(result.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise AssertionError(f"{name} returned invalid JSON: {result.stdout!r}") from error


def open_session(auth: str, register: str, assignment: str, key: str) -> str:
    statement = ("select session_id::text from public.open_register_session("
                 f"'{register}','{assignment}',0,'{key}');")
    result = run_docker(psql_args(), sql=transaction_sql(auth, statement, 0), timeout=40)
    if result.returncode:
        raise AssertionError(f"Session open failed: {result.stderr.strip()}")
    session_id = result.stdout.strip().splitlines()[-1]
    if len(session_id) != 36:
        raise AssertionError(f"Unexpected session ID: {session_id!r}")
    return session_id


def close_session(auth: str, session_id: str, key: str) -> None:
    statement = ("select * from public.close_my_register_session("
                 f"'{session_id}',1,0,'{key}');")
    result = run_docker(psql_args(), sql=transaction_sql(auth, statement, 0), timeout=40)
    if result.returncode:
        raise AssertionError(f"Session close failed: {result.stderr.strip()}")


def open_pair(index: int) -> tuple[str, str]:
    suffix = f"{index:03d}"
    return (
        open_session(CASHIER, REGISTER_A, ASSIGNMENT_A, f"p3b-open-cashier-{suffix}-key"),
        open_session(SUPERVISOR, REGISTER_B, ASSIGNMENT_SUPERVISOR_B, f"p3b-open-super-{suffix}-key"),
    )


def close_pair(one: str, two: str, suffix: str) -> None:
    close_session(CASHIER, one, f"p3b-close-cashier-{suffix}-key")
    close_session(SUPERVISOR, two, f"p3b-close-super-{suffix}-key")


def payload(session_id: str, key: str, *, customer: str | None = None, tender: str = "cash",
        cash: int = BASE_PRICE, price: int = BASE_PRICE, version: int | None = None,
        quantity: int = 1) -> dict[str, object]:
    if version is None:
        version = product_state()[0]
    tender_value = {"type": tender}
    if tender == "cash":
        tender_value["cash_received_minor"] = str(cash)
    return {
        "request_key": key,
        "register_session_id": session_id,
        "cafeteria_customer_id": customer,
        "items": [{"product_id": PRODUCT, "quantity": quantity,
                   "expected_product_version": version, "expected_unit_price_minor": str(price)}],
        "expected_total_minor": str(price * quantity),
        "tender": tender_value,
    }


def checkout_sql(value: dict[str, object]) -> str:
    text = json.dumps(value, separators=(",", ":")).replace("'", "''")
    return f"select public.checkout_purchase('{text}'::jsonb);"


def add_supervisor_assignment() -> None:
    sql = ("select * from public.create_cafeteria_register_assignment("
           f"'{CAFETERIA}','{ASSIGNMENT_SUPERVISOR_B}','00000000-0000-0000-0000-000000004603','{REGISTER_B}');")
    result = run_docker(psql_args(), sql=transaction_sql(ADMIN, sql, 0), timeout=40)
    if result.returncode:
        raise AssertionError(f"Supervisor assignment setup failed: {result.stderr.strip()}")


def top_up(amount: int, iteration: int) -> None:
    key = f"phase3b-race-topup-{iteration:03d}-key"
    sql = ("select * from public.post_manual_wallet_replenishment("
           f"'{WALLET}',{amount},'{key}','synthetic race','local harness',null);")
    result = run_docker(psql_args(), sql=transaction_sql(SCHOOL_ADMIN, sql, 0), timeout=40)
    if result.returncode:
        raise AssertionError(f"Synthetic wallet top-up failed: {result.stderr.strip()}")


def spent_today() -> int:
    value = query("select coalesce(sum(e.amount_minor::numeric),0)::bigint from public.student_daily_spend_events e "
                  f"where e.student_id='{STUDENT}' and e.currency_code='DOP' "
                  "and e.business_date=(now() at time zone 'America/Santo_Domingo')::date;")
    return int(value)


def set_limit(limit: int, enabled: bool = True) -> None:
    version = int(query("select coalesce((select version from public.student_spending_controls "
                         f"where student_id='{STUDENT}' and currency_code='DOP'),0);"))
    sql = ("select * from public.set_student_spending_control("
            f"'{STUDENT}','DOP',{version},{str(enabled).lower()},{limit},false,0);")
    result = run_docker(psql_args(), sql=transaction_sql(SCHOOL_ADMIN, sql, 0), timeout=40)
    if result.returncode:
        raise AssertionError(f"Race spending-control setup failed: {result.stderr.strip()}")


def race_checkout_against_close(index: int, exceptional: bool) -> None:
    suffix = f"{index:03d}"
    session_id = open_session(CASHIER, REGISTER_A, ASSIGNMENT_A, f"p3b-close-race-open-{exceptional}-{suffix}")
    key = f"p3b-close-race-sale-{exceptional}-{suffix}"
    sale = (CASHIER, checkout_sql(payload(session_id, key)))
    if exceptional:
        close = (SUPERVISOR, "select * from public.exceptionally_close_register_session("
                 f"'{session_id}',1,0,'administrative_recovery',null,'p3b-exception-{suffix}-close-key');")
        name = "purchase-vs-exceptional-close"
    else:
        close = (CASHIER, "select * from public.close_my_register_session("
                 f"'{session_id}',1,0,'p3b-normal-{suffix}-close-key');")
        name = "purchase-vs-normal-close"
    if index % 2 == 0:
        close = (close[0], "select pg_catalog.pg_sleep(0.15);\n" + close[1])
    else:
        sale = (sale[0], "select pg_catalog.pg_sleep(0.15);\n" + sale[1])
    sale_result, close_result = race(sale, close)
    if close_result.returncode:
        raise AssertionError(f"{name} close failed: {close_result.stderr.strip()}")
    sale_state = state(sale_result)
    if sale_state not in (None, "23514"):
        raise AssertionError(f"{name} checkout returned unexpected SQLSTATE {sale_state}: {sale_result.stderr}")
    if sale_state and "SESSION_CLOSED" not in sale_result.stderr:
        raise AssertionError(f"{name} checkout failed for unexpected reason: {sale_result.stderr}")
    purchase_count = query(f"select count(*) from public.purchases where request_key='{key}';")
    final = query("select status||'|'||close_type||'|'||operator_person_id::text||'|'||closed_by_person_id::text "
                  f"from public.register_sessions where id='{session_id}';")
    expected_closer = "00000000-0000-0000-0000-000000001011" if exceptional else CASHIER_PERSON
    if not final.startswith(f"closed|{'exceptional' if exceptional else 'normal'}|{CASHIER_PERSON}|{expected_closer}"):
        raise AssertionError(f"{name} terminal evidence is inconsistent: {final}")
    if (sale_state is None and purchase_count != "1") or (sale_state is not None and purchase_count != "0"):
        raise AssertionError(f"{name} purchase/session outcome disagrees: purchase={purchase_count}, session={final}")
    print(f"{name} {index+1}: closed consistently; purchase={'committed before close' if not sale_state else 'rejected after close'}")


def race_wallet_overspend(index: int) -> None:
    suffix = f"{index:03d}"
    set_limit(0, enabled=False)
    top_up(BASE_PRICE, index)
    cashier_session, supervisor_session = open_pair(index)
    one = (CASHIER, checkout_sql(payload(cashier_session, f"p3b-wallet-a-{suffix}", customer=CUSTOMER, tender="student_wallet")))
    two = (SUPERVISOR, checkout_sql(payload(supervisor_session, f"p3b-wallet-b-{suffix}", customer=CUSTOMER, tender="student_wallet")))
    outcomes = race(one, two)
    winners = [r for r in outcomes if r.returncode == 0]
    losers = [r for r in outcomes if r.returncode]
    if len(winners) != 1 or len(losers) != 1:
        raise AssertionError(f"Wallet overspend expected one winner: {[(r.returncode,r.stderr) for r in outcomes]}")
    assert_state(losers[0], "23514", "wallet overspend")
    if "INSUFFICIENT_BALANCE" not in losers[0].stderr:
        raise AssertionError(f"Wallet loser was not insufficient balance: {losers[0].stderr}")
    balance = query(f"select current_balance_minor::text||'|'||balance_version::text from public.student_wallets where id='{WALLET}';")
    ledger = query(f"select coalesce(sum(amount_minor),0)::text||'|'||max(balance_version_after)::text from public.wallet_ledger_entries where wallet_id='{WALLET}';")
    if balance.split("|")[0] != "0" or balance.split("|")[0] != ledger.split("|")[0] or balance.split("|")[1] != ledger.split("|")[1]:
        raise AssertionError(f"Wallet and ledger diverged: balance={balance}, ledger={ledger}")
    close_pair(cashier_session, supervisor_session, f"wallet-{suffix}")
    print(f"two-wallet-purchases {index+1}: one committed, one insufficient; {balance}")


def race_daily_limit(index: int) -> None:
    suffix = f"{index:03d}"
    set_limit(spent_today() + BASE_PRICE)
    cashier_session, supervisor_session = open_pair(index + 100)
    one = (CASHIER, checkout_sql(payload(cashier_session, f"p3b-daily-a-{suffix}-key", customer=CUSTOMER)))
    two = (SUPERVISOR, checkout_sql(payload(supervisor_session, f"p3b-daily-b-{suffix}-key", customer=CUSTOMER)))
    outcomes = race(one, two)
    winners = [r for r in outcomes if r.returncode == 0]
    losers = [r for r in outcomes if r.returncode]
    if len(winners) != 1 or len(losers) != 1:
        raise AssertionError(f"Daily limit expected one winner: {[(r.returncode,r.stderr) for r in outcomes]}")
    assert_state(losers[0], "23514", "daily limit")
    if "DAILY_LIMIT_EXCEEDED" not in losers[0].stderr:
        raise AssertionError(f"Daily-limit loser had unexpected error: {losers[0].stderr}")
    usage = spent_today()
    close_pair(cashier_session, supervisor_session, f"daily-{suffix}")
    print(f"two-identified-cash-limit {index+1}: one committed, one exceeded; usage={usage}")


def product_state() -> tuple[int, int, bool]:
    parts = query(f"select version::text||'|'||price_minor::text||'|'||available::text from public.cafeteria_products where id='{PRODUCT}';").split("|")
    return int(parts[0]), int(parts[1]), parts[2] == "true"


def mutate_product(version: int, price: int, available: bool) -> None:
    sql = ("select public.update_cafeteria_product("
           f"'{CAFETERIA}','{PRODUCT}',{version},'Agua mineral','Synthetic active saleable product',"
           f"'{CATEGORY}',{price},true,{str(available).lower()},'{{}}'::text[],'{{}}'::text[]);")
    result = run_docker(psql_args(), sql=transaction_sql(ADMIN, sql, 0), timeout=40)
    if result.returncode:
        raise AssertionError(f"Synthetic product update failed: {result.stderr.strip()}")


def race_product_mutation(index: int, availability: bool) -> None:
    suffix = f"{index:03d}"
    version, price, available = product_state()
    if price != BASE_PRICE or not available:
        mutate_product(version, BASE_PRICE, True)
        version, price, available = product_state()
    session_id = open_session(CASHIER, REGISTER_A, ASSIGNMENT_A, f"p3b-product-open-{availability}-{suffix}-key")
    sale_key = f"p3b-product-sale-{availability}-{suffix}-key"
    sale = (CASHIER, checkout_sql(payload(session_id, sale_key, price=price, version=version)))
    mutation_price = price if availability else BASE_PRICE + 1000
    mutation = (ADMIN, "select public.update_cafeteria_product("
                f"'{CAFETERIA}','{PRODUCT}',{version},'Agua mineral','Synthetic active saleable product',"
                f"'{CATEGORY}',{mutation_price},true,{'false' if availability else 'true'},'{{}}'::text[],'{{}}'::text[]);")
    if index % 2 == 0:
        mutation = (mutation[0], "select pg_catalog.pg_sleep(0.15);\n" + mutation[1])
    else:
        sale = (sale[0], "select pg_catalog.pg_sleep(0.15);\n" + sale[1])
    sale_result, update_result = race(sale, mutation)
    if update_result.returncode:
        raise AssertionError(f"Concurrent product mutation failed: {update_result.stderr.strip()}")
    sale_state = state(sale_result)
    allowed = (None, "40001", "23514") if availability else (None, "40001")
    if sale_state not in allowed:
        raise AssertionError(f"Purchase/product race returned unexpected {sale_state}: {sale_result.stderr}")
    if sale_state and "PRODUCT_" not in sale_result.stderr:
        raise AssertionError(f"Stale/unavailable product did not reject checkout clearly: {sale_result.stderr}")
    close_session(CASHIER, session_id, f"p3b-product-close-{availability}-{suffix}-key")
    current_version, current_price, current_available = product_state()
    if current_price != BASE_PRICE or not current_available:
        mutate_product(current_version, BASE_PRICE, True)
    print(f"purchase-vs-product-{'availability' if availability else 'price'} {index+1}: {sale_state or 'sale committed first'}")


def race_idempotency(index: int, changed: bool) -> None:
    suffix = f"{index:03d}"
    session_id = open_session(CASHIER, REGISTER_A, ASSIGNMENT_A, f"p3b-idem-open-{changed}-{suffix}-key")
    key = f"p3b-idempotency-{changed}-{suffix}-key"
    first = (CASHIER, checkout_sql(payload(session_id, key)))
    second_value = payload(session_id, key, cash=6000 if changed else BASE_PRICE)
    second = (CASHIER, checkout_sql(second_value))
    outcomes = race(first, second)
    if changed:
        winners = [r for r in outcomes if r.returncode == 0]
        losers = [r for r in outcomes if r.returncode]
        if len(winners) != 1 or len(losers) != 1:
            raise AssertionError(f"Changed idempotency payload expected one winner: {[(r.returncode,r.stderr) for r in outcomes]}")
        assert_state(losers[0], "23505", "changed idempotency payload")
        if "IDEMPOTENCY_CONFLICT" not in losers[0].stderr:
            raise AssertionError(f"Wrong changed-key error: {losers[0].stderr}")
    else:
        results = [json_result(r, "identical checkout retry") for r in outcomes]
        if len({r["purchase_id"] for r in results}) != 1:
            raise AssertionError(f"Identical retries returned different purchase IDs: {results}")
    close_session(CASHIER, session_id, f"p3b-idem-close-{changed}-{suffix}-key")
    print(f"{'changed-payload-conflict' if changed else 'identical-idempotency'} {index+1}: passed")


def race_two_cash_sales(index: int, independent: bool) -> None:
    suffix = f"{index:03d}"
    one, two = open_pair(index + (300 if independent else 200))
    prefix = "independent-cash" if independent else "purchase-number"
    results = race(
        (CASHIER, checkout_sql(payload(one, f"p3b-{prefix}-a-{suffix}-key"))),
        (SUPERVISOR, checkout_sql(payload(two, f"p3b-{prefix}-b-{suffix}-key"))),
    )
    purchases = [json_result(r, prefix) for r in results]
    numbers = {p["purchase_number"] for p in purchases}
    if len(numbers) != 2:
        raise AssertionError(f"Concurrent cafeteria numbers collided: {purchases}")
    close_pair(one, two, f"{prefix}-{suffix}")
    print(f"{prefix} {index+1}: both cash purchases committed with numbers {sorted(numbers)}")


def race_control_change(index: int) -> None:
    set_limit(0, enabled=False)
    session = open_session(CASHIER, REGISTER_A, ASSIGNMENT_A, f"p3b-control-open-{index}-key")
    version = query(f"select version from public.student_spending_controls where student_id='{STUDENT}';")
    key = f"p3b-control-sale-{index}-key"
    sale, mutation = race((CASHIER, checkout_sql(payload(session,key,customer=CUSTOMER))),
        (SCHOOL_ADMIN, f"select * from public.set_student_spending_control('{STUDENT}','DOP',{version},true,0,false,0);"))
    if mutation.returncode:
        raise AssertionError(mutation.stderr)
    if sale.returncode:
        assert_state(sale,'23514','control race')
        if 'DAILY_LIMIT_EXCEEDED' not in sale.stderr: raise AssertionError(sale.stderr)
    close_session(CASHIER,session,f"p3b-control-close-{index}-key")
    print(f"cash-vs-control {index+1}: {state(sale) or 'old unlimited control committed first'}")


def race_scheduling_toggle(index: int) -> None:
    # Disable all services through authoritative RPCs, so ON must reject.
    for row in query(f"select id::text||'|'||version::text||'|'||menu_id::text from public.cafeteria_service_shifts where cafeteria_id='{CAFETERIA}' and enabled;").splitlines():
        shift,version,menu = row.split('|')
        statement = (f"select public.update_cafeteria_service_shift('{CAFETERIA}','{shift}',{version},'{menu}',"
                     "'Synthetic disabled','00:00','23:59:59.999999',false,array[1,2,3,4,5,6,7]);")
        result = run_docker(psql_args(),sql=transaction_sql(ADMIN,statement,0))
        if result.returncode: raise AssertionError(result.stderr)
    version = query(f"select version from public.cafeteria_operation_settings where cafeteria_id='{CAFETERIA}';")
    result = run_docker(psql_args(),sql=transaction_sql(ADMIN,
        f"select * from public.update_cafeteria_catalog_settings('{CAFETERIA}',false,{version});",0))
    if result.returncode: raise AssertionError(result.stderr)
    version = query(f"select version from public.cafeteria_operation_settings where cafeteria_id='{CAFETERIA}';")
    session = open_session(CASHIER,REGISTER_A,ASSIGNMENT_A,f"p3b-toggle-open-{index}-key")
    sale,mutation = race((CASHIER,checkout_sql(payload(session,f"p3b-toggle-sale-{index}-key"))),
        (ADMIN,f"select * from public.update_cafeteria_catalog_settings('{CAFETERIA}',true,{version});"))
    if mutation.returncode: raise AssertionError(mutation.stderr)
    if sale.returncode:
        assert_state(sale,'23514','scheduling toggle')
        if 'NO_ACTIVE_SERVICE' not in sale.stderr: raise AssertionError(sale.stderr)
    close_session(CASHIER,session,f"p3b-toggle-close-{index}-key")
    version = query(f"select version from public.cafeteria_operation_settings where cafeteria_id='{CAFETERIA}';")
    result = run_docker(psql_args(),sql=transaction_sql(ADMIN,
        f"select * from public.update_cafeteria_catalog_settings('{CAFETERIA}',false,{version});",0))
    if result.returncode: raise AssertionError(result.stderr)
    print(f"checkout-vs-scheduling-toggle {index+1}: {state(sale) or 'manual sale committed first'}")


def race_membership(index: int) -> None:
    session = open_session(CASHIER,REGISTER_A,ASSIGNMENT_A,f"p3b-member-open-{index}-key")
    sale,mutation = race((CASHIER,checkout_sql(payload(session,f"p3b-member-sale-{index}-key"))),
        (ADMIN,f"select * from public.set_cafeteria_pos_membership('{CAFETERIA}','{CASHIER_PERSON}','pos_cashier','suspended');"))
    if mutation.returncode: raise AssertionError(mutation.stderr)
    if sale.returncode:
        assert_state(sale,'42501','membership suspension')
        if 'OPERATOR_NOT_AUTHORIZED' not in sale.stderr: raise AssertionError(sale.stderr)
    close_session(CASHIER,session,f"p3b-member-close-{index}-key")
    result = run_docker(psql_args(),sql=transaction_sql(ADMIN,
        f"select * from public.set_cafeteria_pos_membership('{CAFETERIA}','{CASHIER_PERSON}','pos_cashier','active');",0))
    if result.returncode: raise AssertionError(result.stderr)
    print(f"checkout-vs-membership-suspension {index+1}: {state(sale) or 'sale committed first'}; owner close works")


def race_register_authority(index: int, assignment: bool) -> None:
    kind = 'assignment' if assignment else 'register'
    session = open_session(CASHIER,REGISTER_A,ASSIGNMENT_A,f"p3b-{kind}-open-{index}-key")
    target_table = 'cafeteria_register_assignments' if assignment else 'cafeteria_registers'
    target_id = ASSIGNMENT_A if assignment else REGISTER_A
    version = query(f"select version from public.{target_table} where id='{target_id}';")
    def mutation(status: str, expected: str) -> str:
        if assignment:
            return f"select public.update_cafeteria_register_assignment('{CAFETERIA}','{ASSIGNMENT_A}',{expected},'{status}');"
        return f"select public.update_cafeteria_register('{CAFETERIA}','{REGISTER_A}',{expected},'CAJA-1','Caja 1','{status}');"
    sale,changed = race((CASHIER,checkout_sql(payload(session,f"p3b-{kind}-sale-{index}-key"))),
                       (ADMIN,mutation('inactive',version)))
    if changed.returncode: raise AssertionError(changed.stderr)
    if sale.returncode:
        assert_state(sale,'42501' if assignment else '23514',kind+' deactivation')
        if ('ASSIGNMENT_INACTIVE' if assignment else 'REGISTER_INACTIVE') not in sale.stderr:
            raise AssertionError(sale.stderr)
    close_session(CASHIER,session,f"p3b-{kind}-close-{index}-key")
    version = query(f"select version from public.{target_table} where id='{target_id}';")
    result = run_docker(psql_args(),sql=transaction_sql(ADMIN,mutation('active',version),0))
    if result.returncode: raise AssertionError(result.stderr)
    print(f"checkout-vs-{kind}-deactivation {index+1}: {state(sale) or 'sale committed first'}")


def main() -> None:
    verify_local_db()
    add_supervisor_assignment()
    print(f"Verified local project {CONTAINER}, migration {PHASE_3B}, empty purchase/session history.")
    for i in range(ITERATIONS):
        race_checkout_against_close(i, exceptional=False)
        race_checkout_against_close(i, exceptional=True)
        race_wallet_overspend(i)
        race_daily_limit(i)
        race_product_mutation(i, availability=False)
        race_product_mutation(i, availability=True)
        race_idempotency(i, changed=False)
        race_idempotency(i, changed=True)
        race_two_cash_sales(i, independent=False)
        race_two_cash_sales(i, independent=True)
        race_control_change(i)
        race_scheduling_toggle(i)
        race_membership(i)
        race_register_authority(i,assignment=False)
        race_register_authority(i,assignment=True)
    if query("select count(*) from public.register_sessions where status='open';") != "0":
        raise AssertionError("Race harness left open register sessions.")
    wallet = query("select w.current_balance_minor::text||'|'||coalesce(sum(l.amount_minor),0)::text||'|'|| "
                   "w.balance_version::text||'|'||coalesce(max(l.balance_version_after),0)::text "
                   "from public.student_wallets w left join public.wallet_ledger_entries l on l.wallet_id=w.id "
                   f"where w.id='{WALLET}' group by w.id;")
    balance, ledger_total, version, ledger_version = wallet.split("|")
    if balance != ledger_total or version != ledger_version:
        raise AssertionError(f"Wallet ledger reconciliation failed: {wallet}")
    spend = query(f"select coalesce(sum(amount_minor),0)::text from public.student_daily_spend_events where student_id='{STUDENT}';")
    if int(spend) <= 0:
        raise AssertionError("Expected student wallet/daily-limit races to leave spend evidence.")
    if BLOCKING_PROOFS != 150:
        raise AssertionError(f"Expected 150 backend blocking proofs, got {BLOCKING_PROOFS}")
    counter = query(f"select last_purchase_number from public.cafeteria_purchase_counters where cafeteria_id='{CAFETERIA}';")
    count = query(f"select count(*) from public.purchases where cafeteria_id='{CAFETERIA}';")
    if counter != count: raise AssertionError(f"Counter {counter} differs from committed count {count}")
    mismatch = query("select count(*) from public.purchases p full join public.student_daily_spend_events e on e.purchase_id=p.id "
        "where (p.student_id is not null and p.total_minor>0 and (e.id is null or e.amount_minor<>p.total_minor "
        "or e.business_date<>p.business_date or e.student_id<>p.student_id)) or (e.id is not null and p.id is null);")
    if mismatch != '0': raise AssertionError('Purchase/daily spend inconsistency')
    print("150/150 Phase 3B race iterations passed (10 each for fifteen categories); 150 observed backend blocking proofs.")
    print(f"No open sessions. Wallet current/ledger/version reconcile: {wallet}; student spend total={spend}.")
    print("Harness leaves synthetic financial history; run scripts/db-foundation.sh reset afterward.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(f"Phase 3B local race tests failed: {error}") from error