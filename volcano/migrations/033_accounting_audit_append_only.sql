CREATE OR REPLACE TRIGGER panas_accounting_audit_append_only BEFORE UPDATE OR DELETE ON panas_accounting_operator_audit FOR EACH ROW EXECUTE FUNCTION panas_accounting_append_only();
