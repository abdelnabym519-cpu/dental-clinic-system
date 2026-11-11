#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/verify-local.sh — DenToRa gate runner for the USER'S machine.
#
# Usage (Git Bash, from the repository root):
#   ./scripts/verify-local.sh                  # run every gate
#   ./scripts/verify-local.sh --pull           # `git pull` first
#   ./scripts/verify-local.sh --install        # `npm install` first
#   ./scripts/verify-local.sh --pull --install # both
#
# Design rules (MASTER-DENTORA-ALL-IN-ONE.md §1):
#   * it NEVER stops at the first failing gate — every gate runs
#   * full log -> .local-logs/verify-local.log  (gitignored)
#   * it ends with ONE line you can paste straight back to the executor
#   * it NEVER prints .env CONTENTS (names only, and only in verify-ai.sh)
# ---------------------------------------------------------------------------
set -u

PULL=0
INSTALL=0
for a in "$@"; do
  case "$a" in
    --pull)    PULL=1 ;;
    --install) INSTALL=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown flag: $a   (allowed: --pull --install)"; exit 2 ;;
  esac
done

LOG_DIR=".local-logs"
LOG="$LOG_DIR/verify-local.log"
mkdir -p "$LOG_DIR"
: > "$LOG"
TMP_OUT="$LOG_DIR/.gate.out"

# --------------------------------------------------------------------------
# identity
# --------------------------------------------------------------------------
DATE=$(date '+%Y-%m-%d %H:%M:%S %Z')
NODE_V=$(node -v 2>/dev/null || echo "node MISSING")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
HEAD_S=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
DIRTY=$(git status --short 2>/dev/null | wc -l | tr -d ' ')

{
  echo "===== verify-local.sh ====="
  echo "date        : $DATE"
  echo "node        : $NODE_V"
  echo "branch      : $BRANCH"
  echo "HEAD        : $HEAD_S"
  echo "dirty files : $DIRTY"
  echo
} | tee -a "$LOG"

if [ "$PULL" = 1 ]; then
  echo "===== git pull (--pull) =====" | tee -a "$LOG"
  git pull 2>&1 | tee -a "$LOG"
  echo | tee -a "$LOG"
fi

if [ "$INSTALL" = 1 ]; then
  echo "===== npm install (--install) =====" | tee -a "$LOG"
  npm install 2>&1 | tee -a "$LOG"
  echo | tee -a "$LOG"
fi

# --------------------------------------------------------------------------
# gate runner
# --------------------------------------------------------------------------
GATE_NAMES=()
GATE_RC=()
GATE_NOTE=()

# Remove ANSI colour/escape sequences so summary greps can anchor on ^.
strip_ansi () {
  sed -e "s/$(printf '\033')\\[[0-9;]*[A-Za-z]//g" \
      -e "s/$(printf '\033')\][^$(printf '\007')]*$(printf '\007')//g"
}

note_for () {
  # Pull the one human-readable summary line out of a gate's output.
  local name="$1" f="$2" n=""
  case "$name" in
    typecheck|typecheck:vendor)
      n="$(grep -c 'error TS' "$f" | tr -d ' ') × 'error TS'" ;;
    lint)
      n="$(grep -E '[0-9]+ problems? \(' "$f" | tail -1)"
      [ -z "$n" ] && n="$(grep -cE 'error' "$f" | tr -d ' ') error-ish lines" ;;
    tests)
      # Vitest colourises its summary, so the lines begin with an ANSI escape
      # (\x1b[32m) — which is why a '^[[:space:]]*Test Files' grep matched
      # nothing and this row printed an empty detail. Strip ANSI first.
      local tf tt
      tf="$(strip_ansi <"$f" | grep -E 'Test Files' | tail -1 \
            | sed -e 's/^[[:space:]]*Test Files[[:space:]]*//' -e 's/[[:space:]]*$//')"
      tt="$(strip_ansi <"$f" | grep -E '^[[:space:]]*Tests[[:space:]]' | tail -1 \
            | sed -e 's/^[[:space:]]*Tests[[:space:]]*//' -e 's/[[:space:]]*$//')"
      [ -z "$tf" ] && tf="(no 'Test Files' line)"
      [ -z "$tt" ] && tt="(no 'Tests' line)"
      n="files: $tf ; tests: $tt" ;;
    build)
      n="$(grep -E 'Compiled successfully|Failed to compile|error during build|✓ Compiled' "$f" | tail -1)"
      [ -z "$n" ] && n="(no compile summary line)" ;;
  esac
  [ -z "$n" ] && n="(no summary line)"
  echo "$n"
}

