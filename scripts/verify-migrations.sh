#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
verify_dir="$(mktemp -d "${TMPDIR:-/tmp}/conference-ops-migrations.XXXXXX")"

cleanup() {
  case "$verify_dir" in
    */conference-ops-migrations.*) rm -rf -- "$verify_dir" ;;
    *) echo "Refusing to remove unexpected verification directory: $verify_dir" >&2 ;;
  esac
}
trap cleanup EXIT

cd "$project_dir"
mkdir -p "$verify_dir/artifacts" "$verify_dir/state"

DEMO_USER_PASSWORD="local-verification-password" \
  node scripts/render-demo-seed.mjs --out-file "$verify_dir/artifacts/demo-seed.sql"

pnpm exec wrangler d1 migrations apply DB \
  --local \
  --persist-to "$verify_dir/state" \
  --config wrangler.jsonc

pnpm exec wrangler d1 execute DB \
  --local \
  --persist-to "$verify_dir/state" \
  --config wrangler.jsonc \
  --file "$verify_dir/artifacts/demo-seed.sql"

# The seed is deliberately repeatable for an ephemeral demo environment.
pnpm exec wrangler d1 execute DB \
  --local \
  --persist-to "$verify_dir/state" \
  --config wrangler.jsonc \
  --file "$verify_dir/artifacts/demo-seed.sql"

verification_json="$(pnpm exec wrangler d1 execute DB \
  --local \
  --json \
  --persist-to "$verify_dir/state" \
  --config wrangler.jsonc \
  --command "SELECT (SELECT COUNT(*) FROM user) AS users, (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM proposals) AS proposals, (SELECT COUNT(*) FROM program_sessions) AS sessions, (SELECT COUNT(*) FROM speaker_tasks) AS tasks, (SELECT COUNT(*) FROM task_responses) AS task_responses, (SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreign_key_violations;")"

node -e '
  const payload = JSON.parse(process.argv[1]);
  const row = payload[0]?.results?.[0];
  const expected = { users: 4, events: 1, proposals: 6, sessions: 4, tasks: 6, task_responses: 1, foreign_key_violations: 0 };
  if (!row) throw new Error("D1 verification returned no count row");
  for (const [key, value] of Object.entries(expected)) {
    if (Number(row[key]) !== value) throw new Error(`Expected ${key}=${value}; received ${row[key]}`);
  }
  process.stdout.write(`${JSON.stringify({ migrationVerification: "passed", ...row })}\n`);
' "$verification_json"
