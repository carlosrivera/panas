CREATE OR REPLACE FUNCTION panas_accounting_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Accounting audit rows are append-only'; END $$;
