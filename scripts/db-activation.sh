#!/bin/sh
# Separate local-only modern Auth profile; preserves the frozen DB-only foundation configuration.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
activation_root=/private/tmp/pikas-activation-local
if [ "$#" -ne 1 ]; then echo 'Usage: scripts/db-activation.sh {start|reset|test|lint|stop}' >&2; exit 2; fi
if [ -d /Applications/Docker.app/Contents/Resources/bin ]; then PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"; export PATH; fi
cli="$repo_root/node_modules/.bin/supabase"
case "$1" in start|reset|test|lint|stop) ;; *) echo 'Local activation commands only' >&2; exit 2;; esac
# Copy immutable inputs rather than write into the normal CLI workdir or link any remote project.
mkdir -p "$activation_root/supabase/migrations" "$activation_root/supabase/fixtures" "$activation_root/supabase/tests"
cp "$repo_root/supabase/activation/config.toml" "$activation_root/supabase/config.toml"
cp "$repo_root"/supabase/migrations/*.sql "$activation_root/supabase/migrations/"
cp "$repo_root/supabase/fixtures/foundation.sql" "$activation_root/supabase/fixtures/"
cp "$repo_root/supabase/tests/step4d5_account_activation.test.sql" "$activation_root/supabase/tests/"
case "$1" in
 start) exec "$cli" --workdir "$activation_root" start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor ;;
 reset) exec "$cli" --workdir "$activation_root" db reset --local --yes ;;
 test) exec "$cli" --workdir "$activation_root" test db "$activation_root/supabase/tests/step4d5_account_activation.test.sql" ;;
 lint) exec "$cli" --workdir "$activation_root" db lint --local --schema public,pikas_private --level warning --fail-on warning ;;
 stop) exec "$cli" --workdir "$activation_root" stop ;;
esac
