-- v5.22 Phase 2: Backfill request queue
CREATE TABLE IF NOT EXISTS backfill_requests (
  id                  BIGSERIAL PRIMARY KEY,
  gateway_id          VARCHAR NOT NULL REFERENCES gateways(gateway_id),
  gap_start           TIMESTAMPTZ NOT NULL,
  gap_end             TIMESTAMPTZ NOT NULL,
  current_chunk_start TIMESTAMPTZ,
  last_chunk_sent_at  TIMESTAMPTZ,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  CONSTRAINT chk_backfill_status
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed'))
);

CREATE INDEX idx_backfill_active
ON backfill_requests (created_at ASC)
WHERE status IN ('pending', 'in_progress');

-- Grant permissions (same pattern as device_command_logs)
GRANT SELECT, INSERT, UPDATE ON backfill_requests TO solfacil_service;
GRANT USAGE ON SEQUENCE backfill_requests_id_seq TO solfacil_service;
