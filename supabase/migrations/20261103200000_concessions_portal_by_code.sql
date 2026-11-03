-- La lectura pública de concesiones era provisoria y mostraba el padrón comercial.
-- Sin login solo responde concession_portal_by_code, con el código del local.

drop policy if exists concessions_portal_select on public.concessions;
