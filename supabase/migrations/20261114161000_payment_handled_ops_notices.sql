-- Pagos entrantes: no se cierran solo por is_read (abrir MD).
-- Cierra de oficio los avisos viejos ya leídos; los recientes quedan abiertos hasta imputar.

update public.messages
set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
  'paymentHandled', true,
  'paymentHandledAt', to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
)
where recipient_key = 'ops'
  and meta->>'kind' in ('dues_payment', 'booking_payment')
  and is_read is true
  and created_at < (timezone('utc', now()) - interval '7 days')
  and coalesce(meta->>'paymentHandled', '') <> 'true';
