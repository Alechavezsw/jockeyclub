alter table public.fee_period_closures
  add column if not exists pack jsonb;

comment on column public.fee_period_closures.pack is
  'Desglose editado de un período abierto: categorías, gastos, recargos, vencimiento y alertas.';
