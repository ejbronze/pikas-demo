#!/usr/bin/env python3
"""Explicit LOCAL ONLY test reset: Auth-enabled pikas-4d6 on 55641/55642.

Stages repository migrations/fixtures under /private/tmp; never links a remote
project, loads .env, or accepts a URL/target. Normal reset recreates synthetic
foundation tenants, then restores the fictional Horizonte baseline.
"""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
STAGE = Path('/private/tmp/pikas-4d6-local')
CLI = ROOT / 'node_modules/.bin/supabase'
CONFIG = '''# Explicit local-only 4D.6 validation project.
project_id = "pikas-4d6"
[api]
enabled = true
port = 55641
schemas = ["public"]
extra_search_path = ["public", "extensions"]
[db]
port = 55642
shadow_port = 55640
major_version = 17
[db.migrations]
enabled = false
[db.seed]
enabled = false
sql_paths = ["./fixtures/foundation.sql"]
[studio]
enabled = false
[local_smtp]
enabled = false
[storage]
enabled = false
[realtime]
enabled = false
[auth]
enabled = true
site_url = "http://localhost:3000"
enable_signup = false
[auth.email]
enable_signup = true
enable_confirmations = true
[edge_runtime]
enabled = false
[analytics]
enabled = false
'''


def main():
    if len(sys.argv) != 1:
        raise RuntimeError('No arguments/remote targets accepted')
    p = STAGE / 'supabase'
    p.mkdir(parents=True, exist_ok=True)
    for name in ('migrations', 'fixtures'):
        shutil.rmtree(p / name, ignore_errors=True)
        shutil.copytree(ROOT / 'supabase' / name, p / name)
    (p / 'config.toml').write_text(CONFIG)
    # Initialize GoTrue's schema before applying frozen 4D.5 SQL that depends on it.
    result = subprocess.run([str(CLI), '--workdir', str(STAGE), 'start', '-x', 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    # Don't print local keys from CLI start output.
    (p / 'config.toml').write_text(CONFIG.replace('[db.migrations]\nenabled = false', '[db.migrations]\nenabled = true').replace('[db.seed]\nenabled = false', '[db.seed]\nenabled = true'))
    subprocess.run([str(CLI), '--workdir', str(STAGE), 'db', 'reset', '--local', '--yes'], check=True)
    subprocess.run([sys.executable, str(ROOT / 'scripts/setup-local-horizonte.py'), '--web'], check=True)
    print('Local-only Auth-enabled migration chain + fictional baseline ready.')


if __name__ == '__main__':
    main()
