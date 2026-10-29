CREATE OR REPLACE TRIGGER panas_registry_key_retirement AFTER UPDATE OF public_key_pem, enabled ON panas_provider_keys FOR EACH ROW EXECUTE FUNCTION panas_retire_registry_key();
