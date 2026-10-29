CREATE TABLE IF NOT EXISTS panas_provider_keys (provider_id uuid PRIMARY KEY, public_key_pem text NOT NULL, enabled boolean NOT NULL DEFAULT true, enrolled_at timestamptz NOT NULL DEFAULT now());
