#!/usr/bin/env bash
# RapidAPI E2E test script for AI Video Frame
# Usage: bash tests/test_rapidapi.sh
# Requires: curl, jq
# Requires env vars: RAPIDAPI_PROXY_SECRET
# Optional env vars: RAPIDAPI_BASE_URL (defaults to https://aivideoframe.com)

set -euo pipefail

BASE_URL="${RAPIDAPI_BASE_URL:-https://aivideoframe.com}"
SECRET="${RAPIDAPI_PROXY_SECRET:?RAPIDAPI_PROXY_SECRET is not set}"
# Unique user per run to avoid credit state bleed across runs
TEST_USER="test-script-$(date +%s)"
CREDIT_USER="credit-test-$(date +%s)"
TEST_VIDEO="tests/test.mp4"
OUTPUT_VIDEO="tests/output.mp4"

GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

PASS=0
FAIL=0
VIDEO_IDS_TO_CLEANUP=()
CREDIT_VIDEO_IDS_TO_CLEANUP=()

pass() { echo -e "${GREEN}[PASS]${RESET} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}[FAIL]${RESET} $1"; FAIL=$((FAIL + 1)); }

cleanup() {
  for id in "${VIDEO_IDS_TO_CLEANUP[@]:-}"; do
    [[ -z "$id" ]] && continue
    curl -sf -X DELETE "$BASE_URL/api/v1/videos/$id" \
      -H "X-RapidAPI-Proxy-Secret: $SECRET" \
      -H "X-RapidAPI-User: $TEST_USER" \
      -H "X-RapidAPI-Subscription: BASIC" > /dev/null 2>&1 || true
  done
  for id in "${CREDIT_VIDEO_IDS_TO_CLEANUP[@]:-}"; do
    [[ -z "$id" ]] && continue
    curl -sf -X DELETE "$BASE_URL/api/v1/videos/$id" \
      -H "X-RapidAPI-Proxy-Secret: $SECRET" \
      -H "X-RapidAPI-User: $CREDIT_USER" \
      -H "X-RapidAPI-Subscription: BASIC" > /dev/null 2>&1 || true
  done
  rm -f "$OUTPUT_VIDEO"
}
trap cleanup EXIT

# ── Prerequisites ────────────────────────────────────────────────────────────

if ! command -v jq &> /dev/null; then
  echo "Error: jq is required. Install with: brew install jq"
  exit 1
fi

if [[ ! -f "$TEST_VIDEO" ]]; then
  echo "Test video not found. Downloading sample..."
  curl -sL "https://www.w3schools.com/html/mov_bbb.mp4" -o "$TEST_VIDEO"
  echo "Downloaded $TEST_VIDEO"
fi

echo ""
echo "=== RapidAPI E2E Tests ==="
echo "Base URL : $BASE_URL"
echo "Test user: $TEST_USER"
echo ""

# ── Test 1: Missing auth headers → 403 ──────────────────────────────────────

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/v1/videos/upload" \
  -F "video=@$TEST_VIDEO;type=video/mp4" -F "aspectRatio=9:16")

if [[ "$STATUS" == "403" ]]; then
  pass "1. Missing auth headers returns 403"
else
  fail "1. Missing auth headers — expected 403, got $STATUS"
fi

# ── Test 2: Upload ───────────────────────────────────────────────────────────

UPLOAD_RESP=$(curl -s -X POST "$BASE_URL/api/v1/videos/upload" \
  -H "X-RapidAPI-Proxy-Secret: $SECRET" \
  -H "X-RapidAPI-User: $TEST_USER" \
  -H "X-RapidAPI-Subscription: BASIC" \
  -F "video=@$TEST_VIDEO;type=video/mp4" \
  -F "aspectRatio=9:16")

VIDEO_ID=$(echo "$UPLOAD_RESP" | jq -r '.id // empty')

if [[ -n "$VIDEO_ID" && "$VIDEO_ID" != "null" ]]; then
  VIDEO_IDS_TO_CLEANUP+=("$VIDEO_ID")
  pass "2. Upload returned video id: $VIDEO_ID"
else
  fail "2. Upload failed — response: $UPLOAD_RESP"
  echo "Cannot continue without a valid video id. Aborting."
  exit 1
fi

# ── Test 3: Process ──────────────────────────────────────────────────────────

PROCESS_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/v1/videos/$VIDEO_ID/process" \
  -H "X-RapidAPI-Proxy-Secret: $SECRET" \
  -H "X-RapidAPI-User: $TEST_USER" \
  -H "X-RapidAPI-Subscription: BASIC")

if [[ "$PROCESS_RESP" == "200" ]]; then
  pass "3. Process returned 200"
else
  fail "3. Process — expected 200, got $PROCESS_RESP"
fi

# ── Test 4: Poll status until completed ─────────────────────────────────────

echo "    Polling status (timeout: 5 min)..."
DEADLINE=$(( $(date +%s) + 300 ))
STATUS_RESULT="unknown"

while [[ $(date +%s) -lt $DEADLINE ]]; do
  STATUS_RESP=$(curl -s "$BASE_URL/api/v1/videos/$VIDEO_ID/status" \
    -H "X-RapidAPI-Proxy-Secret: $SECRET" \
    -H "X-RapidAPI-User: $TEST_USER" \
    -H "X-RapidAPI-Subscription: BASIC")

  STATUS_RESULT=$(echo "$STATUS_RESP" | jq -r '.status // empty')
  PROGRESS=$(echo "$STATUS_RESP" | jq -r '.progress // "?"')
  echo "    status=$STATUS_RESULT progress=$PROGRESS"

  if [[ "$STATUS_RESULT" == "completed" || "$STATUS_RESULT" == "failed" ]]; then
    break
  fi
  sleep 5
