#!/bin/sh
# Local-only entry point. No arbitrary flags, remote URLs, linking, or production seed actions.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$#" -ne 1 ]; then
  echo 'Usage: scripts/db-foundation.sh {start|reset|test|lint|stop}' >&2
  exit 2
fi
if [ -d /Applications/Docker.app/Contents/Resources/bin ]; then
  PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
  export PATH
fi
cli="$repo_root/node_modules/.bin/supabase"
if [ ! -x "$cli" ]; then
  echo 'Missing repository Supabase CLI. Install the locked npm dependencies first.' >&2
  exit 1
fi
case "$1" in
  start)
    exec "$cli" --workdir "$repo_root" start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
    ;;
  reset) exec "$cli" --workdir "$repo_root" db reset --local --yes ;;
  test) exec "$cli" --workdir "$repo_root" test db ;;
  lint) exec "$cli" --workdir "$repo_root" db lint --local --schema public,pikas_private --level warning --fail-on warning ;;
  stop) exec "$cli" --workdir "$repo_root" stop ;;
  *) echo 'Only start, reset, test, lint and stop are supported. Remote flags are not accepted.' >&2; exit 2 ;;
esac
