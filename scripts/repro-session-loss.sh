#!/usr/bin/env bash
# repro-session-loss.sh — try to reproduce "No active pmem session found" loss.
#
# This script runs N cycles of `pmem session start` + `pmem session end` and
# reports how many `session end` calls observed "No active pmem session".
#
# Usage:
#   ./scripts/repro-session-loss.sh                    # 20 cycles, default project
#   N_CYCLES=50 ./scripts/repro-session-loss.sh        # 50 cycles
#   PROJECT_DIR=/tmp/foo ./scripts/repro-session-loss.sh
#
# Exit codes:
#   0 — completed (regardless of repro success); inspect output for failure rate.
#   2 — environment / setup error.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
N_CYCLES="${N_CYCLES:-20}"
PROJECT_DIR="${PROJECT_DIR:-${REPO_ROOT}/temp/polish-5-test}"

if [ ! -d "${PROJECT_DIR}" ]; then
  mkdir -p "${PROJECT_DIR}" || { echo "Cannot create ${PROJECT_DIR}"; exit 2; }
fi

cd "${PROJECT_DIR}" || { echo "Cannot cd ${PROJECT_DIR}"; exit 2; }

if [ ! -d ".pmem" ]; then
  echo "Initializing pmem in ${PROJECT_DIR}..."
  npx ts-node "${REPO_ROOT}/src/index.ts" init "$(basename "${PROJECT_DIR}")" >/dev/null 2>&1 || {
    echo "pmem init failed"; exit 2;
  }
  npx ts-node "${REPO_ROOT}/src/index.ts" rebuild >/dev/null 2>&1
fi

# Ensure no leftover active session.
npx ts-node "${REPO_ROOT}/src/index.ts" session end -s "cleanup" >/dev/null 2>&1 || true

FAILURES=0
START_FAILURES=0
END_FAILURES=0

# Scenario A — plain start/end cycles
echo "Scenario A: ${N_CYCLES} plain start/end cycles..."
for i in $(seq 1 "${N_CYCLES}"); do
  START_OUT=$(npx ts-node "${REPO_ROOT}/src/index.ts" session start -a "ReproAgent" 2>&1)
  END_OUT=$(npx ts-node "${REPO_ROOT}/src/index.ts" session end -s "cycle-${i}" 2>&1)

  if ! echo "${START_OUT}" | grep -q "Session started:"; then
    START_FAILURES=$((START_FAILURES + 1))
    printf "  A cycle %02d START unexpected:\n%s\n" "${i}" "${START_OUT}"
  fi

  if echo "${END_OUT}" | grep -q "No active pmem session found"; then
    END_FAILURES=$((END_FAILURES + 1))
    FAILURES=$((FAILURES + 1))
    printf "  A cycle %02d END  lost session:\n%s\n" "${i}" "${END_OUT}"
  fi
done

# Scenario B — start, then rebuild --full, then end.
# This is the v0.6.4-confirmed root cause: rebuild --full wipes the sessions
# table, so session end could not find the active session.
echo "Scenario B: start -> rebuild --full -> end (v0.6.4 root-cause path)..."
B_FAIL=0
npx ts-node "${REPO_ROOT}/src/index.ts" session start -a "ReproRebuild" >/dev/null 2>&1
npx ts-node "${REPO_ROOT}/src/index.ts" rebuild --full >/dev/null 2>&1
END_OUT=$(npx ts-node "${REPO_ROOT}/src/index.ts" session end -s "post-full-rebuild" 2>&1)
if echo "${END_OUT}" | grep -q "No active pmem session found"; then
  B_FAIL=1
  FAILURES=$((FAILURES + 1))
  echo "  B: REPRODUCED — rebuild --full wiped active session:"
  echo "${END_OUT}" | sed 's/^/    /'
else
  echo "  B: FIXED — active session preserved across rebuild --full"
fi

echo "----"
echo "cycles      : ${N_CYCLES}"
echo "A start fails : ${START_FAILURES}"
echo "A end   losses: ${END_FAILURES}"
echo "B end   loss  : ${B_FAIL}"
echo "total fails : ${FAILURES}"

if [ "${FAILURES}" -gt 0 ]; then
  echo "RESULT: reproduced (${FAILURES} failure(s))"
else
  echo "RESULT: not reproduced (0 failures across all scenarios)"
fi

exit 0
