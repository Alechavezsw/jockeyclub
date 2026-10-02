-- Balances vigentes de Lila (cuentas contables de cuotas), leídos el 2 de octubre de 2026.

update public.fee_ledger_accounts
set balance = case id
  when 'fca-31' then 463388625.47
  when 'fca-33' then 54715510.00
  else balance
end
where id in ('fca-31', 'fca-33');
