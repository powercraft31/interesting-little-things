-- v5.21: Index for CommandPublisher polling (dispatched + set commands)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dcl_dispatched_set
ON device_command_logs (created_at ASC)
WHERE result = 'dispatched' AND command_type = 'set';
