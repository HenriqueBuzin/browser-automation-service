#!/bin/zsh
set -euo pipefail

readonly APP_ROOT="/opt/browser-automation-service"
readonly ENV_FILE="${APP_ROOT}/env/appium-ios.env"

if [[ ! -r "${ENV_FILE}" ]]; then
  print -u2 "Missing readable environment file: ${ENV_FILE}"
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

if [[ "${ADAPTER_PLATFORM:-}" != "ios" || "${WORKER_ADAPTER:-}" != "appium" ]]; then
  print -u2 "The macOS worker requires ADAPTER_PLATFORM=ios and WORKER_ADAPTER=appium"
  exit 1
fi

exec /usr/bin/env node "${APP_ROOT}/dist/main.js"
