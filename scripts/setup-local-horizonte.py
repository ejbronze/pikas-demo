#!/usr/bin/env python3
"""LOCAL ONLY: restore committed fictional Horizonte fixtures, never remote data.

Preserves foundation tenants. Reads fixture/bootstrap SQL from Git HEAD, not
mutable migration files. Only --web selects the isolated local pikas-4d6 project. No URL or remote flags.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DOCKER = shutil.which("docker") or "/Applications/Docker.app/Contents/Resources/bin/docker"
CONTAINER = "supabase_db_pikas-foundation"
CMD = [DOCKER, "exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]


def run(sql):
    result = subprocess.run(CMD, input=sql, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def committed(path):
    return subprocess.check_output(["git", "show", "HEAD:" + path], cwd=ROOT, text=True)


def main():
    if sys.argv[1:] not in ([], ["--web"]):
        raise RuntimeError("Only --web (isolated local pikas-4d6) is accepted")
    global CONTAINER, CMD
    project = "pikas-4d6" if sys.argv[1:] else "pikas-foundation"
    CONTAINER = "supabase_db_" + project
    CMD[3] = CONTAINER
    endpoint = os.environ.get("DOCKER_HOST") or subprocess.check_output(
        [DOCKER, "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], text=True).strip()
    if endpoint not in {"unix:///var/run/docker.sock", "unix://" + str(Path.home() / ".docker/run/docker.sock")}:
        raise RuntimeError("Refusing non-local Docker")
    label = subprocess.check_output([DOCKER, "inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', CONTAINER], text=True).strip()
    if label != project:
        raise RuntimeError("Refusing unexpected Docker project")
    test = committed("supabase/tests/step4c_pilot_ready.test.sql")
    fixture = test.split("-- Synthetic fixture identities only;", 1)[1].split("create temp table before_bootstrap", 1)[0]
    fixture = fixture[fixture.index("insert into auth.users"):]
    # User-specified canonical codes replace only the synthetic test aliases.
    for old, new in [("'HZ-4C'", "'COLEGIO-HORIZONTE'"), ("'HZ'", "'HORIZONTE'"),
                     ("'PRINCIPAL'", "'SEDE-PRINCIPAL'"), ("'CAF'", "'CAFETERIA-ESCOLAR'")]:
        fixture = fixture.replace(old, new)
    source = committed("supabase/migrations/202610090006_horizonte_pilot_ready.sql")
    start = source.index("do $bootstrap$")
    bootstrap = source[start:source.index("$bootstrap$;", start) + len("$bootstrap$;")]
    exists = run("select exists(select 1 from public.accounts where id='03e71159-69e9-4387-9b3b-65799d49faf0');") == "t"
    run("begin;\n" + ("" if exists else fixture) + bootstrap + "\ncommit;")
    # After a clean reset, migrations precede fixtures. Run only the new persona
    # bootstrap if its schema is installed; never rerun DDL or old production migrations.
    if run("select to_regprocedure('pikas_private.sandbox_validated_pov()') is not null;") == "t":
        source = (ROOT / "supabase/migrations/202610120002_sandbox_admin_pov.sql").read_text()
        start = source.index("do $personas$")
        block = source[start:source.index("end $personas$;", start) + len("end $personas$;")]
        run("begin;\n" + block + "\ncommit;")
    print("Local Horizonte baseline " + ("verified without refilling/resetting data" if exists else "restored from committed Step 4C fixture and pilot bootstrap"))


if __name__ == "__main__":
    main()
