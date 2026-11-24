import test from 'node:test'
import assert from 'node:assert/strict'
import { barberProfileFailure, barberProfilePayload, editableBarberProfiles } from '../src/barberProfile.js'

const self = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Barbeiro teste',
  photo_url: null,
  whatsapp: null,
  active: true,
  version: 'v1'
}
const other = { ...self, id: '00000000-0000-4000-8000-000000000002', active: false }
const barber = { role: 'barber', barber_id: self.id }
const admin = { role: 'admin' }

test('a edição individual só abre com resposta válida para a própria conta', () => {
  assert.deepEqual(editableBarberProfiles([self], barber), [self])
  assert.deepEqual(editableBarberProfiles([other], barber), [])
  assert.deepEqual(editableBarberProfiles([self, other], barber), [])
  assert.deepEqual(editableBarberProfiles([self], { role: 'customer' }), [])
})

test('a listagem autorizada do administrador pode incluir inativos e rejeita versões ou IDs inválidos', () => {
  assert.deepEqual(editableBarberProfiles([self, other], admin), [self, other])
  for (const response of [null, {}, [], [self, self], [{ ...self, id: 'bad' }], [{ ...self, version: '' }]]) {
    assert.deepEqual(editableBarberProfiles(response, admin), [])
  }
})

test('o payload só inclui o alvo autorizado, versão e campos editáveis normalizados', () => {
  assert.deepEqual(barberProfilePayload(self, ' https://example.test/foto.jpg ', '+55 (84) 99999-1234'), {
    p_barber_id: self.id,
    p_expected_version: 'v1',
    p_photo_url: 'https://example.test/foto.jpg',
    p_whatsapp: '5584999991234'
  })
  assert.equal(barberProfilePayload(self, '', '84999991234').p_whatsapp, '84999991234')
  assert.equal(barberProfilePayload(self, '', '').p_photo_url, null)
  assert.equal(barberProfilePayload(self, '', '').p_whatsapp, null)
})

test('rejeita protocolo inseguro, credenciais em URL e telefone inválido', () => {
  for (const url of ['http://example.test', 'https://', 'https://a:b@example.test', 'javascript:void(0)']) {
    assert.ok(barberProfilePayload(self, url, '').error)
  }
  for (const phone of ['123', '84999991234 ext 5', '+1 (555) 123-4567', '+084999991234']) {
    assert.ok(barberProfilePayload(self, '', phone).error)
  }
})

test('revogação, versão desatualizada e resultado incerto exigem recarga', () => {
  for (const [code, status] of [['42501', 403], ['', 401], ['', 403], ['MS004', 400], ['', 0], ['', 408], ['', 502]]) {
    assert.equal(barberProfileFailure({ code }, status).invalidate, true)
  }
  assert.equal(barberProfileFailure({ code: '22023' }, 400).invalidate, false)
})
