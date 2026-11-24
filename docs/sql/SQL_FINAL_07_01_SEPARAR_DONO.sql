BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE mr_saloum_private.owner_separation_v1 (
  singleton boolean PRIMARY KEY CHECK (singleton),
  previous_name text,
  previous_link uuid,
  previous_active boolean NOT NULL,
  definitions_before text[] NOT NULL,
  definitions_after text[] NOT NULL
);
REVOKE ALL ON mr_saloum_private.owner_separation_v1 FROM PUBLIC, anon, authenticated, service_role;

DO $migration$
DECLARE
  owner_id constant uuid := 'd1a3b46e-50d3-4347-bde8-ef1e5e84da54';
  matheus_id constant uuid := '1ce68aac-44da-41bc-b9e5-d62cc0406a7c';
  signatures constant regprocedure[] := ARRAY[
    'public.guard_barber_lifecycle()'::regprocedure,
    'public.mr_saloum_alterar_catalogo_v1(text,text,uuid,text,jsonb)'::regprocedure,
    'public.mr_saloum_listar_catalogo_v1()'::regprocedure
  ];
  old_profile public.profiles%ROWTYPE;
  old_active boolean;
  old_barber jsonb;
  new_barber jsonb;
  before_ddl text[];
  after_ddl text[];
  ddl text;
  blockers bigint;
BEGIN
  SELECT p.* INTO STRICT old_profile FROM public.profiles p WHERE p.id = owner_id FOR UPDATE;
  IF old_profile.role IS DISTINCT FROM 'admin'
     OR (old_profile.barber_id IS NOT NULL AND old_profile.barber_id <> matheus_id)
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = owner_id AND u.deleted_at IS NULL)
  THEN RAISE EXCEPTION 'Conta principal ou vínculo divergente. Revise os UUIDs antes de migrar.'; END IF;

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  IF public.is_master_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'O perfil identificado não é o administrador principal efetivo.';
  END IF;

  SELECT b.active, to_jsonb(b) INTO STRICT old_active, old_barber
  FROM public.barbers b WHERE b.id = matheus_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.barber_id = matheus_id AND p.id <> owner_id) THEN
    RAISE EXCEPTION 'Outro perfil está vinculado ao cadastro de Matheus. Revise o vínculo.';
  END IF;
  IF (SELECT array_agg(lower(split_part(btrim(b.name), ' ', 1)) ORDER BY lower(split_part(btrim(b.name), ' ', 1)) COLLATE "C")
      FROM public.barbers b WHERE b.id <> matheus_id AND b.active)
      IS DISTINCT FROM ARRAY['isaac','joão']::text[] THEN
    RAISE EXCEPTION 'Os outros barbeiros ativos não correspondem a Isaac e João. Revise a vitrine antes de migrar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.barbers'::regclass
    AND tgfoid = signatures[1] AND tgname = 'trg_guard_barber_lifecycle' AND tgenabled IN ('O','A'))
    OR mr_saloum_private.can_delete_barber(matheus_id) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Proteções de ciclo de vida divergentes no banco.';
  END IF;

  SELECT count(*) INTO blockers FROM public.appointments a
    WHERE a.barber_id = matheus_id AND a.status = 'confirmed' AND a.ends_at > clock_timestamp();
  IF blockers > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'MS001',
      MESSAGE = format('Matheus tem %s agendamento(s) confirmado(s) futuro(s) ou em andamento. Nada foi alterado.', blockers);
  END IF;
  FOR i IN 1..3 LOOP
    before_ddl[i] := pg_get_functiondef(signatures[i]);
  END LOOP;

  -- As alterações são restritas aos trechos conhecidos do clone restaurado.
  ddl := regexp_replace(before_ddl[1],
    $rx$IF OLD[.]id =[[:space:]]+'1ce68aac-44da-41bc-b9e5-d62cc0406a7c'::uuid[[:space:]]+THEN[[:space:]]+RAISE EXCEPTION[[:space:]]+'O barbeiro principal não pode ser desativado[.]';[[:space:]]+END IF;$rx$, '');
  IF ddl = before_ddl[1] THEN RAISE EXCEPTION 'Proteção de desativação do gatilho divergiu.'; END IF;
  after_ddl[1] := regexp_replace(regexp_replace(ddl,
    $rx$RAISE EXCEPTION[[:space:]]+'O cadastro do barbeiro principal está protegido[.]';$rx$,
    $new$RAISE EXCEPTION USING ERRCODE = 'MS002', MESSAGE = 'A exclusão definitiva do cadastro operacional de Matheus é protegida.';$new$),
    $rx$RAISE EXCEPTION[[:space:]]+'Existem agendamentos futuros ou em andamento[.]';$rx$,
    $new$RAISE EXCEPTION USING ERRCODE = 'MS001', MESSAGE = 'Não foi possível desativar: existem agendamentos futuros ou em andamento.';$new$);
  IF position('ERRCODE = ''MS002''' IN after_ddl[1]) = 0 OR position('ERRCODE = ''MS001''' IN after_ddl[1]) = 0 THEN
    RAISE EXCEPTION 'Mensagens do gatilho divergiram.';
  END IF;

  after_ddl[2] := regexp_replace(before_ddl[2],
    $rx$IF v_id =[[:space:]]+'1ce68aac-44da-41bc-b9e5-d62cc0406a7c'::uuid[[:space:]]+THEN[[:space:]]+RAISE EXCEPTION[[:space:]]+'Barbeiro principal protegido[.]'[[:space:]]+USING ERRCODE = 'MS002';[[:space:]]+END IF;$rx$, '');
  IF after_ddl[2] = before_ddl[2] THEN RAISE EXCEPTION 'Proteção de desativação da RPC divergiu.'; END IF;

  after_ddl[3] := regexp_replace(before_ddl[3],
    $rx$'can_delete',[[:space:]]+mr_saloum_private[.]can_delete_barber[(]b[.]id[)]$rx$,
    $new$'can_deactivate', b.active AND NOT EXISTS (
                    SELECT 1 FROM public.appointments a
                    WHERE a.barber_id = b.id AND a.status = 'confirmed' AND a.ends_at > now()
                ),
                'can_delete', mr_saloum_private.can_delete_barber(b.id)$new$);
  IF after_ddl[3] = before_ddl[3] THEN RAISE EXCEPTION 'Listagem do catálogo divergiu.'; END IF;

  FOREACH ddl IN ARRAY after_ddl LOOP EXECUTE ddl; END LOOP;
  -- Capturar a representação canônica do PostgreSQL para detecção de alterações posteriores.
  FOR i IN 1..3 LOOP after_ddl[i] := pg_get_functiondef(signatures[i]); END LOOP;
  INSERT INTO mr_saloum_private.owner_separation_v1 VALUES
    (true, old_profile.name, old_profile.barber_id, old_active, before_ddl, after_ddl);

  UPDATE public.profiles SET name = 'DONO', barber_id = NULL WHERE id = owner_id;
  IF old_active THEN
    UPDATE public.barbers b SET active = false WHERE b.id = matheus_id RETURNING to_jsonb(b) INTO new_barber;
    INSERT INTO mr_saloum_private.catalog_audit
      (actor_id, entity_kind, entity_id, action, previous_data, new_data)
    VALUES (owner_id, 'barber', matheus_id, 'deactivate', old_barber, new_barber);
  END IF;
  IF public.is_master_admin() IS DISTINCT FROM true
    OR mr_saloum_private.can_delete_barber(matheus_id) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A autorização principal ou proteção do cadastro não foi preservada.';
  END IF;
END
$migration$;
COMMIT;
