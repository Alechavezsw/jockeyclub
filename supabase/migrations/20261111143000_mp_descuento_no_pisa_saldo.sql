-- El descuento de Mercado Pago no deja el saldo en negativo.
-- Solo cubre el capital que sigue abierto después del pago. El 10 % no está en el saldo.

do $patch$
declare
  def text;
  old text;
  new text;
begin
  select pg_get_functiondef('public.apply_mp_approved_payment(uuid,text,text,numeric)'::regprocedure)
    into def;

  if strpos(def, 'member_dues_balance(v_member.id)') > 0 then
    return;
  end if;

  old := $old$
    if v_discount > 0 then
      insert into public.member_dues_entries (member_id, amount, kind, source)
      values (v_member.id, round(-v_discount, 2), 'payment', 'discount:' || v_payment::text)
      on conflict (source) where source <> '' do nothing;
    end if;

    v_remaining := greatest(0, round(coalesce(v_member.outstanding_balance, 0) - v_cover, 2));
$old$;
  if strpos(def, old) = 0 then
    raise exception 'No está el descuento de Mercado Pago sobre el saldo';
  end if;

  new := $new$
    if v_discount > 0 then
      declare
        v_open numeric(14, 2);
        v_extra numeric(14, 2);
      begin
        v_open := greatest(0, round(coalesce(public.member_dues_balance(v_member.id), 0), 2));
        v_extra := least(v_open, v_discount);
        if v_extra > 0.009 then
          insert into public.member_dues_entries (member_id, amount, kind, source)
          values (v_member.id, round(-v_extra, 2), 'payment', 'discount:' || v_payment::text)
          on conflict (source) where source <> '' do nothing;
        end if;
      end;
    end if;

    v_remaining := greatest(0, round(coalesce(public.member_dues_balance(v_member.id), 0), 2));
$new$;
  def := replace(def, old, new);
  execute def;
end;
$patch$;
