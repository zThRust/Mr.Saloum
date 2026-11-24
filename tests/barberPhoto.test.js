import { test } from 'node:test'
import assert from 'node:assert/strict'
import { photoObjectPath, readPhotoDimensions, squareCrop, validatePhotoDimensions, validatePhotoSize } from '../src/barberPhoto.js'
import { barberProfilePayload } from '../src/barberProfile.js'

test('caminhos são exclusivos do UUID do barbeiro e rejeitam segmentos extras', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  assert.equal(photoObjectPath(id, id), `${id}/${id}.webp`)
  assert.throws(() => photoObjectPath('../barbeiro', id))
  assert.throws(() => photoObjectPath(id, 'imagem.webp'))
})

test('valida assinatura, dimensões e tamanho antes da decodificação', () => {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 0, 0, 0, 2, 0])
  assert.deepEqual(readPhotoDimensions(bytes.buffer), [256, 512])
  assert.throws(() => readPhotoDimensions(new TextEncoder().encode('<svg />').buffer))
  assert.throws(() => validatePhotoDimensions(8000, 8000))
  assert.throws(() => validatePhotoDimensions(8193, 1))
  assert.throws(() => validatePhotoSize(10 * 1024 * 1024 + 1))
  assert.doesNotThrow(() => validatePhotoSize(10 * 1024 * 1024))
})

test('recorte quadrado respeita o zoom e fica dentro da imagem', () => {
  assert.deepEqual(squareCrop(800, 400, { zoom: 1, x: 50, y: 50 }), { left: 200, top: 0, side: 400 })
  assert.deepEqual(squareCrop(800, 400, { zoom: 2, x: 100, y: 100 }), { left: 600, top: 200, side: 200 })
})

test('editar telefone preserva a referência legada existente sem aceitar outra URL insegura', () => {
  const record = { photo_url: 'http://example.test/foto-legada.jpg' }
  assert.equal(barberProfilePayload(record, record.photo_url, '85999991234').p_photo_url, record.photo_url)
  assert.ok(barberProfilePayload(record, 'http://example.test/outra.jpg', '85999991234').error)
})
