CREATE OR REPLACE FUNCTION public.apply_mp_subscription(p_intent_id uuid, p_preapproval_id text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_intent public.mp_intents%rowtype;
  v_status text;
  v_adhesion text;
begin
  v_status := lower(coalesce(nullif(btrim(p_status), ''), 'authorized'));
  select * into v_intent from public.mp_intents where id = p_intent_id for update;
  if v_intent.id is null then raise exception 'No está la suscripción de Mercado Pago.'; end if;
  v_adhesion := case
    when v_status in ('authorized', 'approved') then 'authorized'
    when v_status in ('cancelled', 'paused') then 'cancelled'
    else 'rejected' end;
  update public.mp_intents set
    status = case when v_adhesion = 'authorized' then 'authorized' else v_status end,
    preapproval_id = coalesce(nullif(p_preapproval_id, ''), preapproval_id),
    applied_at = case when v_adhesion = 'authorized' then coalesce(applied_at, now()) else applied_at end,
    updated_at = now()
  where id = v_intent.id;
  if v_intent.member_id is not null then
    update public.members set
      payment_method = case when v_adhesion = 'authorized' then 'debito' else payment_method end,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'mpAdhesion', v_adhesion,
        'mpPreapprovalId', coalesce(nullif(p_preapproval_id, ''), meta->>'mpPreapprovalId')
      )
    where id = v_intent.member_id;
  end if;
  return jsonb_build_object('ok', true, 'adhesion', v_adhesion, 'intent_id', v_intent.id);
end;
$function$