run_gate () {
  local name="$1"; shift
  echo "---------------------------------------------------------------------" | tee -a "$LOG"
  echo "GATE: $name   ->  $*" | tee -a "$LOG"
  echo "---------------------------------------------------------------------" | tee -a "$LOG"
  "$@" >"$TMP_OUT" 2>&1
  local rc=$?
  tee -a "$LOG" < "$TMP_OUT"
  local note
  note=$(note_for "$name" "$TMP_OUT")
  GATE_NAMES+=("$name")
  GATE_RC+=("$rc")
  GATE_NOTE+=("$note")
  echo ">>> exit=$rc   $note" | tee -a "$LOG"
  echo | tee -a "$LOG"
}

run_gate typecheck        npx tsc --noEmit
run_gate typecheck:vendor npm run typecheck:vendor
run_gate lint             npx eslint .
run_gate tests            npx vitest run
run_gate build            npm run build

rm -f "$TMP_OUT"

# --------------------------------------------------------------------------
# non-command check: no 3D model file may ever be committed
# --------------------------------------------------------------------------
echo "---------------------------------------------------------------------" | tee -a "$LOG"
echo "CHECK: no 3D model files tracked by git" | tee -a "$LOG"
echo "---------------------------------------------------------------------" | tee -a "$LOG"
GLB_LIST=$(git ls-files | grep -Ei '\.glb$' || true)
if [ -z "$GLB_LIST" ]; then
  GLB_RC=0; GLB_NOTE="clean — 0 .glb files tracked"
else
  GLB_RC=1; GLB_NOTE="TRACKED MODEL FILES: $GLB_LIST"
fi
echo ">>> $GLB_NOTE" | tee -a "$LOG"
echo | tee -a "$LOG"

# --------------------------------------------------------------------------
# final table
# --------------------------------------------------------------------------
OVERALL=0
SUMMARY="branch=$BRANCH HEAD=$HEAD_S"

{
  echo "====================================================================="
  echo " FINAL TABLE — paste this back to the executor"
  echo "====================================================================="
  printf "%-20s %-7s %s\n" "GATE" "RESULT" "DETAIL"
  printf "%-20s %-7s %s\n" "--------------------" "-------" "------------------------------"
  i=0
  while [ $i -lt ${#GATE_NAMES[@]} ]; do
    if [ "${GATE_RC[$i]}" = 0 ]; then R="PASS"; else R="FAIL"; OVERALL=1; fi
    printf "%-20s %-7s %s\n" "${GATE_NAMES[$i]}" "$R" "${GATE_NOTE[$i]}"
    SUMMARY="$SUMMARY ${GATE_NAMES[$i]}=$R"
    i=$((i+1))
  done
  if [ "$GLB_RC" = 0 ]; then R="PASS"; else R="FAIL"; OVERALL=1; fi
  printf "%-20s %-7s %s\n" "no-glb-in-git" "$R" "$GLB_NOTE"
  SUMMARY="$SUMMARY no-glb-in-git=$R"
  echo
  echo "date=$DATE"
  echo "node=$NODE_V"
  echo "dirty_files=$DIRTY"
  echo "full log: $LOG"
  echo
  echo "PASTE THIS LINE TO THE EXECUTOR:"
  echo "$SUMMARY"
} | tee -a "$LOG"

exit 0
