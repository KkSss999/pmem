#!/usr/bin/env bash

set -euo pipefail

PACKAGE_NAME="${1:?Usage: wait-for-npm-package.sh <package> <version>}"
PACKAGE_VERSION="${2:?Usage: wait-for-npm-package.sh <package> <version>}"
ATTEMPTS="${NPM_VISIBILITY_ATTEMPTS:-90}"
INTERVAL_SECONDS="${NPM_VISIBILITY_INTERVAL_SECONDS:-10}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_ROOT="${NPM_VISIBILITY_PACK_DIR:-${RUNNER_TEMP:-/tmp}/npm-registry-smoke}"
SAFE_PACKAGE_NAME="${PACKAGE_NAME//\//-}"
PACKAGE_PACK_DIR="$PACK_ROOT/$SAFE_PACKAGE_NAME-$PACKAGE_VERSION"

if [[ ! "$ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || [[ ! "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "Visibility attempts and interval must be non-negative integers (attempts must be at least 1)." >&2
  exit 2
fi

mkdir -p "$PACKAGE_PACK_DIR"

for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
  STATE="$(node "$SCRIPT_DIR/npm-release-state.js" "$PACKAGE_NAME" "$PACKAGE_VERSION")"
  if [ "$STATE" = "public" ]; then
    PACK_ERROR="$(mktemp)"
    set +e
    TARBALL="$(npm pack \
      --silent \
      --pack-destination "$PACKAGE_PACK_DIR" \
      "$PACKAGE_NAME@$PACKAGE_VERSION" 2>"$PACK_ERROR")"
    PACK_STATUS=$?
    set -e
    if [ "$PACK_STATUS" -eq 0 ]; then
      echo "$PACKAGE_NAME@$PACKAGE_VERSION is publicly installable ($TARBALL)."
      exit 0
    fi
    if ! grep -qE 'E404|404 Not Found' "$PACK_ERROR"; then
      echo "Public tarball verification failed unexpectedly for $PACKAGE_NAME@$PACKAGE_VERSION:" >&2
      cat "$PACK_ERROR" >&2
      exit "$PACK_STATUS"
    fi
    STATE="public_metadata_tarball_pending"
  fi

  echo "Waiting for $PACKAGE_NAME@$PACKAGE_VERSION public installability: $STATE ($attempt/$ATTEMPTS)"
  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    sleep "$INTERVAL_SECONDS"
  fi
done

echo "$PACKAGE_NAME@$PACKAGE_VERSION was not publicly installable after $ATTEMPTS attempts." >&2
node "$SCRIPT_DIR/npm-release-state.js" "$PACKAGE_NAME" "$PACKAGE_VERSION" >&2
exit 1
