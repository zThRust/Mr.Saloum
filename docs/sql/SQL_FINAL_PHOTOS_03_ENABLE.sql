-- Ação independente do catálogo. Bloqueada até preencher o origin e atestar
-- a homologação integrada, incluindo a decisão explícita sobre WebP inválido.
BEGIN;
DO $$
DECLARE
  target_origin constant text := '';
  homologated constant boolean := false;
  allow_loopback_for_clone constant boolean := false;
BEGIN
  IF NOT homologated OR target_origin = '' THEN
    RAISE EXCEPTION 'Homologue Storage e informe explicitamente o origin da API antes de ativar';
  END IF;
  IF target_origin !~ '^https://[a-z0-9.-]+$'
     AND NOT (allow_loopback_for_clone AND target_origin ~ '^http://127[.]0[.]0[.]1:[0-9]{4,5}$') THEN
    RAISE EXCEPTION 'Produção exige origin HTTPS; loopback só é aceito em cópia de homologação';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'barber-photos' AND public
    AND file_size_limit = 307200 AND allowed_mime_types = ARRAY['image/webp']::text[])
  THEN RAISE EXCEPTION 'Configuração do bucket divergente'; END IF;
  UPDATE mr_saloum_photos.settings
  SET api_origin = target_origin, enabled = true, gc_enabled = false
  WHERE singleton AND NOT enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configuração ausente ou já ativa'; END IF;
END
$$;
COMMIT;
