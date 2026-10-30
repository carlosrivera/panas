CREATE OR REPLACE FUNCTION panas_accounting_currency_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.currency<>OLD.currency THEN RAISE EXCEPTION 'Buyer settlement currency is immutable'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS panas_buyer_currency_immutable ON panas_accounting_buyers;
CREATE TRIGGER panas_buyer_currency_immutable BEFORE UPDATE ON panas_accounting_buyers FOR EACH ROW EXECUTE FUNCTION panas_accounting_currency_immutable();
