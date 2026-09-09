-- Alta idempotente de usuarios reales de Accessin en auth.users + profiles.
-- Contraseña temporal de portal: jockey2026 (la misma de las cuentas demo).

DO $$
DECLARE
  rec record;
  uid uuid;
  login_email text;
  full_nm text;
  existing_id uuid;
  now_ts timestamptz := clock_timestamp();
  pwd text;
BEGIN
  pwd := extensions.crypt('jockey2026', extensions.gen_salt('bf'));

  FOR rec IN
    SELECT *
    FROM (
      VALUES
        (123467, 'Bonilla', 'Cristian Sergio', '31098538', 'cristiansergiobonilla@gmail.com', 'cristian.bonilla.8538', 'admin'::text, true, true, false, '2031-12-31'::date, '10146'),
        (123111, 'Cuello Scida', 'Paula Andrea', '25939818', 'paulacuelloscida@hotmail.com', 'paula.cuello.9818', 'admin', true, false, false, NULL, '09910'),
        (122455, 'Laciar', 'Carlos Marcelo', '18206639', 'hotlacio@hotmail.com', 'carlos.laciar.6639', 'admin', true, false, false, NULL, '08377'),
        (126052, 'Veron', 'Teresa Beatriz', '18461328', 'bety_veron@hotmail.com', 'teresa.veron.1328', 'admin', true, false, true, NULL, NULL),
        (126051, 'Ortega Carta', 'Maria Jose', '33542598', 'joseortegacarta2427@gmail.com', 'maria.ortega.2598', 'admin', true, false, true, NULL, NULL),
        (151672, 'Esquivel Perrone', 'Agustina Belen', '43689124', 'esquivelagustina215@gmail.com', 'agustina.esquivel.9124', 'admin', true, false, true, NULL, NULL),
        (154347, 'Jacamo', 'Karina Patricia', '23362953', 'jacamokarina5@gmail.com', 'karina.jacamo.2953', 'admin', true, false, true, NULL, '12921'),
        (154412, 'Lujan', 'Claudia Beatriz', '20801648', 'clalu52@gmail.com', 'claudia.lujan.1648', 'admin', true, false, true, NULL, NULL),
        (264639, 'Lucero', 'Jordan Elisa Magali', '36252952', 'luceroelisamagali@gmail.com', 'jordan.lucero.2952', 'admin', true, false, true, NULL, NULL),
        (267281, 'Meneses', 'Ivana Yanina', '31005150', 'ivanayaninameneses@gmail.com', 'ivana.meneses.5150', 'admin', true, false, true, NULL, NULL),
        (127050, 'Diaz', 'Julio Cesar', '25395107', NULL, 'julio.diaz.5107', 'gate_operator', false, true, false, '2029-12-31', NULL),
        (127051, 'Mercado', 'Ruben Dario', '20477443', NULL, 'ruben.mercado.7443', 'gate_operator', false, true, false, '2029-12-31', NULL),
        (127052, 'Suarez', 'Adrian Pablo', '22663182', NULL, 'adrian.suarez.3182', 'gate_operator', false, true, false, '2029-12-31', NULL),
        (122433, 'Galdeano Bernales', 'Jorge Luis', '24879291', '24879291@jockeyclubsj.com', 'jorge.galdeano.9291', 'gate_operator', false, true, false, '2029-12-31', '08216'),
        (156776, 'Seguridad', 'Portena', '1111111111', '111111@jockeyclubsj.com', 'seguridad.portena.1111', 'gate_operator', false, true, false, '2029-12-24', NULL)
    ) AS t(
      accessin_id, last_name, first_name, dni, contact_email, username,
      primary_role, has_a, has_o, has_ea, o_expires, st_number
    )
  LOOP
    login_email := rec.username || '@jockey.sj';
    full_nm := trim(rec.first_name || ' ' || rec.last_name);

    SELECT p.id
    INTO existing_id
    FROM public.profiles p
    WHERE p.document_number = rec.dni
       OR p.email = login_email
       OR p.prisma_id = rec.accessin_id::text
    LIMIT 1;

    IF existing_id IS NULL THEN
      SELECT id INTO existing_id FROM auth.users WHERE email = login_email LIMIT 1;
    END IF;

    IF existing_id IS NULL THEN
      uid := gen_random_uuid();

      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        uid,
        'authenticated',
        'authenticated',
        login_email,
        pwd,
        now_ts,
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        jsonb_build_object(
          'full_name', full_nm,
          'first_name', rec.first_name,
          'last_name', rec.last_name,
          'role', rec.primary_role,
          'username', rec.username,
          'document_type', 'Arg-DNI',
          'document_number', rec.dni,
          'prisma_id', rec.accessin_id::text,
          'profile_meta', jsonb_strip_nulls(jsonb_build_object(
            'username', rec.username,
            'contactEmail', rec.contact_email
          ))
        ),
        now_ts,
        now_ts,
        '',
        '',
        '',
        ''
      );

      INSERT INTO auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) VALUES (
        uid::text,
        uid,
        jsonb_build_object('sub', uid::text, 'email', login_email),
        'email',
        now_ts,
        now_ts,
        now_ts
      );
    ELSE
      uid := existing_id;
    END IF;

    UPDATE public.profiles
    SET
      email = login_email,
      full_name = full_nm,
      first_name = rec.first_name,
      last_name = rec.last_name,
      role = rec.primary_role::public.app_role,
      document_type = 'Arg-DNI',
      document_number = rec.dni,
      prisma_id = rec.accessin_id::text,
      is_active = true,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'username', rec.username,
        'contactEmail', rec.contact_email
      )),
      updated_at = now_ts
    WHERE id = uid;

    -- Rol primario con el # de Accessin
    IF EXISTS (
      SELECT 1 FROM public.profile_roles
      WHERE profile_id = uid AND lower(role_key) = rec.primary_role AND revoked_at IS NULL
    ) THEN
      UPDATE public.profile_roles
      SET public_id = rec.accessin_id
      WHERE profile_id = uid
        AND lower(role_key) = rec.primary_role
        AND revoked_at IS NULL
        AND public_id IS DISTINCT FROM rec.accessin_id;
    ELSE
      INSERT INTO public.profile_roles (profile_id, role_key, label, kind, public_id)
      VALUES (
        uid,
        rec.primary_role,
        CASE rec.primary_role
          WHEN 'admin' THEN 'Administrador'
          WHEN 'admin_employee' THEN 'Empleado de administración'
          WHEN 'gate_operator' THEN 'Operador de portería'
          ELSE rec.primary_role
        END,
        'system',
        rec.accessin_id
      );
    END IF;

    IF rec.has_ea AND rec.primary_role IS DISTINCT FROM 'admin_employee' THEN
      INSERT INTO public.profile_roles (profile_id, role_key, label, kind)
      SELECT uid, 'admin_employee', 'Empleado de administración', 'system'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profile_roles
        WHERE profile_id = uid AND lower(role_key) = 'admin_employee' AND revoked_at IS NULL
      );
    END IF;

    IF rec.has_o AND rec.primary_role IS DISTINCT FROM 'gate_operator' THEN
      INSERT INTO public.profile_roles (profile_id, role_key, label, kind)
      SELECT uid, 'gate_operator', 'Operador de portería', 'system'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profile_roles
        WHERE profile_id = uid AND lower(role_key) = 'gate_operator' AND revoked_at IS NULL
      );
    END IF;

    IF rec.st_number IS NOT NULL THEN
      INSERT INTO public.profile_roles (profile_id, role_key, label, kind)
      SELECT uid, 'socio_titular', 'Socio titular', 'title'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profile_roles
        WHERE profile_id = uid AND lower(role_key) = 'socio_titular' AND revoked_at IS NULL
      );

      INSERT INTO public.profile_roles (profile_id, role_key, label, kind)
      SELECT uid, 'member', 'Socio', 'system'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profile_roles
        WHERE profile_id = uid AND lower(role_key) = 'member' AND revoked_at IS NULL
      );
    END IF;

    IF rec.has_a THEN
      INSERT INTO public.profile_authorizations (profile_id, kind, title, role_label)
      SELECT uid, 'admin', 'Administrador', 'Administrador'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profile_authorizations
        WHERE profile_id = uid AND kind = 'admin'
      );
    END IF;

    IF rec.has_ea THEN
      INSERT INTO public.profile_authorizations (profile_id, kind, title, role_label)
      SELECT uid, 'admin_employee', 'Empleado de administración', 'Empleado de administración'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profile_authorizations
        WHERE profile_id = uid AND kind = 'admin_employee'
      );
    END IF;

    IF rec.has_o THEN
      INSERT INTO public.profile_authorizations (profile_id, kind, title, role_label, expires_at)
      SELECT uid, 'gate_operator', 'Operador de portería', 'Operador de portería', rec.o_expires
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profile_authorizations
        WHERE profile_id = uid AND kind = 'gate_operator'
      );
    END IF;

    IF rec.st_number IS NOT NULL THEN
      INSERT INTO public.profile_identifiers (profile_id, id_type, identifier)
      SELECT uid, 'socio_titular', rec.st_number
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profile_identifiers
        WHERE profile_id = uid AND id_type = 'socio_titular' AND identifier = rec.st_number
      );
    END IF;
  END LOOP;
END $$;
