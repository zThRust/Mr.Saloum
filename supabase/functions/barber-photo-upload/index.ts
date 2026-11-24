import { maxBytes, reencodeWebp } from './codec.ts'

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const pathname = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/
const bucketPath = '/storage/v1/object/barber-photos/'
const allowedOrigins = (Deno.env.get('MR_SALOUM_PHOTO_ORIGINS') ?? 'https://mr-saloum.onrender.com').split(',').map((item) => item.trim())

async function boundedBody(request: Request) {
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error('too_large')
  if (!request.body) throw new Error('invalid')
  const reader = request.body.getReader()
  const signal = AbortSignal.timeout(8000)
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const bytes = new Uint8Array(maxBytes)
  let offset = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (signal.aborted) throw new Error('timeout')
      if (done) break
      if (offset + value.length > maxBytes) throw new Error('too_large')
      bytes.set(value, offset)
      offset += value.length
    }
    return bytes.subarray(0, offset)
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json', Vary: 'Origin' })
  const reply = (status: number, data: object) => new Response(JSON.stringify(data), { status, headers })
  if (origin) {
    if (!allowedOrigins.includes(origin)) return reply(403, { message: 'Origem não autorizada.' })
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-barber-id')
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply(405, { message: 'Método inválido.' })
  const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('authorization')
  const barberId = request.headers.get('x-barber-id') ?? ''
  if (!base || !anon || !service) return reply(503, { message: 'Envio de fotos indisponível.' })
  if (!authorization?.startsWith('Bearer ')) return reply(401, { message: 'Sessão necessária.' })
  if (!uuid.test(barberId)) return reply(400, { message: 'Barbeiro inválido.' })

  const asUser = { apikey: anon, Authorization: authorization }
  const asService = { apikey: service, Authorization: 'Bearer ' + service }
  const rpc = (action: string, body: object, identity = asUser) => fetch(base + '/rest/v1/rpc/' + action, {
    method: 'POST', headers: { ...identity, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(7000)
  })

  try {
    const identity = await fetch(base + '/auth/v1/user', { headers: asUser, redirect: 'error', signal: AbortSignal.timeout(7000) })
    if (!identity.ok) return reply(identity.status >= 500 ? 503 : 401, { message: 'Não foi possível validar a sessão.' })
    const user = await identity.json()
    if (!uuid.test(user.id) || user.is_anonymous === true) return reply(403, { message: 'Sessão sem permissão para upload.' })
    const reserve = await rpc('mr_saloum_reservar_upload_foto_v1', { p_barber_id: barberId })
    if (!reserve.ok) {
      if (reserve.status === 429) return reply(429, { message: 'Muitas tentativas. Aguarde alguns minutos.' })
      return reply(reserve.status >= 500 || reserve.status === 404 ? 503 : 403, { message: 'Envio de foto indisponível para este barbeiro.' })
    }
    const ticket = await reserve.json()
    if (!pathname.test(ticket.path) || !ticket.path.startsWith(barberId + '/') || typeof ticket.public_url !== 'string') {
      return reply(503, { message: 'Não foi possível preparar o envio.' })
    }
    let input
    try { input = await boundedBody(request) } catch (error) {
      if (error instanceof Error && error.message === 'too_large') return reply(413, { message: 'Foto acima de 300 KiB.' })
      return reply(408, { message: 'Não foi possível receber a foto a tempo.' })
    }
    let output
    try { output = await reencodeWebp(input) } catch {
      return reply(422, { message: 'WebP inválido ou fora dos limites.' })
    }
    const check = () => rpc('mr_saloum_validar_upload_foto_v1', { p_path: ticket.path })
    const before = await check()
    if (!before.ok || await before.json() !== true) return reply(403, { message: 'A autorização de upload mudou.' })
    const uploaded = await fetch(base + bucketPath + ticket.path, {
      method: 'POST', headers: { ...asService, 'Content-Type': 'image/webp', 'x-upsert': 'false', 'Cache-Control': 'max-age=31536000' },
      body: output.slice().buffer as ArrayBuffer, redirect: 'error', signal: AbortSignal.timeout(10000)
    })
    if (!uploaded.ok) return reply(503, { message: 'Envio não confirmado. A foto atual foi mantida.' })
    const after = await check()
    if (!after.ok || await after.json() !== true) return reply(403, { message: 'A autorização mudou. A foto atual foi mantida.' })
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', output.slice().buffer as ArrayBuffer))
    const sha = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
    const approved = await rpc('mr_saloum_atestar_upload_foto_v1', {
      p_path: ticket.path, p_actor: user.id, p_size: output.length, p_sha256: sha
    }, asService)
    if (!approved.ok || await approved.json() !== true) return reply(503, { message: 'Foto não confirmada. A foto atual foi mantida.' })
    return reply(200, { public_url: ticket.public_url })
  } catch {
    return reply(503, { message: 'Operação não confirmada. Confira o perfil antes de tentar novamente.' })
  }
})
