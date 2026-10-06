#!/usr/bin/env python3
"""Exercise Phase 5B receipt-print races against the local pikas-foundation DB."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import uuid

spec = importlib.util.spec_from_file_location(
    "phase3c_races", Path(__file__).with_name("test-pos-refund-races.py")
)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load the local PostgreSQL race harness.")
race_harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(race_harness)
h = race_harness.h
h.PHASE_3B = "202610060001"

ACTOR = h.CASHIER
PERSON = h.CASHIER_PERSON
MEMBERSHIP = "00000000-0000-0000-0000-000000004601"
REGISTER = h.REGISTER_A
ASSIGNMENT = h.ASSIGNMENT_A
SCHOOL = "00000000-0000-0000-0000-000000000011"
SUPERVISOR_MEMBERSHIP = "00000000-0000-0000-0000-000000004603"
SUPERVISOR_PERSON = "00000000-0000-0000-0000-000000001011"
ITERATIONS = 10
BLOCKING_PROOFS = 0
INDEPENDENCE_PROOFS = 0


def key() -> str:
    return str(uuid.uuid4())


def call(auth: str, sql: str) -> str:
    result = h.run_docker(h.psql_args(), sql=h.transaction_sql(auth, sql, 0), timeout=40)
    if result.returncode:
        raise AssertionError(result.stderr.strip())
    return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""


def sale(session: str) -> str:
    payload = h.payload(session, "phase5b-race-" + key(), tender="cash")
    result = json.loads(call(ACTOR, h.checkout_sql(payload)))
    return result["purchase_id"]


def claim(purchase_id: str) -> str:
    return (
        "select public.claim_purchase_receipt_print_job("
        f"'{REGISTER}','{MEMBERSHIP}','{purchase_id}') as response;"
    )


def report(claim_json: dict[str, object], result: str, code: str | None = None) -> str:
    token = claim_json["claim_token"]
    details = ",null" if code is None else f",'{code}'"
    return (
        "select public.report_receipt_print_job("
        f"'{claim_json['job_id']}','{token}','{result}'{details}) as response;"
    )


def reprint(purchase_id: str, request_key: str, reason: str = "customer_requested") -> str:
    return (
        "select public.request_purchase_receipt_reprint("
        f"'{purchase_id}','{REGISTER}','{MEMBERSHIP}','{request_key}','{reason}') as response;"
    )


def response(outcome: dict[str, object]) -> dict[str, object] | None:
    if outcome["sqlstate"] != "00000":
        return None
    return outcome["result"]["response"]


def scenario(iteration: int) -> None:
    global BLOCKING_PROOFS, INDEPENDENCE_PROOFS
    session = h.open_session(ACTOR, REGISTER, ASSIGNMENT, "phase5b-race-open-" + key())
    purchase_id = sale(session)
    independent_purchase = sale(session)
    close_version = h.query(
        f"select version from public.register_sessions where id='{session}';"
    )
    close_sql = (
        "select * from public.close_my_register_session("
        f"'{session}',{close_version},0,'phase5b-race-close-{key()}');"
    )
    call(ACTOR, close_sql)

    # SKIP LOCKED must let the second independent claim finish without waiting.
    claim_race = race_harness.race(
        (ACTOR, claim(purchase_id)),
        (ACTOR, claim(purchase_id)),
        blocked=False,
    )
    claim_results = [response(value) for value in claim_race]
    if sum(value is not None for value in claim_results) != 1:
        raise AssertionError(("claim exclusion", claim_race))
    claim_json = next(value for value in claim_results if value is not None)
    INDEPENDENCE_PROOFS += 1

    # Only one competing result may consume the claim token.
    report_race = race_harness.race(
        (ACTOR, report(claim_json, "submitted")),
        (ACTOR, report(claim_json, "failed", "PRINTER_UNAVAILABLE")),
        blocked=True,
    )
    report_states = [value["sqlstate"] for value in report_race]
    if report_states.count("00000") != 1 or report_states.count("40001") != 1:
        raise AssertionError(("claim result race", report_race))
    BLOCKING_PROOFS += 1

    same_key = "phase5b-same-reprint-" + key()
    idempotent_race = race_harness.race(
        (ACTOR, reprint(purchase_id, same_key)),
        (ACTOR, reprint(purchase_id, same_key)),
        blocked=True,
    )
    repeated = [response(value) for value in idempotent_race]
    if any(value is None for value in repeated) or repeated[0]["job_id"] != repeated[1]["job_id"]:
        raise AssertionError(("identical reprint key", idempotent_race))
    if h.query(
        "select count(*) from public.receipt_print_jobs "
        f"where requested_by_person_id='{PERSON}' and request_key='{same_key}';"
    ) != "1":
        raise AssertionError("Identical reprint request created multiple jobs.")
    BLOCKING_PROOFS += 1

    independent = race_harness.race(
        (ACTOR, reprint(independent_purchase, "phase5b-independent-a-" + key())),
        (ACTOR, reprint(independent_purchase, "phase5b-independent-b-" + key())),
        blocked=False,
    )
    independent_results = [response(value) for value in independent]
    if any(value is None for value in independent_results):
        raise AssertionError(("distinct reprints", independent))
    if independent_results[0]["job_id"] == independent_results[1]["job_id"]:
        raise AssertionError("Distinct reprint keys did not create independent jobs.")
    INDEPENDENCE_PROOFS += 1

    # An active claim holds the precise membership share lock while an admin
    # attempts to suspend that membership from an independent connection.
    authority_purchase = sale_from_open_session()
    membership_update = (
        f"select * from public.set_cafeteria_pos_membership('{h.CAFETERIA}',"
        f"'{SUPERVISOR_PERSON}','pos_supervisor','suspended');"
    )
    authority_race = race_harness.race(
        (h.SUPERVISOR, "select public.claim_purchase_receipt_print_job("
         f"'{REGISTER}','{SUPERVISOR_MEMBERSHIP}','{authority_purchase}') as response;"),
        (h.ADMIN, membership_update),
        first=0,
        blocked=True,
    )
    if [value["sqlstate"] for value in authority_race] != ["00000", "00000"]:
        raise AssertionError(("membership contention", authority_race))
    BLOCKING_PROOFS += 1
    authority_response = response(authority_race[0])
    if authority_response is None or authority_response.get("claim_token") is None:
        raise AssertionError(("authority claim", authority_race))
    call(h.ADMIN, f"select * from public.set_cafeteria_pos_membership('{h.CAFETERIA}',"
         f"'{SUPERVISOR_PERSON}','pos_supervisor','active');")
    result = json.loads(call(h.SUPERVISOR, report(authority_response, "submitted")))
    if result["state"] != "submitted":
        raise AssertionError("Reactivated exact member could not report its current claim.")

    counts = h.query(
        "select count(*) from public.receipt_print_jobs j "
        f"where j.purchase_id in ('{purchase_id}','{independent_purchase}','{authority_purchase}');"
    )
    if int(counts) < 5:
        raise AssertionError(f"Unexpected receipt history count: {counts}")
    print(json.dumps({
        "iteration": iteration,
        "claim_race": "one claim; concurrent caller skipped locked job",
        "report_race": report_states,
        "identical_reprint_job": repeated[0]["job_id"],
        "different_reprints": [value["job_id"] for value in independent_results],
        "authority_race": [value["sqlstate"] for value in authority_race],
    }), flush=True)


def sale_from_open_session() -> str:
    session = h.open_session(ACTOR, REGISTER, ASSIGNMENT, "phase5b-authority-open-" + key())
    purchase_id = sale(session)
    version = h.query(f"select version from public.register_sessions where id='{session}';")
    call(ACTOR, "select * from public.close_my_register_session("
         f"'{session}',{version},0,'phase5b-authority-close-{key()}');")
    return purchase_id


def main() -> None:
    global ITERATIONS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, choices=[1, 10], default=10)
    args = parser.parse_args()
    ITERATIONS = args.iterations
    h.verify_local_db()
    if h.query("select count(*) from public.receipt_print_jobs;") != "0":
        raise RuntimeError("Refusing to run: receipt history is not empty; reset local DB first.")
    h.query(
        "update public.schools set business_timezone='Etc/GMT'||case "
        "when extract(hour from clock_timestamp() at time zone 'UTC')>=12 then '+' "
        "else '-' end||abs(extract(hour from clock_timestamp() at time zone 'UTC')::integer-12)::text "
        f"where id='{SCHOOL}';"
    )
    for iteration in range(1, ITERATIONS + 1):
        scenario(iteration)
    if race_harness.PROOFS < 3 * ITERATIONS or race_harness.INDEPENDENCE < 2 * ITERATIONS:
        raise AssertionError("Expected independent PostgreSQL lock/blocking evidence was incomplete.")
    print(json.dumps({
        "iterations": ITERATIONS,
        "blocking_proofs": race_harness.PROOFS,
        "independence_proofs": race_harness.INDEPENDENCE,
        "result": "PASS",
    }), flush=True)


if __name__ == "__main__":
    main()
