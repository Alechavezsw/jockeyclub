-- El detalle congelado al liquidar: titulares y valor de cada concepto.
alter table public.fee_period_closures
  add column if not exists lines jsonb not null default '[]'::jsonb;

-- El cierre de octubre se había guardado con el total fijo de Lila.
-- Vuelve a borrador para que el detalle sume el padrón actual.
delete from public.fee_period_closures where id = 'fp-1382';
