-- ============================================================
-- Migration v5.6: System Heartbeat — Internal Pipeline Automation
-- 執行：sudo -u postgres psql -d solfacil_vpp -f backend/scripts/migration_v5.6.sql
-- ============================================================

BEGIN;

-- 1. trade_schedules 新增 status 欄位（核心：讓狀態機能運作）
ALTER TABLE trade_schedules
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','executing','executed','failed'));

CREATE INDEX IF NOT EXISTS idx_trade_schedules_status
  ON trade_schedules(status, planned_time);

-- 2. 新增 dispatch_commands 表（M3 Dispatcher 寫入邊界）
CREATE TABLE IF NOT EXISTS dispatch_commands (
  id            BIGSERIAL PRIMARY KEY,
  trade_id      INTEGER NOT NULL REFERENCES trade_schedules(id),
  asset_id      VARCHAR(50) NOT NULL,
  org_id        VARCHAR(50) NOT NULL,
  action        VARCHAR(10) NOT NULL,
  volume_kwh    NUMERIC(8,2) NOT NULL,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        VARCHAR(20) NOT NULL DEFAULT 'dispatched',
  m1_boundary   BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_commands_trade    ON dispatch_commands(trade_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_commands_asset    ON dispatch_commands(asset_id, dispatched_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_commands_org      ON dispatch_commands(org_id);

COMMIT;
