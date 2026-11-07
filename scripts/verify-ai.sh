#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/verify-ai.sh — AI runtime + storage + persistence health.
#
# Usage (Git Bash, from the repository root):
#   ./scripts/verify-ai.sh
#
# Answers one question: is the AI imaging stack healthy AND is the app's
# storage driver the SAME store the orchestrator reads? (The NoSuchKey class
# of bug is exactly a disagreement between those two — see PROGRESS.md P9.1.)
#
# Secrets discipline: this script prints variable NAMES only. The single
# exception is STORAGE_DRIVER, whose VALUE is printed because it names a
# driver, not a credential (no key, no endpoint, no password, no bucket).
# ---------------------------------------------------------------------------
set -u

LOG_DIR=".local-logs"
LOG="$LOG_DIR/verify-ai.log"
mkdir -p "$LOG_DIR"
: > "$LOG"

DATE=$(date '+%Y-%m-%d %H:%M:%S %Z')
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
HEAD_S=$(git rev-parse --short HEAD 2>/dev/null || echo "?")

say () { echo "$@" | tee -a "$LOG"; }

say "===== verify-ai.sh ====="
say "date   : $DATE"
say "branch : $BRANCH  HEAD: $HEAD_S"
say

SUMMARY="branch=$BRANCH HEAD=$HEAD_S"

# ---------------------------------------------------------------------------
# 1. containers
# ---------------------------------------------------------------------------
say "----- 1. docker compose -f ai-compose.yml ps -----"
if command -v docker >/dev/null 2>&1; then
  docker compose -f ai-compose.yml ps 2>&1 | tee -a "$LOG"
  DC_RC=${PIPESTATUS[0]}
else
  say "docker NOT INSTALLED — cannot inspect containers"
  DC_RC=1
fi
SUMMARY="$SUMMARY compose=$([ "$DC_RC" = 0 ] && echo UP || echo DOWN)"
say

# ---------------------------------------------------------------------------
# 2. orchestrator /health  — status + model_loaded per engine
# ---------------------------------------------------------------------------
say "----- 2. GET http://localhost:8000/health -----"
ORCH=$(curl -s --max-time 6 http://localhost:8000/health 2>/dev/null || true)
if [ -z "$ORCH" ]; then
  say "orchestrator /health: NO RESPONSE (is 'docker compose -f ai-compose.yml up -d' running?)"
  OSTATUS="unreachable"
  LOADED_COUNT="0"
  SUMMARY="$SUMMARY orchestrator=DOWN"
else
  # Flatten the JSON into "key: value" lines, then pull status + model_loaded
  # keyed by the enclosing engine object. No jq dependency (Git Bash safe).
  FLAT=$(printf '%s' "$ORCH" | tr ',{}' '\n\n\n' | sed 's/^[[:space:]]*//; s/"//g' | grep -v '^[[:space:]]*$')
  OSTATUS=$(printf '%s\n' "$FLAT" | awk -F': *' '/^status:/ {print $2; exit}')
  [ -z "$OSTATUS" ] && OSTATUS="(not reported)"
  say "orchestrator status: $OSTATUS"
  say "per-engine model_loaded:"
  printf '%s\n' "$FLAT" | awk -F': *' '
    /^[^:]+:[[:space:]]*$/ { obj=$1; next }
    /^model_loaded:/       { printf "   %-22s model_loaded=%s\n", obj, $2 }
  ' | tee -a "$LOG"
  LOADED_COUNT=$(printf '%s\n' "$FLAT" | grep -c '^model_loaded: *true' | tr -d ' ')
  TOTAL_ENGINES=$(printf '%s\n' "$FLAT" | grep -c '^model_loaded:' | tr -d ' ')
  say "engines with model_loaded=true : $LOADED_COUNT / $TOTAL_ENGINES"
  SUMMARY="$SUMMARY orchestrator=$OSTATUS model_loaded=$LOADED_COUNT/$TOTAL_ENGINES"
fi
say

# ---------------------------------------------------------------------------
# 3. model checksum manifest
# ---------------------------------------------------------------------------
say "----- 3. sha256sum -c ai-validation/models.sha256 -----"
MANIFEST="ai-validation/models.sha256"
if [ ! -f "$MANIFEST" ]; then
  say "MANIFEST MISSING: $MANIFEST"
  MAN_RC=1
else
  ENTRIES=$(grep -cvE '^(#|$)' "$MANIFEST" | tr -d ' ')
  say "manifest entries: $ENTRIES"
  if [ "$ENTRIES" = "0" ]; then
    say "MANIFEST IS EMPTY/PLACEHOLDER — model files are not present in this"
    say "worktree. Generate it after placing the weights:"
    say "    ./scripts/3d-assets/../.. (see docs/USER-VERIFY.md, section 'models')"
    say "    ( cd ai-validation && sha256sum <each model file> > models.sha256 )"
    MAN_RC=1
  else
    ( cd ai-validation && sha256sum -c models.sha256 2>&1 ) | tee -a "$LOG"
    MAN_RC=${PIPESTATUS[0]}
  fi
fi
SUMMARY="$SUMMARY model_checksums=$([ "$MAN_RC" = 0 ] && echo OK || echo FAIL)"
say

# ---------------------------------------------------------------------------
# 4. MinIO
# ---------------------------------------------------------------------------
say "----- 4. MinIO health -----"
MINIO_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:9000/minio/health/live 2>/dev/null || true)
[ -z "$MINIO_CODE" ] && MINIO_CODE="000-no-response"
say "GET http://localhost:9000/minio/health/live -> HTTP $MINIO_CODE"
SUMMARY="$SUMMARY minio=$MINIO_CODE"
say