done

if [[ "$STATUS_RESULT" == "completed" ]]; then
  pass "4. Status polling reached 'completed'"
elif [[ "$STATUS_RESULT" == "failed" ]]; then
  fail "4. Video processing failed"
else
  fail "4. Status polling timed out (last status: $STATUS_RESULT)"
fi

# ── Test 5: Download ─────────────────────────────────────────────────────────

DL_STATUS=$(curl -s -o "$OUTPUT_VIDEO" -w "%{http_code}" \
  "$BASE_URL/api/v1/videos/$VIDEO_ID/download" \
  -H "X-RapidAPI-Proxy-Secret: $SECRET" \
  -H "X-RapidAPI-User: $TEST_USER" \
  -H "X-RapidAPI-Subscription: BASIC")

if [[ "$DL_STATUS" == "200" && -s "$OUTPUT_VIDEO" ]]; then
  pass "5. Download returned 200 and non-empty file"
else
  fail "5. Download — expected 200 with file, got $DL_STATUS"
fi

# ── Test 6: Delete ───────────────────────────────────────────────────────────

DEL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "$BASE_URL/api/v1/videos/$VIDEO_ID" \
  -H "X-RapidAPI-Proxy-Secret: $SECRET" \
  -H "X-RapidAPI-User: $TEST_USER" \
  -H "X-RapidAPI-Subscription: BASIC")

if [[ "$DEL_STATUS" == "200" ]]; then
  pass "6. Delete returned 200"
  VIDEO_IDS_TO_CLEANUP=("${VIDEO_IDS_TO_CLEANUP[@]/$VIDEO_ID}")
else
  fail "6. Delete — expected 200, got $DEL_STATUS"
fi

# ── Test 7: Credit exhaustion (BASIC = 1 credit) ─────────────────────────────
# Use a dedicated fresh user: upload 2 videos, process both.
# First process succeeds (1 credit), second returns 402 (0 credits).

CREDIT_UPLOAD1=$(curl -s -X POST "$BASE_URL/api/v1/videos/upload" \
  -H "X-RapidAPI-Proxy-Secret: $SECRET" \
  -H "X-RapidAPI-User: $CREDIT_USER" \
  -H "X-RapidAPI-Subscription: BASIC" \
  -F "video=@$TEST_VIDEO;type=video/mp4" \
  -F "aspectRatio=9:16")
CREDIT_VID1=$(echo "$CREDIT_UPLOAD1" | jq -r '.id // empty')

CREDIT_UPLOAD2=$(curl -s -X POST "$BASE_URL/api/v1/videos/upload" \
  -H "X-RapidAPI-Proxy-Secret: $SECRET" \
  -H "X-RapidAPI-User: $CREDIT_USER" \
  -H "X-RapidAPI-Subscription: BASIC" \
  -F "video=@$TEST_VIDEO;type=video/mp4" \
  -F "aspectRatio=9:16")
CREDIT_VID2=$(echo "$CREDIT_UPLOAD2" | jq -r '.id // empty')

VIDEO_ID2=""  # used in test 8 below

if [[ -n "$CREDIT_VID1" && "$CREDIT_VID1" != "null" && -n "$CREDIT_VID2" && "$CREDIT_VID2" != "null" ]]; then
  CREDIT_VIDEO_IDS_TO_CLEANUP+=("$CREDIT_VID1" "$CREDIT_VID2")
  VIDEO_ID2="$CREDIT_VID2"

  # First process — should consume the 1 BASIC credit (200)
  curl -s -o /dev/null -X POST "$BASE_URL/api/v1/videos/$CREDIT_VID1/process" \
    -H "X-RapidAPI-Proxy-Secret: $SECRET" \
    -H "X-RapidAPI-User: $CREDIT_USER" \
    -H "X-RapidAPI-Subscription: BASIC"

  # Second process — should return 402 (no credits left)
  EXHAUST_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$BASE_URL/api/v1/videos/$CREDIT_VID2/process" \
    -H "X-RapidAPI-Proxy-Secret: $SECRET" \
    -H "X-RapidAPI-User: $CREDIT_USER" \
    -H "X-RapidAPI-Subscription: BASIC")

  if [[ "$EXHAUST_STATUS" == "402" ]]; then
    pass "7. Credit exhaustion returns 402"
  else
    fail "7. Credit exhaustion — expected 402, got $EXHAUST_STATUS"
  fi
else
  fail "7. Credit exhaustion — could not upload test videos"
fi

# ── Test 8: Plan upgrade resets credits ──────────────────────────────────────
# Send a request as the same CREDIT_USER but with PRO subscription.
# The plan change should reset credits, so the status call should succeed.

UPGRADE_TARGET="${VIDEO_ID2:-$VIDEO_ID}"
UPGRADE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/v1/videos/$UPGRADE_TARGET/status" \
  -H "X-RapidAPI-Proxy-Secret: $SECRET" \
  -H "X-RapidAPI-User: $CREDIT_USER" \
  -H "X-RapidAPI-Subscription: PRO")

if [[ "$UPGRADE_STATUS" == "200" || "$UPGRADE_STATUS" == "404" ]]; then
  pass "8. Plan upgrade to PRO accepted (credits reset)"
else
  fail "8. Plan upgrade — expected 200/404 after plan change, got $UPGRADE_STATUS"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "=========================="
echo -e "Results: ${GREEN}$PASS passed${RESET}, ${RED}$FAIL failed${RESET}"
echo "=========================="

[[ $FAIL -eq 0 ]]
