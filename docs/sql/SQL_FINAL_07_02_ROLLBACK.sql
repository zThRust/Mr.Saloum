BEGIN;
SET LOCAL lock_timeout = '5s';

DO $undo$
DECLARE
  owner_id constant uuid := 'd1a3b46e-50d3-4347-bde8-ef1e5e84da54';
  matheus_id constant uuid := '1ce68aac-44da-41bc-b9e5-d62cc0406a7c';
  signatures constant regprocedure[] := ARRAY[
    'public.guard_barber_lifecycle()'::regprocedure,
    'public.mr_saloum_alterar_catalogo_v1(text,text,uuid,text,jsonb)'::regprocedure,
    'public.mr_saloum_listar_catalogo_v1()'::regprocedure
  ];
  saved mr_saloum_private.owner_separation_v1%ROWTYPE;
  curr_profile public.profiles%ROWTYPE;
  curr_active boolean;
  old_barber jsonb;
  new_barber jsonb;
  ddl text;
BEGIN
  SELECT * INTO STRICT saved FROM mr_saloum_private.owner_separation_v1 WHERE singleton FOR UPDATE;
  SELECT p.* INTO STRICT curr_profile FROM public.profiles p WHERE p.id = owner_id FOR UPDATE;
  SELECT b.active, to_jsonb(b) INTO STRICT curr_active, old_barber
    FROM public.barbers b WHERE b.id = matheus_id FOR UPDATE;
  IF curr_profile.role IS DISTINCT FROM 'admin' OR curr_profile.name IS DISTINCT FROM 'DONO'
     OR curr_profile.barber_id IS NOT NULL OR curr_active IS DISTINCT FROM false
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.barber_id = matheus_id)
  THEN RAISE EXCEPTION 'Perfil ou estado operacional foi alterado após a migração. Revise antes de reverter.'; END IF;
  FOR i IN 1..3 LOOP
    IF pg_get_functiondef(signatures[i]) IS DISTINCT FROM saved.definitions_after[i] THEN
      RAISE EXCEPTION 'A definição de % mudou após a migração. Revise antes de reverter.', signatures[i];
    END IF;
  END LOOP;
  FOREACH ddl IN ARRAY saved.definitions_before LOOP EXECUTE ddl; END LOOP;
  UPDATE public.profiles SET name = saved.previous_name, barber_id = saved.previous_link WHERE id = owner_id;
  IF saved.previous_active THEN
    UPDATE public.barbers b SET active = true WHERE b.id = matheus_id RETURNING to_jsonb(b) INTO new_barber;
    INSERT INTO mr_saloum_private.catalog_audit
      (actor_id, entity_kind, entity_id, action, previous_data, new_data)
    VALUES (owner_id, 'barber', matheus_id, 'reactivate', old_barber, new_barber);
  END IF;
END
$undo$;
DROP TABLE mr_saloum_private.owner_separation_v1;
COMMIT;