# ---------------------------------------------------------------------------
# 5. app session route
# ---------------------------------------------------------------------------
say "----- 5. GET /api/auth/session -----"
SESS_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 http://localhost:3000/api/auth/session 2>/dev/null || true)
[ -z "$SESS_CODE" ] && SESS_CODE="000-no-response"
say "GET http://localhost:3000/api/auth/session -> HTTP $SESS_CODE"
SUMMARY="$SUMMARY session=$SESS_CODE"
say

# ---------------------------------------------------------------------------
# 6. migrations
# ---------------------------------------------------------------------------
say "----- 6. npx prisma migrate status -----"
npx prisma migrate status 2>&1 | tail -20 | tee -a "$LOG"
MIG_RC=${PIPESTATUS[0]}
SUMMARY="$SUMMARY migrate_status_rc=$MIG_RC"
say

# ---------------------------------------------------------------------------
# 7. .env vs .env.example — NAMES ONLY
# ---------------------------------------------------------------------------
say "----- 7. .env variable NAMES missing vs .env.example (names only) -----"
if [ ! -f .env ]; then
  say "NO .env FILE — run: npm run setup:dev"
  MISSING_COUNT="n/a"
  SUMMARY="$SUMMARY env=MISSING"
else
  NAMES_EX=$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*' .env.example | sort -u)
  MISSING=""
  for n in $NAMES_EX; do
    grep -qE "^[[:space:]]*(export[[:space:]]+)?${n}=" .env || MISSING="$MISSING $n"
  done
  MISSING_COUNT=$(echo "$MISSING" | wc -w | tr -d ' ')
  if [ "$MISSING_COUNT" = "0" ]; then
    say "none — every name in .env.example is present in .env"
  else
    say "MISSING NAMES ($MISSING_COUNT): $MISSING"
  fi
  SUMMARY="$SUMMARY env_missing_names=$MISSING_COUNT"
fi
say

# ---------------------------------------------------------------------------
# 8. STORAGE_DRIVER — the one value we print (it is not a secret)
# ---------------------------------------------------------------------------
say "----- 8. storage driver -----"
if [ -f .env ]; then
  SD_RAW=$(grep -E '^[[:space:]]*(export[[:space:]]+)?STORAGE_DRIVER=' .env | head -1 | sed 's/^[^=]*=//')
  SD=$(printf '%s' "$SD_RAW" | tr -d '"' | tr -d "'" | tr -d ' ')
  [ -z "$SD" ] && SD="unset-defaults-to-local"
else
  SD="no-env-defaults-to-local"
fi
say "STORAGE_DRIVER = $SD"
say "UPLOAD_DIR / S3 endpoint / access keys are NOT printed (they are credentials)."
SUMMARY="$SUMMARY STORAGE_DRIVER=$SD"
say

say "====================================================================="
say " PASTE THIS LINE TO THE EXECUTOR:"
say "$SUMMARY"
say "====================================================================="
say "full log: $LOG"

exit 0
