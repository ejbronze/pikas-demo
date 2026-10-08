#!/usr/bin/env python3
"""Focused local-only staff receivable races using independent PostgreSQL sessions."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import uuid

spec = importlib.util.spec_from_file_location(
    "phase3c_races", Path(__file__).with_name("test-pos-refund-races.py")
)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load the established local PostgreSQL race harness.")
races = importlib.util.module_from_spec(spec)
spec.loader.exec_module(races)
h = races.h
h.PHASE_3B = "202610070001"

ACCOUNT = "00000000-0000-0000-0000-000000000001"
SCHOOL = "00000000-0000-0000-0000-000000000011"
STAFF = "00000000-0000-0000-0000-000000006501"
CUSTOMER = "00000000-0000-0000-0000-000000006902"
RECEIVABLE_ID: str | None = None
SESSION: str | None = None
LIMIT = 5000
ITERATIONS = 3


def key(label: str) -> str:
    return f"p3d-{label}-{uuid.uuid4().hex[:20]}"


def call(auth: str, statement: str) -> str:
    result = h.run_docker(
        h.psql_args(), sql=h.transaction_sql(auth, statement, 0), timeout=40
    )
    if result.returncode:
        raise AssertionError(f"Local RPC failed: {result.stderr.strip()}")
    return result.stdout.strip().splitlines()[-1]


def configuration(staff_id: str, expected: int, limit: int, request_key: str) -> str:
    return (
        "select public.configure_staff_receivable_account("
        f"'{ACCOUNT}','{SCHOOL}','{staff_id}',{expected},true,'{limit}','{request_key}');"
    )


def configure_current(limit: int, request_key: str) -> dict[str, object]:
    version = int(
        h.query(
            f"select config_version from public.staff_receivable_accounts "
            f"where id='{RECEIVABLE_ID}';"
        )
    )
    return json.loads(call(h.SCHOOL_ADMIN, configuration(STAFF, version, limit, request_key)))


def staff_purchase(request_key: str | None = None) -> str:
    payload = h.payload(
        str(SESSION), request_key or key("purchase"), customer=CUSTOMER, tender="staff_credit"
    )
    return json.loads(call(h.SUPERVISOR, h.checkout_sql(payload)))["purchase_id"]


def settlement(amount: int, request_key: str | None = None) -> str:
    return (
        "select public.settle_staff_receivable("
        f"'{RECEIVABLE_ID}','{amount}','other','{h.CAFETERIA}',"
        "'00000000-0000-0000-0000-000000004603',null,null,null,"
        f"'{request_key or key('settlement')}');"
    )


def refund(purchase_id: str, amount: int, request_key: str | None = None) -> str:
    return (
        "select public.create_purchase_refund("
        f"'{purchase_id}','{amount}','error',null,'{request_key or key('refund')}',"
        "'00000000-0000-0000-0000-000000004603');"
    )


def outcome(item: dict[str, object]) -> tuple[str, object | None]:
    status = str(item["sqlstate"])
    if status != "00000":
        return status, None
    return status, item["result"]


def expect_success(item: dict[str, object], label: str) -> dict[str, object]:
    state, result = outcome(item)
    if state != "00000" or not isinstance(result, dict):
        raise AssertionError(f"{label}: expected success; received {item!r}")
    return result


def expect_one_success_one_error(
    results: list[dict[str, object]], expected_error: str, label: str
) -> None:
    states = [str(item["sqlstate"]) for item in results]
    if states.count("00000") != 1 or states.count(expected_error) != 1:
        raise AssertionError(f"{label}: unexpected SQLSTATE pair {states!r}")


def set_balance_to_zero() -> None:
    balance = int(
        h.query(
            f"select current_balance_minor from public.staff_receivable_accounts "
            f"where id='{RECEIVABLE_ID}';"
        )
    )
    if balance:
        result = json.loads(call(h.SUPERVISOR, settlement(balance)))
        if int(result["balance_after_minor"]) != 0:
            raise AssertionError("Cleanup settlement did not return receivable to zero.")


def account_balance() -> int:
    return int(
        h.query(
            f"select current_balance_minor from public.staff_receivable_accounts "
            f"where id='{RECEIVABLE_ID}';"
        )
    )


def assert_serialized_integrity() -> None:
    result = h.query(
        "select not exists(select 1 from public.staff_receivable_accounts a where "
        "a.current_balance_minor<>(select coalesce(sum(e.amount_minor::numeric),0) "
        "from public.staff_receivable_entries e where e.receivable_account_id=a.id) "
        "or a.balance_version<>(select coalesce(max(e.balance_version_after),0) "
        "from public.staff_receivable_entries e where e.receivable_account_id=a.id) "
        "or (select count(*) from public.staff_receivable_entries e "
        "where e.receivable_account_id=a.id)<>a.balance_version "
        "or exists(select 1 from public.staff_receivable_entries e "
        "where e.receivable_account_id=a.id and e.balance_after_minor<0));"
    )
    if result != "t":
        raise AssertionError("Receivable balance, signed ledger, and versions diverged.")


def prepare() -> None:
    h.verify_local_db()
    if h.query("select count(*) from public.staff_receivable_accounts;") != "0":
        raise RuntimeError("Refusing races: staff receivable fixture is not clean; reset locally.")
    h.query(
        "insert into public.staff_campus_affiliations(account_id,school_id,staff_affiliation_id,school_location_id) "
        f"values('{ACCOUNT}','{SCHOOL}','{STAFF}','00000000-0000-0000-0000-000000000211');"
    )
    config = json.loads(
        call(
            h.SCHOOL_ADMIN,
            configuration(STAFF, 0, LIMIT, key("configure")),
        )
    )
    global RECEIVABLE_ID, SESSION
    RECEIVABLE_ID = str(config["account_id"])
    SESSION = h.open_session(
        h.SUPERVISOR,
        h.REGISTER_A,
        h.ASSIGNMENT_SUPERVISOR_A,
        key("session"),
    )


def race_pair(
    first: tuple[str, str],
    second: tuple[str, str],
    *,
    fence: str | None = None,
    blocked: bool = True,
) -> list[dict[str, object]]:
    return races.race(
        first,
        second,
        fence=fence or "",
        blocked=blocked,
    )


def main() -> None:
    prepare()
    block_fence = (
        f"select id from public.staff_receivable_accounts where id='{RECEIVABLE_ID}' for update;"
    )

    # At the exact limit, two serialized charges cannot both be accepted.
    for index in range(ITERATIONS):
        requests = [
            h.checkout_sql(
                h.payload(
                    str(SESSION),
                    key("limit-a"),
                    customer=CUSTOMER,
                    tender="staff_credit",
                )
            ),
            h.checkout_sql(
                h.payload(
                    str(SESSION),
                    key("limit-b"),
                    customer=CUSTOMER,
                    tender="staff_credit",
                )
            ),
        ]
        pair = race_pair((h.SUPERVISOR, requests[0]), (h.SUPERVISOR, requests[1]), fence=block_fence)
        expect_one_success_one_error(pair, "23514", f"limit contention iteration {index}")
        if account_balance() != LIMIT:
            raise AssertionError("Concurrent limit race did not leave exactly one charge.")
        set_balance_to_zero()

    # Purchase against settlement: either lock order is safe and ends at 5,000.
    for index in range(ITERATIONS):
        base = staff_purchase()
        configure_current(10000, key("raise-limit"))
        pair = race_pair(
            (h.SUPERVISOR, h.checkout_sql(h.payload(str(SESSION), key("purchase-v-settle"),
                customer=CUSTOMER, tender="staff_credit"))),
            (h.SUPERVISOR, settlement(5000)),
            fence=block_fence,
        )
        for item in pair:
            expect_success(item, f"purchase versus settlement iteration {index}")
        if account_balance() != 5000:
            raise AssertionError("Purchase-versus-settlement result did not reconcile to 5,000.")
        set_balance_to_zero()
        if not base:
            raise AssertionError("Baseline purchase was not created.")
        configure_current(LIMIT, key("restore-limit"))

    # Two distinct partial settlements serialize; only the first 3,000 can settle.
    for index in range(ITERATIONS):
        staff_purchase()
        pair = race_pair(
            (h.SUPERVISOR, settlement(3000)),
            (h.SUPERVISOR, settlement(3000)),
            fence=block_fence,
        )
        expect_one_success_one_error(pair, "23514", f"two settlements iteration {index}")
        if account_balance() != 2000:
            raise AssertionError("Competing settlements over-collected the account.")
        set_balance_to_zero()
        configure_current(LIMIT, key("restore-limit"))

    # A new purchase and refund of a prior purchase commute through one account lock.
    for index in range(ITERATIONS):
        old_purchase = staff_purchase()
        configure_current(10000, key("raise-limit"))
        pair = race_pair(
            (h.SUPERVISOR, h.checkout_sql(h.payload(str(SESSION), key("purchase-v-refund"),
                customer=CUSTOMER, tender="staff_credit"))),
            (h.SUPERVISOR, refund(old_purchase, 5000)),
            fence=block_fence,
        )
        for item in pair:
            expect_success(item, f"purchase versus refund iteration {index}")
        if account_balance() != 5000:
            raise AssertionError("Purchase-versus-refund did not leave the expected amount due.")
        set_balance_to_zero()
        configure_current(LIMIT, key("restore-limit"))

    # Settlement versus refund: one collects/credits the due amount, never both.
    for index in range(ITERATIONS):
        original = staff_purchase()
        pair = race_pair(
            (h.SUPERVISOR, settlement(5000)),
            (h.SUPERVISOR, refund(original, 5000)),
            fence=block_fence,
        )
        states = [str(item["sqlstate"]) for item in pair]
        if states.count("00000") != 1 or sum(state in ("23514",) for state in states) != 1:
            raise AssertionError(f"Settlement-versus-refund produced unexpected outcomes: {states!r}")
        if account_balance() != 0:
            raise AssertionError("Settlement-versus-refund created a negative or nonzero balance.")
        configure_current(LIMIT, key("restore-limit"))

    # Identical settlement keys return the same committed settlement/ledger entry.
    for index in range(ITERATIONS):
        staff_purchase()
        same_key = key("same-settlement")
        pair = race_pair(
            (h.SUPERVISOR, settlement(1000, same_key)),
            (h.SUPERVISOR, settlement(1000, same_key)),
        )
        left = expect_success(pair[0], f"identical settlement {index}")
        right = expect_success(pair[1], f"identical settlement replay {index}")
        left_response = left.get("settle_staff_receivable", left)
        right_response = right.get("settle_staff_receivable", right)
        if left_response["settlement_id"] != right_response["settlement_id"]:
            raise AssertionError("Identical settlement requests created distinct settlements.")
        count = h.query(
            f"select count(*) from public.staff_receivable_entries where settlement_id="
            f"'{left_response['settlement_id']}';"
        )
        if count != "1":
            raise AssertionError("Idempotent settlement emitted duplicate ledger entries.")
        set_balance_to_zero()
        configure_current(LIMIT, key("restore-limit"))

    # Same-account same-key config retries serialize and retain one audit event.
    for index in range(ITERATIONS):
        current_version = int(
            h.query(
                f"select config_version from public.staff_receivable_accounts "
                f"where id='{RECEIVABLE_ID}';"
            )
        )
        config_key = key("same-config")
        statement = configuration(STAFF, current_version, LIMIT, config_key)
        pair = race_pair(
            (h.SCHOOL_ADMIN, statement),
            (h.SCHOOL_ADMIN, statement),
        )
        left = expect_success(pair[0], f"identical configuration {index}")
        right = expect_success(pair[1], f"configuration replay {index}")
        left_response = left.get("configure_staff_receivable_account", left)
        right_response = right.get("configure_staff_receivable_account", right)
        if left_response["config_version"] != right_response["config_version"]:
            raise AssertionError("Identical config requests produced different versions.")

    # Different receivable-account rows must remain independent.
    second_staff = "00000000-0000-0000-0000-000000006503"
    second_person = "00000000-0000-0000-0000-000000001005"
    h.query(
        "insert into public.school_staff_affiliations(id,account_id,school_id,person_id,staff_category) "
        f"values('{second_staff}','{ACCOUNT}','{SCHOOL}','{second_person}','other_employee');"
    )
    second_account = json.loads(
        call(
            h.SCHOOL_ADMIN,
            configuration(second_staff, 0, LIMIT, key("second-account")),
        )
    )["account_id"]
    first_version = int(
        h.query(
            f"select config_version from public.staff_receivable_accounts where id='{RECEIVABLE_ID}';"
        )
    )
    second_version = int(
        h.query(
            f"select config_version from public.staff_receivable_accounts where id='{second_account}';"
        )
    )
    independent = race_pair(
        (h.SCHOOL_ADMIN, configuration(STAFF, first_version, 4000, key("independent-one"))),
        (h.SCHOOL_ADMIN, configuration(second_staff, second_version, 4000, key("independent-two"))),
        fence=block_fence,
        blocked=False,
    )
    for item in independent:
        expect_success(item, "independent account configuration")

    assert_serialized_integrity()
    print(
        "Phase 3D races passed: "
        f"{races.PROOFS} blocking proofs, {races.INDEPENDENCE} independence proofs; "
        "no over-limit charge, over-settlement, negative balance, duplicate source, "
        "version gap, deadlock, or unexpected timeout."
    )


if __name__ == "__main__":
    main()
