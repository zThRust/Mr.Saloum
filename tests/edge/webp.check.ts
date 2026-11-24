import { inspectWebp, maxBytes, reencodeWebp } from '../../supabase/functions/barber-photo-upload/codec.ts'

const fixture = Uint8Array.from(atob('UklGRkoAAABXRUJQVlA4ID4AAAAQAwCdASogACAAPpFCnEolo6KhqAgAsBIJZQDMHBapagAA/vVYv/+5wP/9nA//2cD+Ov9eqWuTjgLLeAAAAA=='), (c) => c.charCodeAt(0))

Deno.test('WASM decodifica e reencoda um WebP em 512x512', async () => {
  if (inspectWebp(fixture) !== 32) throw new Error('Fixture inesperada')
  const output = await reencodeWebp(fixture)
  if (inspectWebp(output) !== 512 || output.length > maxBytes) throw new Error('Saída inválida')
})

Deno.test('WebP truncado, quadro excessivo e fluxo adulterado são rejeitados', async () => {
  const big = fixture.slice()
  new DataView(big.buffer).setUint16(26, 700, true)
  const fake = fixture.slice()
  fake.fill(0xff, 32)
  for (const bytes of [fixture.slice(0, -3), big, fake, new Uint8Array(maxBytes + 1)]) {
    let accepted = false
    try { await reencodeWebp(bytes); accepted = true } catch { /* esperado */ }
    if (accepted) throw new Error('Entrada inválida aceita')
  }
})
