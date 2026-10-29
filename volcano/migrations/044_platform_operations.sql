CREATE TABLE IF NOT EXISTS panas_platform_operations (job text PRIMARY KEY, observed_at timestamptz NOT NULL, summary jsonb NOT NULL);
