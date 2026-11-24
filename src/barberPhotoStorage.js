import { photoObjectPath } from './barberPhoto'
import { supabase } from './lib/supabase'

export async function resolvePhotoDraft(draft, record) {
  if (!draft) return record?.photo_url ?? null
  if (draft.kind === 'remove') return null
  if (draft.kind !== 'upload') throw new Error('Aguarde o processamento da foto.')
  const path = photoObjectPath(record.id, crypto.randomUUID())
  const bucket = supabase.storage.from('barber-photos')
  const { error } = await bucket.upload(path, draft.blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false })
  if (error) throw new Error('Não foi possível confirmar o envio da foto. A foto atual foi preservada.')
  return bucket.getPublicUrl(path).data.publicUrl
}
