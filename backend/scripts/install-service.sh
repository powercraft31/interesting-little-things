#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_FILE="$BACKEND_DIR/deploy/solfacil-bff.service"
SERVICE_NAME="solfacil-bff"

echo "=== Solfacil BFF — systemd Install ==="
echo "Service file: $SERVICE_FILE"

# 1. 複製 .service 到 systemd 目錄
cp "$SERVICE_FILE" /etc/systemd/system/${SERVICE_NAME}.service
echo "✓ Copied to /etc/systemd/system/${SERVICE_NAME}.service"

# 2. Reload daemon
systemctl daemon-reload
echo "✓ systemctl daemon-reload"

# 3. Enable (開機自啟)
systemctl enable ${SERVICE_NAME}
echo "✓ systemctl enable ${SERVICE_NAME}"

# 4. 若已在跑，先停
systemctl is-active ${SERVICE_NAME} > /dev/null 2>&1 && systemctl stop ${SERVICE_NAME} && echo "✓ Stopped old instance"

# 5. 啟動
systemctl start ${SERVICE_NAME}
echo "✓ systemctl start ${SERVICE_NAME}"

# 6. 等 3 秒確認狀態
sleep 3
systemctl status ${SERVICE_NAME} --no-pager
