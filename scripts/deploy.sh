#!/bin/sh
# ============================================================================
# Phase 11 — deterministic deployment (§55/§76).
#
#   ./scripts/deploy.sh [--skip-backup]
#
# Stages (each fails the whole deployment safely):
#   1. preflight        environment contract validation (fail fast, §8)
#   2. backup/checkpoint  scripts/backup.sh (unless --skip-backup; REQUIRED
#                         proof-of-backup before any migration in production)
#   3. migration        prisma migrate deploy (NEVER reset/dev, §9/§56)
#   4. application      docker compose up -d app (and workers, if any)
#   5. health           poll /api/health (liveness)
#   6. readiness        poll /api/ready  (database gate)
#   7. smoke            scripts/smoke.sh
#   8. release          print the confirmation line (version + revision)
#
# Rollback (§77): if any stage after 3 fails, the previous application image
# is still running for stages 4-7 failures (compose keeps the old container
# until the new one is healthy); for a migration failure, STOP — restoring
# means scripts/restore.sh of the stage-2 backup, never a destructive reset.
# ============================================================================
set -eu

SKIP_BACKUP=0
[ "${1:-}" = "--skip-backup" ] && SKIP_BACKUP=1

echo "[deploy] 1/8 preflight: environment contract"
if [ -f .env ]; then
  # Load for the preflight check only; never printed.
  set -a; . ./.env; set +a
fi
# The environment validator is TS; run it through the repo runner. It names
# variables, never values — no secret material in deploy output.
npx tsx -e '
import { validateEnvironment, currentEnvironment } from "./lib/config/env";
const problems = validateEnvironment();
if (problems.length > 0) {
  for (const p of problems) console.error(`[preflight] ${p.kind}: ${p.detail}`);
  process.exit(1);
}
console.log(`[preflight] environment=${currentEnvironment()} OK`);
'

echo "[deploy] 2/8 backup checkpoint"
if [ "$SKIP_BACKUP" = "1" ]; then
  echo "[deploy]   --skip-backup: YOU ARE DEPLOYING WITHOUT A FRESH BACKUP"
else
  if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -qx mysql; then
    ./scripts/backup.sh
  else
    if [ -f .env ]; then
      echo "[deploy]   FATAL: production deployments require a verified backup (no running mysql found)" >&2
      exit 1
    fi
    echo "[deploy]   no docker stack detected — skipping backup (non-production?)"
  fi
fi

echo "[deploy] 3/8 migrations (prisma migrate deploy — never reset)"
npx prisma migrate deploy

echo "[deploy] 4/8 application"
if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  docker compose up -d app
else
  echo "[deploy]   no compose stack — ensure the app is started by your process manager"
fi

echo "[deploy] 5/8 health (liveness)"
BASE_URL="${DENTORA_BASE_URL:-http://127.0.0.1:3000}"
i=0
while [ "$i" -lt 30 ]; do
  if node -e "fetch('$BASE_URL/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "[deploy]   healthy"
    break
  fi
  i=$((i+1)); sleep 2
done
[ "$i" -lt 30 ] || { echo "[deploy]   FATAL: liveness never came up at $BASE_URL" >&2; exit 1; }

echo "[deploy] 6/8 readiness (database gate)"
i=0
while [ "$i" -lt 30 ]; do
  if node -e "fetch('$BASE_URL/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "[deploy]   ready"
    break
  fi
  i=$((i+1)); sleep 2
done
[ "$i" -lt 30 ] || { echo "[deploy]   FATAL: readiness never passed at $BASE_URL (database?)" >&2; exit 1; }

echo "[deploy] 7/8 smoke tests"
if [ -f ./scripts/smoke.sh ]; then
  DENTORA_BASE_URL="$BASE_URL" ./scripts/smoke.sh
else
  echo "[deploy]   smoke.sh missing — deployment continues but is NOT release-confirmed"
fi

echo "[deploy] 8/8 release confirmation"
node -e "fetch('$BASE_URL/api/health').then(r=>r.json()).then(j=>console.log('[deploy] RELEASED:', j.version, j.revision||'(dev)', j.environment)).catch(()=>process.exit(1))"
