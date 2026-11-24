export const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024
export const MAX_PHOTO_BYTES = 300 * 1024
const PREFERRED_BYTES = 150 * 1024
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function photoObjectPath(barberId, imageId) {
  if (!uuid.test(barberId) || !uuid.test(imageId)) throw new Error('Identificador inválido para a foto.')
  return `${barberId.toLowerCase()}/${imageId.toLowerCase()}.webp`
}

export function validatePhotoSize(size) {
  if (!size || size > MAX_ORIGINAL_BYTES) throw new Error('Selecione uma imagem de até 10 MB.')
}

export function validatePhotoDimensions(width, height) {
  if (!width || !height || width > 8192 || height > 8192 || width * height > 24_000_000) {
    throw new Error('A imagem excede o limite de dimensões.')
  }
}

export function readPhotoDimensions(buffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const text = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length))
  const u24 = (offset) => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536

  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 7) === 'PNG\r\n\x1a\n' && text(12, 4) === 'IHDR') {
    return [view.getUint32(16), view.getUint32(20)]
  }
  if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    if (text(12, 4) === 'VP8X') {
      if (bytes[20] & 2) throw new Error('Escolha uma foto estática.')
      return [1 + u24(24), 1 + u24(27)]
    }
    if (text(12, 4) === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)]
    }
    if (text(12, 4) === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff]
    }
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length && bytes[offset++] === 255) {
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (offset + 2 > bytes.length || marker === 0xda || marker === 0xd9) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        return [view.getUint16(offset + 5), view.getUint16(offset + 3)]
      }
      offset += length
    }
  }
  throw new Error('Selecione uma imagem JPEG, PNG ou WebP válida.')
}

export async function decodeBarberPhoto(file) {
  validatePhotoSize(file.size)
  validatePhotoDimensions(...readPhotoDimensions(await file.arrayBuffer()))
  if (typeof createImageBitmap === 'function') {
    const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
    try {
      validatePhotoDimensions(image.width, image.height)
      return { image, width: image.width, height: image.height, close: () => image.close() }
    } catch (error) { image.close(); throw error }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    validatePhotoDimensions(image.naturalWidth, image.naturalHeight)
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => { image.src = '' } }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function squareCrop(width, height, { zoom, x, y }) {
  const side = Math.min(width, height) / zoom
  return { left: (width - side) * x / 100, top: (height - side) * y / 100, side }
}

export async function renderBarberPhoto(source, frame) {
  const { left, top, side } = squareCrop(source.width, source.height, frame)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('O navegador não conseguiu processar a foto.')
  let final
  try {
    for (const size of [512, 384, 256]) {
      canvas.width = canvas.height = Math.min(size, Math.max(1, Math.floor(side)))
      context.drawImage(source.image, left, top, side, side, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.84, 0.7, 0.54]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
        if (blob?.type !== 'image/webp') throw new Error('O navegador não suporta exportação WebP.')
        if (blob.size <= MAX_PHOTO_BYTES && !final) final = blob
        if (blob.size <= PREFERRED_BYTES) return blob
      }
    }
    if (final) return final
    throw new Error('Não foi possível reduzir a foto para até 300 KB.')
  } finally {
    canvas.width = canvas.height = 0
  }
}
