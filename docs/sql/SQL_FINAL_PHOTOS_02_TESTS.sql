BEGIN;
-- Sanidade do patch. A matriz comportamental com sessões diferentes vem abaixo.
DO $$
DECLARE
  valid_example text := '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.webp';
BEGIN
  IF NOT mr_saloum_photos.valid_path(valid_example)
     OR mr_saloum_photos.valid_path('../' || valid_example)
     OR mr_saloum_photos.valid_path(valid_example || '?v=1')
     OR mr_saloum_photos.valid_path(replace(valid_example, '.webp', '.svg'))
  THEN RAISE EXCEPTION 'Validação de caminho fora do contrato'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.mr_saloum_pode_editar_foto_v1(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mr_saloum_pode_editar_foto_v1(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'mr_saloum_photos.claim_orphan(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'mr_saloum_photos.claim_orphan(text)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Privilégios de função fora do contrato'; END IF;
END
$$;

DO $$
BEGIN
  IF has_schema_privilege('anon', 'mr_saloum_private', 'USAGE')
    OR has_schema_privilege('authenticated', 'mr_saloum_private', 'USAGE')
    OR has_function_privilege('anon', 'mr_saloum_private.can_upload_barber_photo(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'mr_saloum_private.can_upload_barber_photo(text)', 'EXECUTE')
    OR EXISTS (SELECT 1 FROM mr_saloum_photos.settings WHERE enabled OR gc_enabled)
  THEN RAISE EXCEPTION 'Acesso privado ou capacidade ativa inesperada'; END IF;
END
$$;
SELECT attname FROM pg_attribute WHERE attrelid = 'storage.objects'::regclass AND attnum > 0 AND NOT attisdropped;
SELECT table_schema, table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND (column_name ~* 'photo|image|avatar|url|snapshot|metadata'
  OR data_type IN ('json', 'jsonb')) ORDER BY 1, 2, 3;
SELECT schemaname, viewname FROM pg_views WHERE schemaname = 'public' AND definition ~* 'photo_url|barber-photos';
SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosrc ~* 'photo_url|barber-photos';
ROLLBACK;
