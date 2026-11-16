-- Una sola firma (con defaults) para que PostgREST no dude entre sobrecargas.
drop function if exists public.record_pool_canon(numeric, text, uuid, date);
drop function if exists public.record_pool_canon_impl(numeric, text, uuid, date);

revoke all on function public.record_pool_canon(numeric, text, uuid, date, text, text) from public, anon;
grant execute on function public.record_pool_canon(numeric, text, uuid, date, text, text) to authenticated;
revoke all on function public.record_pool_canon_impl(numeric, text, uuid, date, text, text) from public, anon, authenticated;
