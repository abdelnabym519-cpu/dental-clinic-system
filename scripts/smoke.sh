#!/bin/sh
# ============================================================================
# Phase 11 — post-deployment smoke tests (§58).
#
#   ./scripts/smoke.sh                     # unauthenticated subset
#   SMOKE_EMAIL=... SMOKE_PASSWORD=... ./scripts/smoke.sh   # + authenticated flow
#
# Unauthenticated subset (always runs, deterministic):
#   - /api/health answers ok with a version
#   - /api/ready answers ready (database gate)
#   - the login page renders
#   - protected AI endpoints answer 401 (auth gate alive, nothing leaks)
#
# Authenticated subset (only with SMOKE_EMAIL/SMOKE_PASSWORD — use a synthetic
# test account, never a real clinician): NextAuth credentials login via the
# CSRF dance, then patient-scoped reads through the session cookie.
#
# Uses synthetic data references only; never mutates clinical records.
# ============================================================================
set -eu

BASE_URL="${DENTORA_BASE_URL:-http://127.0.0.1:3000}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

fail() { echo "[smoke] FAIL: $1" >&2; exit 1; }
pass() { echo "[smoke] ok: $1"; }

# ---- unauthenticated subset -------------------------------------------------
node -e "fetch('$BASE_URL/api/health').then(async r=>{const j=await r.json();if(!r.ok||!j.version)process.exit(1);console.log(j.version)}).catch(()=>process.exit(1))" > /tmp/smoke-ver.$$ || fail "/api/health not ok"
pass "/api/health ok (version $(cat /tmp/smoke-ver.$$))"
rm -f "/tmp/smoke-ver.$$"

node -e "fetch('$BASE_URL/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || fail "/api/ready not ready"
pass "/api/ready ok (database gate)"

CODE=$(node -e "fetch('$BASE_URL/login').then(r=>process.exit(r.status)).catch(()=>process.exit(1))")
[ "$CODE" = "200" ] || fail "login page returned $CODE"
pass "login page renders"

CODE=$(node -e "fetch('$BASE_URL/api/ai/agent',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>process.exit(r.status)).catch(()=>process.exit(1))")
[ "$CODE" = "401" ] || fail "unauthenticated /api/ai/agent returned $CODE (expected 401)"
pass "agent API auth gate alive (401)"

CODE=$(node -e "fetch('$BASE_URL/api/ai/voice/turn',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>process.exit(r.status)).catch(()=>process.exit(1))")
[ "$CODE" = "401" ] || fail "unauthenticated voice turn returned $CODE (expected 401)"
pass "voice API auth gate alive (401)"

# ---- authenticated subset (optional) ----------------------------------------
if [ -n "${SMOKE_EMAIL:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  echo "[smoke] authenticated flow (synthetic account)"

  CSRF=$(curl -s -c "$JAR" "$BASE_URL/api/auth/csrf" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).csrfToken))")
  [ -n "$CSRF" ] || fail "could not fetch CSRF token"

  LOGIN_CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" \
    -H 'content-type: application/x-www-form-urlencoded' -H "x-csrf-token: $CSRF" \
    --data-urlencode "csrfToken=$CSRF" \
    --data-urlencode "email=$SMOKE_EMAIL" \
    --data-urlencode "password=$SMOKE_PASSWORD" \
    --data-urlencode "redirect=false" \
    "$BASE_URL/api/auth/callback/credentials")
  case "$LOGIN_CODE" in
    200|302) pass "credentials login accepted ($LOGIN_CODE)" ;;
    *) fail "credentials login failed ($LOGIN_CODE)" ;;
  esac

  # Patient-scoped read through the session (staff endpoint; role decides).
  PAT_CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE_URL/api/patients")
  case "$PAT_CODE" in
    200) pass "patient scope read ok" ;;
    403) pass "patient scope correctly forbidden for this role" ;;
    *) fail "patient scope read returned $PAT_CODE" ;;
  esac
else
  echo "[smoke] authenticated subset skipped (set SMOKE_EMAIL/SMOKE_PASSWORD with a SYNTHETIC account)"
fi

echo "[smoke] ALL PASSED"
