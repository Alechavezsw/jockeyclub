-- Rollback manual de 20261122153000_registrar_cobro_reject_ineligible_due_ons (solo con autorización).
-- Restaura registrar_cobro desde schema_object_backups y elimina helpers.
-- Este archivo NO vive en supabase/migrations: el CLI lo tomaría como migración pendiente.

select public.rollback_20261122153000_registrar_cobro_due_ons();
