-- Suspende gravações e GC. O GET público e o contato com foto inalterada permanecem.
BEGIN;
UPDATE mr_saloum_photos.settings SET enabled = false, gc_enabled = false WHERE singleton;
COMMIT;
-- Preservar bucket, objetos, referências, tombstones e as restrições de acesso.
-- Para uma remoção estrutural, inventariar primeiro as referências e manter
-- as gravações suspensas. Não excluir fisicamente via storage.objects.
