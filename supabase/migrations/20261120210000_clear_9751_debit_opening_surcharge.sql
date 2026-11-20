-- Socio 9751: el débito 03656347 cubrió capital de octubre ($70.000).
-- El 10 % embebido en la apertura ($7.000) no corresponde: débito no genera mora.

insert into public.member_dues_entries (member_id, amount, kind, source)
select m.id, -7000, 'ajuste',
  'ajuste:9751:debito-oct2026-sin-mora-apertura:1006fefd-fcf7-44c6-8ee3-8db0d2f3418a'
from public.members m
where m.member_number = '9751'
on conflict (source) where source <> '' do nothing;

update public.members m
set meta = coalesce(m.meta, '{}'::jsonb) || jsonb_build_object(
  'unpaidCapital', 0,
  'unpaidCapitalReconciledAt', '2026-11-20',
  'unpaidCapitalReconciledNote',
    'Débito 03656347 cubrió capital octubre $70000. El 10% embebido en la apertura ($7000) no corresponde: débito no cobra mora. Saldo a 0.',
  'debitClearedOpeningSurcharge', 7000
),
outstanding_balance = (
  select round(coalesce(sum(e.amount), 0), 2)
  from public.member_dues_entries e
  where e.member_id = m.id
),
updated_at = now()
where m.member_number = '9751';
