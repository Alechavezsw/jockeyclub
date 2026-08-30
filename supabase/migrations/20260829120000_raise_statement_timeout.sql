-- Evita "canceling statement due to statement timeout" al hidratar el padrón (~5k socios).
alter role authenticator set statement_timeout = '120s';
alter role authenticated set statement_timeout = '120s';
notify pgrst, 'reload config';
