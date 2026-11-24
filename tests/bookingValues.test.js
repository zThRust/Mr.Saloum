import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularDuracaoSlots, SERVICE_SOBRANCELHA_ID, totalItensRegistrados } from '../src/bookingValues.js'

test('sobrancelha sozinha conta como serviço e em combinação não aumenta a duração', () => {
  assert.equal(SERVICE_SOBRANCELHA_ID, '534e28f8-0c11-47a1-952f-a78aa6735e27')
  const sobrancelha = { id: SERVICE_SOBRANCELHA_ID, slot_units: 1 }
  const corte = { id: 'corte', slot_units: '2' }
  const barba = { id: 'barba', slot_units: 1 }
  assert.equal(calcularDuracaoSlots([sobrancelha]), 1)
  assert.equal(calcularDuracaoSlots([sobrancelha, corte, barba]), 3)
  assert.equal(calcularDuracaoSlots([]), 1)
})

test('total histórico usa valores registrados mesmo após editar e desativar o serviço', () => {
  const servico = { id: 'corte', price: 50, active: true }
  const itens = [
    { service_id: servico.id, service_name: 'Corte', price: String(servico.price), active: true },
    { service_id: 'barba', service_name: 'Barba', price: 20, active: true },
    { service_id: 'outro', price: 80, active: false }
  ]
  servico.price = 90
  servico.active = false
  assert.equal(totalItensRegistrados(itens.filter(({ active }) => active)), 70)
})
