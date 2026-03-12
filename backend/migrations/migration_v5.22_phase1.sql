-- v5.22 Phase 1: Two-phase set_reply support
-- Index for accepted set commands (timeout check + reply matching)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dcl_accepted_set
ON device_command_logs (created_at ASC)
WHERE result = 'accepted' AND command_type = 'set';
