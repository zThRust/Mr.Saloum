-- Proposta. Executar e validar primeiramente apenas num clone sem dados reais.
-- Dependências: Supabase Auth/Storage, public.barbers(id, active, photo_url),
-- public.profiles(id, role, barber_id), is_master_admin() e RPCs v1 do catálogo.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'barber-photos' AND public
    AND file_size_limit = 307200 AND allowed_mime_types = ARRAY['image/webp']::text[])
    OR to_regprocedure('mr_saloum_private.can_upload_barber_photo(text)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'storage.objects'::regclass AND relrowsecurity)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'storage.objects'::regclass
      AND attname = 'version' AND NOT attisdropped)
    OR NOT EXISTS (
      SELECT 1 FROM pg_index i
      JOIN pg_attribute b ON b.attrelid = i.indrelid AND b.attname = 'bucket_id'
      JOIN pg_attribute n ON n.attrelid = i.indrelid AND n.attname = 'name'
      WHERE i.indrelid = 'storage.objects'::regclass AND i.indisunique AND i.indisvalid
        AND (i.indpred IS NULL OR pg_get_expr(i.indpred, i.indrelid) = '(archived_at IS NULL)')
        AND i.indnkeyatts = 2
        AND i.indkey[0] IN (b.attnum, n.attnum) AND i.indkey[1] IN (b.attnum, n.attnum)
        AND i.indkey[0] <> i.indkey[1]
    )
  THEN RAISE EXCEPTION 'Pré-requisitos de Storage ou função privada ausentes ou divergentes'; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS mr_saloum_photos;
REVOKE ALL ON SCHEMA mr_saloum_photos FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA mr_saloum_photos TO service_role;

CREATE TABLE IF NOT EXISTS mr_saloum_photos.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  api_origin text CHECK (api_origin ~ '^https://[a-z0-9.-]+$'
    OR api_origin ~ '^http://127[.]0[.]0[.]1:[0-9]{4,5}$'),
  enabled boolean NOT NULL DEFAULT false,
  gc_enabled boolean NOT NULL DEFAULT false,
  CHECK (NOT enabled OR api_origin IS NOT NULL)
);
ALTER TABLE mr_saloum_photos.settings ADD COLUMN IF NOT EXISTS gc_enabled boolean NOT NULL DEFAULT false;
INSERT INTO mr_saloum_photos.settings (singleton) VALUES (true)
  ON CONFLICT (singleton) DO UPDATE SET enabled = false, gc_enabled = false;
