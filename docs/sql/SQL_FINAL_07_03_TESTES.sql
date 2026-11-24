-- Apenas Supabase local isolado. Gera um atendimento fictício e reverte tudo.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $test$
DECLARE
  owner_id constant uuid := 'd1a3b46e-50d3-4347-bde8-ef1e5e84da54';
  matheus_id constant uuid := '1ce68aac-44da-41bc-b9e5-d62cc0406a7c';
  appointment_id uuid;
  future_id uuid;
  isolated_profiles integer := 0;
  barber_profile record;
  item jsonb;
  starts timestamptz := now() - interval '40 days';
  finance_day date := (starts AT TIME ZONE 'America/Fortaleza')::date;
  previous_total numeric;
  version text;
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN
    ('trg_whatsapp_booking','trg_whatsapp_cancellation','trg_whatsapp_wake_dispatcher') AND tgenabled='D') <> 3
  THEN RAISE EXCEPTION 'Execute os testes somente em um clone isolado com WhatsApp desabilitado.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=owner_id AND name='DONO' AND role='admin' AND barber_id IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.barbers WHERE id=matheus_id AND NOT active)
  THEN RAISE EXCEPTION 'Separação do DONO não aplicada.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  IF NOT public.is_master_admin()
    OR NOT mr_saloum_private.can_upload_barber_photo(matheus_id::text || '/' || gen_random_uuid() || '.webp')
  THEN RAISE EXCEPTION 'Conta DONO perdeu autorização de administração ou fotos.'; END IF;
  SELECT f.total_dia INTO STRICT previous_total FROM public.painel_financeiro(finance_day) f WHERE f.barber_id=matheus_id;
  INSERT INTO public.appointments (customer_name, customer_whatsapp, barber_id, starts_at, ends_at, completed_at)
    VALUES ('Histórico fictício', '84999999999', matheus_id, starts, starts + interval '35 minutes', starts + interval '35 minutes')
    RETURNING id INTO appointment_id;
  INSERT INTO public.appointment_items (appointment_id, barber_id, service_name, price)
    VALUES (appointment_id, matheus_id, 'Serviço histórico fictício', 41.25);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.painel_agendamentos()) a
    WHERE a->>'id'=appointment_id::text AND a->'items'->0->>'price'='41.25')
    OR NOT EXISTS (SELECT 1 FROM public.painel_financeiro(finance_day) f
      WHERE f.barber_id=matheus_id AND f.total_dia=previous_total+41.25)
  THEN RAISE EXCEPTION 'Agenda ou preço histórico do barbeiro inativo indisponível.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.mr_saloum_listar_perfis_editaveis_v1()) p
    WHERE p->>'id'=matheus_id::text)
  THEN RAISE EXCEPTION 'Administrador não pode editar o perfil operacional.'; END IF;

  BEGIN
    PERFORM public.lock_active_booking_resources(matheus_id, ARRAY[]::uuid[]);
    RAISE EXCEPTION 'Reserva para barbeiro inativo foi aceita.';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Barbeiro não encontrado ou inativo.' THEN RAISE; END IF;
  END;
  UPDATE mr_saloum_private.catalog_config SET enabled=true WHERE singleton;
  SELECT x INTO STRICT item FROM jsonb_array_elements(public.mr_saloum_listar_catalogo_v1()->'barbers') x WHERE x->>'id'=matheus_id::text;
  IF (item->>'can_delete')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Exclusão apareceu no catálogo.'; END IF;
  PERFORM public.mr_saloum_alterar_catalogo_v1('barber','reactivate',matheus_id,item->>'version',NULL);
  SELECT catalog_version::text INTO STRICT version FROM public.barbers WHERE id=matheus_id AND active;
  INSERT INTO public.appointments (customer_name, customer_whatsapp, barber_id, starts_at, ends_at)
    VALUES ('Reserva futura fictícia','84999999999',matheus_id,now()+interval '100 days',now()+interval '100 days 35 minutes')
    RETURNING id INTO future_id;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.mr_saloum_listar_catalogo_v1()->'barbers') x
    WHERE x->>'id'=matheus_id::text AND (x->>'can_deactivate')::boolean IS FALSE)
  THEN RAISE EXCEPTION 'O catálogo deveria indicar que desativar está indisponível.'; END IF;
  BEGIN
    PERFORM public.mr_saloum_alterar_catalogo_v1('barber','deactivate',matheus_id,version,NULL);
    RAISE EXCEPTION 'A RPC aceitou desativar com reserva futura.';
  EXCEPTION WHEN SQLSTATE 'MS001' THEN NULL;
  END;
  BEGIN
    UPDATE public.barbers SET active=false WHERE id=matheus_id;
    RAISE EXCEPTION 'O gatilho aceitou desativar com reserva futura.';
  EXCEPTION WHEN SQLSTATE 'MS001' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=future_id AND status='confirmed')
  THEN RAISE EXCEPTION 'A reserva futura foi alterada.'; END IF;
  DELETE FROM public.appointments WHERE id=future_id;
  PERFORM public.mr_saloum_alterar_catalogo_v1('barber','deactivate',matheus_id,version,NULL);
  SELECT catalog_version::text INTO STRICT version FROM public.barbers WHERE id=matheus_id AND NOT active;
  BEGIN
    PERFORM public.mr_saloum_alterar_catalogo_v1('barber','delete',matheus_id,version,NULL);
    RAISE EXCEPTION 'Exclusão definitiva indevida.';
  EXCEPTION WHEN SQLSTATE 'MS002' THEN NULL;
  END;

  FOR barber_profile IN
    SELECT p.id,p.barber_id FROM public.profiles p JOIN public.barbers b ON b.id=p.barber_id
    WHERE p.role='barber' AND lower(split_part(btrim(b.name),' ',1)) IN ('isaac','joão')
  LOOP
    isolated_profiles := isolated_profiles + 1;
    PERFORM set_config('request.jwt.claim.sub', barber_profile.id::text, true);
    IF public.is_master_admin() OR public.mr_saloum_pode_gerenciar_catalogo_v1()
      OR EXISTS (SELECT 1 FROM public.painel_financeiro(finance_day) f WHERE f.barber_id<>barber_profile.barber_id)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(public.painel_agendamentos()) a WHERE a->>'barber_id'<>barber_profile.barber_id::text)
      OR NOT mr_saloum_private.can_upload_barber_photo(barber_profile.barber_id::text || '/' || gen_random_uuid() || '.webp')
      OR mr_saloum_private.can_upload_barber_photo(matheus_id::text || '/' || gen_random_uuid() || '.webp')
    THEN RAISE EXCEPTION 'Isolamento individual do barbeiro falhou.'; END IF;
  END LOOP;
  IF isolated_profiles <> 2 THEN RAISE EXCEPTION 'Perfis de Isaac e João divergentes no teste.'; END IF;
END
$test$;
SET LOCAL ROLE anon;
DO $public$
BEGIN
  IF (SELECT array_agg(lower(split_part(btrim(name),' ',1)) ORDER BY lower(split_part(btrim(name),' ',1)) COLLATE "C") FROM public.barbers WHERE active)
      IS DISTINCT FROM ARRAY['isaac','joão']::text[]
  THEN RAISE EXCEPTION 'A vitrine anônima não contém somente Isaac e João.'; END IF;
END
$public$;
SELECT 'DONO, agenda, financeiro, fotos, isolamento, catálogo e vitrine: OK';
ROLLBACK;
