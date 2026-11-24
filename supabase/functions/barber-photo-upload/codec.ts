import createDecoder from 'npm:@jsquash/webp@1.5.0/codec/dec/webp_dec.js'
import createEncoder from 'npm:@jsquash/webp@1.5.0/codec/enc/webp_enc.js'
import { defaultOptions } from 'npm:@jsquash/webp@1.5.0/meta.js'
import { decoderWasm, encoderWasm } from './codec-data.ts'

export const maxBytes = 307200
const side = 512
const tag = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
const binary = (value: string) => Uint8Array.from(atob(value), (letter) => letter.charCodeAt(0))
type Frame = { data: Uint8ClampedArray; width: number; height: number }

// Check the actual VP8/VP8L frame as well as the optional VP8X canvas before decoding.
export function inspectWebp(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 26 || bytes.length > maxBytes || tag(bytes, 0) !== 'RIFF' ||
      tag(bytes, 8) !== 'WEBP' || view.getUint32(4, true) !== bytes.length - 8) throw new Error('WebP inválido')
  let frame: [number, number] | undefined
  let canvas: [number, number] | undefined
  let offset = 12
  for (; offset + 8 <= bytes.length;) {
    const chunk = tag(bytes, offset)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    const next = start + size + (size & 1)
    if (next > bytes.length || chunk === 'ANIM' || chunk === 'ANMF') throw new Error('WebP inválido')
    if (chunk === 'VP8X') {
      if (canvas || size !== 10 || (bytes[start] & 2)) throw new Error('WebP inválido')
      const u24 = (i: number) => bytes[start + i] + 256 * bytes[start + i + 1] + 65536 * bytes[start + i + 2]
      canvas = [1 + u24(4), 1 + u24(7)]
    }
    if (chunk === 'VP8 ') {
      if (frame || size < 10 || (bytes[start] & 1) || bytes[start + 3] !== 0x9d ||
          bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) throw new Error('WebP inválido')
      frame = [view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff]
    }
    if (chunk === 'VP8L') {
      if (frame || size < 5 || bytes[start] !== 0x2f) throw new Error('WebP inválido')
      const info = view.getUint32(start + 1, true)
      if (info >>> 29) throw new Error('WebP inválido')
      frame = [1 + (info & 0x3fff), 1 + ((info >>> 14) & 0x3fff)]
    }
    offset = next
  }
  if (offset !== bytes.length || !frame || !frame[0] || frame[0] !== frame[1] || frame[0] > side ||
      (canvas && (canvas[0] !== frame[0] || canvas[1] !== frame[1]))) throw new Error('Dimensões inválidas')
  return frame[0]
}

let modules: Promise<[Awaited<ReturnType<typeof createDecoder>>, Awaited<ReturnType<typeof createEncoder>>]> | undefined

export async function reencodeWebp(bytes: Uint8Array): Promise<Uint8Array> {
  const width = inspectWebp(bytes)
  if (typeof globalThis.ImageData === 'undefined') {
    // Emscripten only constructs this object to return the decoded RGBA pixels.
    Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    } })
  }
  modules ??= Promise.all([
    createDecoder({ wasmBinary: binary(decoderWasm) }),
    createEncoder({ wasmBinary: binary(encoderWasm) })
  ])
  const [decoder, encoder] = await modules
  const frame: Frame | null = decoder.decode(bytes.slice().buffer)
  if (!frame || frame.width !== width || frame.height !== width || frame.data.length !== width * width * 4) {
    throw new Error('Decodificação WebP inválida')
  }
  const pixels = new Uint8ClampedArray(side * side * 4)
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const from = (Math.floor(y * width / side) * width + Math.floor(x * width / side)) * 4
      const to = (y * side + x) * 4
      for (let channel = 0; channel < 4; channel++) pixels[to + channel] = frame.data[from + channel]
    }
  }
  for (const quality of [80, 65, 50]) {
    const encoded = encoder.encode(pixels, side, side, { ...defaultOptions, quality, method: 2 })
    if (encoded && encoded.length <= maxBytes) {
      const output = new Uint8Array(encoded)
      if (inspectWebp(output) === side) return output
    }
  }
  throw new Error('Não foi possível comprimir a foto até o limite')
}
