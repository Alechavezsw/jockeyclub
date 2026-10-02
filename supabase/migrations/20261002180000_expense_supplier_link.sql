-- Gastos ligados al padrón de proveedores (LILA / Accessin).

alter table public.expenses
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

create index if not exists expenses_supplier_idx
  on public.expenses (supplier_id);