ALTER TABLE mr_saloum_photos.settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mr_saloum_photos.settings FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS mr_saloum_photos.gc_claims (
  path text PRIMARY KEY,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
ALTER TABLE mr_saloum_photos.gc_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mr_saloum_photos.gc_claims FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS mr_saloum_photos.uploads (
  path text PRIMARY KEY,
  actor_id uuid NOT NULL,
  barber_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  object_version text,
  output_size integer CHECK (output_size BETWEEN 1 AND 307200),
  output_sha256 text CHECK (output_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS saloum_photos_upload_actor_time ON mr_saloum_photos.uploads(actor_id, created_at);
ALTER TABLE mr_saloum_photos.uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mr_saloum_photos.uploads FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mr_saloum_photos.valid_path(p_path text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT COALESCE(p_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}[.]webp$', false);
$$;

CREATE OR REPLACE FUNCTION mr_saloum_photos.can_edit(p_barber_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT auth.uid() IS NOT NULL
    AND COALESCE(auth.jwt()->>'is_anonymous', 'false') <> 'true'
    AND EXISTS (SELECT 1 FROM mr_saloum_photos.settings WHERE enabled)
    AND EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'barber-photos' AND b.public
      AND b.file_size_limit = 307200 AND b.allowed_mime_types = ARRAY['image/webp']::text[])
    AND CASE WHEN p_barber_id IS NULL
        THEN COALESCE(public.is_master_admin(), false)
          AND COALESCE(public.mr_saloum_pode_gerenciar_catalogo_v1(), false)
        ELSE COALESCE(mr_saloum_private.can_upload_barber_photo(
          p_barber_id::text || '/00000000-0000-4000-8000-000000000001.webp'), false)
        END;
$$;

-- Acesso GET público usa o endpoint público do bucket, sem abrir listagem SQL.
-- Restrições são escopadas ao bucket e prevalecem mesmo com permissivas preexistentes.
DROP POLICY IF EXISTS saloum_photos_insert ON storage.objects;
DROP POLICY IF EXISTS saloum_photos_insert_guard ON storage.objects;
DROP POLICY IF EXISTS saloum_photos_no_list ON storage.objects;
DROP POLICY IF EXISTS saloum_photos_no_update ON storage.objects;
DROP POLICY IF EXISTS saloum_photos_no_delete ON storage.objects;
CREATE POLICY saloum_photos_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id <> 'barber-photos');
CREATE POLICY saloum_photos_no_list ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (bucket_id <> 'barber-photos');
CREATE POLICY saloum_photos_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (bucket_id <> 'barber-photos') WITH CHECK (bucket_id <> 'barber-photos');
CREATE POLICY saloum_photos_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (bucket_id <> 'barber-photos');
DROP FUNCTION IF EXISTS mr_saloum_photos.can_upload(text);

CREATE OR REPLACE FUNCTION public.mr_saloum_pode_editar_foto_v1(p_barber_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT mr_saloum_photos.can_edit(p_barber_id);
$$;

CREATE OR REPLACE FUNCTION public.mr_saloum_reservar_upload_foto_v1(p_barber_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid := auth.uid();
  object_path text;
  origin text;
BEGIN
  IF p_barber_id IS NULL OR actor IS NULL OR NOT COALESCE(mr_saloum_photos.can_edit(p_barber_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Upload indisponível';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 184414));
  IF (SELECT count(*) FROM mr_saloum_photos.uploads u WHERE u.actor_id = actor
      AND u.created_at > clock_timestamp() - interval '5 minutes') >= 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT429', MESSAGE = 'Limite de uploads atingido';
  END IF;
  SELECT api_origin INTO origin FROM mr_saloum_photos.settings WHERE enabled;
  IF origin IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Upload indisponível'; END IF;
  object_path := p_barber_id::text || '/' || gen_random_uuid()::text || '.webp';
  INSERT INTO mr_saloum_photos.uploads(path, actor_id, barber_id, expires_at)
    VALUES (object_path, actor, p_barber_id, clock_timestamp() + interval '90 seconds');
  RETURN jsonb_build_object('path', object_path, 'public_url', origin || '/storage/v1/object/public/barber-photos/' || object_path);
END
$$;

CREATE OR REPLACE FUNCTION public.mr_saloum_validar_upload_foto_v1(p_path text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM mr_saloum_photos.uploads u
    WHERE u.path = p_path AND u.actor_id = auth.uid() AND u.expires_at > clock_timestamp()
      AND u.approved_at IS NULL AND mr_saloum_photos.can_edit(u.barber_id)
      AND NOT EXISTS (SELECT 1 FROM mr_saloum_photos.gc_claims c WHERE c.path = u.path)
  );
$$;

CREATE OR REPLACE FUNCTION public.mr_saloum_atestar_upload_foto_v1(p_path text, p_actor uuid, p_size integer, p_sha256 text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT mr_saloum_photos.valid_path(p_path) OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 307200
      OR NOT COALESCE(p_sha256 ~ '^[0-9a-f]{64}$', false)
  THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_path, 184413));
  UPDATE mr_saloum_photos.uploads u
    SET approved_at = clock_timestamp(), object_version = o.version::text, output_size = p_size, output_sha256 = p_sha256
    FROM storage.objects o
    WHERE u.path = p_path AND u.actor_id = p_actor AND u.expires_at > clock_timestamp() AND u.approved_at IS NULL
      AND EXISTS (SELECT 1 FROM mr_saloum_photos.settings WHERE enabled)
      AND NOT EXISTS (SELECT 1 FROM mr_saloum_photos.gc_claims c WHERE c.path = u.path)
      AND o.bucket_id = 'barber-photos' AND o.name = u.path AND NULLIF(o.version::text, '') IS NOT NULL
      AND to_jsonb(o)->>'archived_at' IS NULL
      AND (to_jsonb(o)->>'is_delete_marker') IS DISTINCT FROM 'true'
      AND o.metadata->>'mimetype' = 'image/webp' AND o.metadata->>'size' = p_size::text;
  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION mr_saloum_photos.guard_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  base text;
  object_path text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.photo_url IS NOT DISTINCT FROM OLD.photo_url THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.photo_url IS NULL THEN RETURN NEW; END IF;
  IF NOT mr_saloum_photos.can_edit(NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Edição de foto indisponível para este barbeiro';
  END IF;
  IF NEW.photo_url IS NULL THEN RETURN NEW; END IF;
  SELECT api_origin || '/storage/v1/object/public/barber-photos/' INTO base
    FROM mr_saloum_photos.settings WHERE enabled;
  IF base IS NULL OR NOT starts_with(NEW.photo_url, base) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Referência de foto inválida';
  END IF;
  object_path := substring(NEW.photo_url FROM length(base) + 1);
  IF NOT mr_saloum_photos.valid_path(object_path) OR split_part(object_path, '/', 1) <> NEW.id::text THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A foto não pertence ao barbeiro';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(object_path, 184413));
  IF EXISTS (SELECT 1 FROM mr_saloum_photos.gc_claims WHERE path = object_path) OR NOT EXISTS (
    SELECT 1 FROM storage.objects o JOIN mr_saloum_photos.uploads u
      ON u.path = o.name AND u.barber_id = NEW.id AND u.actor_id = auth.uid() AND u.approved_at IS NOT NULL
      AND u.object_version = o.version::text AND u.output_sha256 IS NOT NULL
      AND u.output_size::text = o.metadata->>'size'
    WHERE o.bucket_id = 'barber-photos' AND o.name = object_path
      AND NULLIF(to_jsonb(o)->>'version', '') IS NOT NULL
      AND to_jsonb(o)->>'archived_at' IS NULL
      AND (to_jsonb(o)->>'is_delete_marker') IS DISTINCT FROM 'true'
      AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT * FROM jsonb_each_text(to_jsonb(o))
          UNION ALL
          SELECT * FROM jsonb_each_text(COALESCE(o.metadata, '{}'::jsonb))
        ) f
        WHERE lower(replace(f.key, '_', '')) IN
          ('deletemarker', 'isdeletemarker', 'deleted', 'isdeleted', 'deletedat', 'archived', 'isarchived', 'archivedat')
          AND COALESCE(lower(f.value), '') NOT IN ('', 'false', '0', 'null')
      )
      AND o.metadata->>'mimetype' = 'image/webp'
      AND CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,8}$' THEN (o.metadata->>'size')::int BETWEEN 1 AND 307200 ELSE false END
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Objeto da foto indisponível';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS saloum_guard_photo_reference ON public.barbers;
CREATE TRIGGER saloum_guard_photo_reference BEFORE INSERT OR UPDATE OF photo_url ON public.barbers
  FOR EACH ROW EXECUTE FUNCTION mr_saloum_photos.guard_reference();

-- Uma transação só para criar pelo contrato atual e resolver o vínculo pela PK do perfil.
CREATE OR REPLACE FUNCTION public.mr_saloum_criar_barbeiro_para_foto_v1(p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  barber_id uuid;
  linked_id uuid;
  version text;
BEGIN
  IF NOT public.mr_saloum_pode_editar_foto_v1(NULL::uuid) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cadastro com foto indisponível';
  END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Objeto de cadastro obrigatório';
  END IF;
  linked_id := (p_values->>'profile_id')::uuid;
  IF linked_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Perfil obrigatório';
  END IF;
  PERFORM public.mr_saloum_alterar_catalogo_v1('barber', 'create', NULL::uuid, NULL::text,
    (p_values - 'photo_url') || '{"photo_url":null}'::jsonb);
  SELECT p.barber_id INTO STRICT barber_id FROM public.profiles p WHERE p.id = linked_id;
  SELECT item->>'version' INTO STRICT version
    FROM jsonb_array_elements(public.mr_saloum_listar_catalogo_v1()::jsonb->'barbers') item
    WHERE item->>'id' = barber_id::text;
  IF barber_id IS NULL OR NULLIF(version, '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MS004', MESSAGE = 'Vínculo ou versão não encontrados';
  END IF;
  RETURN jsonb_build_object('id', barber_id, 'version', version);
END
$$;

-- Uso exclusivo por job confiável, com a Storage API para exclusão física.
-- O objeto fica impedido de ser referenciado após a concessão deste tombstone.
CREATE OR REPLACE FUNCTION mr_saloum_photos.claim_orphan(p_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  base text;
BEGIN
  IF NOT mr_saloum_photos.valid_path(p_path) THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_path, 184413));
  SELECT api_origin || '/storage/v1/object/public/barber-photos/' INTO base
    FROM mr_saloum_photos.settings WHERE enabled AND gc_enabled;
  IF base IS NULL OR EXISTS (SELECT 1 FROM public.barbers b
      WHERE right(split_part(split_part(b.photo_url, '?', 1), '#', 1), length('/barber-photos/' || p_path)) = '/barber-photos/' || p_path)
      OR NOT EXISTS (
        SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'barber-photos' AND o.name = p_path
          AND o.created_at < clock_timestamp() - interval '7 days'
      ) THEN RETURN false; END IF;
  INSERT INTO mr_saloum_photos.gc_claims (path) VALUES (p_path) ON CONFLICT DO NOTHING;
  RETURN EXISTS (SELECT 1 FROM mr_saloum_photos.gc_claims WHERE path = p_path AND deleted_at IS NULL);
END
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mr_saloum_photos FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mr_saloum_photos.claim_orphan(text) TO service_role;

REVOKE ALL ON FUNCTION public.mr_saloum_pode_editar_foto_v1(uuid), public.mr_saloum_criar_barbeiro_para_foto_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mr_saloum_pode_editar_foto_v1(uuid), public.mr_saloum_criar_barbeiro_para_foto_v1(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.mr_saloum_reservar_upload_foto_v1(uuid), public.mr_saloum_validar_upload_foto_v1(text),
  public.mr_saloum_atestar_upload_foto_v1(text,uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mr_saloum_reservar_upload_foto_v1(uuid), public.mr_saloum_validar_upload_foto_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mr_saloum_atestar_upload_foto_v1(text,uuid,integer,text) TO service_role;

COMMIT;
