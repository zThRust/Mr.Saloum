import { photoObjectPath } from './barberPhoto'
import { supabase } from './lib/supabase'

export async function resolvePhotoDraft(draft, record) {
  if (!draft) return record?.photo_url ?? null
  if (draft.kind === 'remove') return null
  if (draft.kind !== 'upload') throw new Error('Aguarde o processamento da foto.')
  const { data, error } = await supabase.functions.invoke('barber-photo-upload', {
    body: draft.blob,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Barber-Id': record.id }
  })
  if (error) {
    const detail = error.context instanceof Response ? await error.context.json().catch(() => null) : null
    const message = typeof detail?.message === 'string' ? detail.message : 'Não foi possível confirmar o envio da foto. A foto atual foi preservada.'
    throw new Error(message)
  }
  const url = new URL(data?.public_url)
  const prefix = '/storage/v1/object/public/barber-photos/'
  const file = url.pathname.split('/').at(-1)
  if (url.origin !== new URL(import.meta.env.VITE_SUPABASE_URL).origin || url.search || url.hash ||
      url.pathname !== prefix + photoObjectPath(record.id, file.slice(0, -5))) {
    throw new Error('A referência da foto não pôde ser confirmada.')
  }
  return url.href
}
