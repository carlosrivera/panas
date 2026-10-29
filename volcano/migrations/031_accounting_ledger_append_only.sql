CREATE OR REPLACE TRIGGER panas_accounting_ledger_append_only BEFORE UPDATE OR DELETE ON panas_accounting_ledger FOR EACH ROW EXECUTE FUNCTION panas_accounting_append_only();
