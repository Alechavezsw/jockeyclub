# Rollbacks manuales

Los scripts `*.rollback.sql` **no** deben vivir en `supabase/migrations/`.
Supabase CLI trata cada `.sql` de ese directorio como migración pendiente.

## PR #13 — `20261122153000_registrar_cobro_reject_ineligible_due_ons`

| Archivo | Uso |
| --- | --- |
| `../migrations/20261122153000_registrar_cobro_reject_ineligible_due_ons.sql` | Forward (backup + helpers + assert + inyección) |
| `20261122153000_registrar_cobro_reject_ineligible_due_ons.rollback.sql` | Llama `public.rollback_20261122153000_registrar_cobro_due_ons()` |

Solo ejecutar el rollback con autorización explícita, después de verificar que el backup en `schema_object_backups` existe para `migration_id = '20261122153000_registrar_cobro_reject_ineligible_due_ons'`.
