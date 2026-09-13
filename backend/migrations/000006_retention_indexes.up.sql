CREATE INDEX operations_terminal_updated_idx
    ON operations (updated_at)
    WHERE state IN ('succeeded', 'failed', 'partial', 'unknown_outcome');
