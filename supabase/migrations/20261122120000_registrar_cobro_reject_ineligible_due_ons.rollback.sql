-- Rollback manual de 20261122120000 (solo con autorización).
-- Restaura registrar_cobro desde schema_object_backups y elimina helpers.

select public.rollback_20261122120000_registrar_cobro_due_ons();
