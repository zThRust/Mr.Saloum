import test from 'node:test'
import assert from 'node:assert/strict'
import { appointmentSwipeAction, barberSwipeDestination, barberSwipeStart, historicalBarbers, selectedBarberIndex } from '../src/barberCalendarNavigation.js'

const start = { clientX: 120, clientY: 120, identifier: 2 }
const end = (clientX, clientY, identifier = 2) => ({ clientX, clientY, identifier })

test('deslizar para a esquerda avança e para a direita volta', () => {
  let current = 0
  for (const expected of [1, 2, 3, 3]) {
    current = barberSwipeDestination(start, end(40, 125), current, 4)
    assert.equal(current, expected)
  }
  for (const expected of [2, 1, 0, 0]) {
    current = barberSwipeDestination(start, end(200, 115), current, 4)
    assert.equal(current, expected)
  }
})

test('a navegação para nos extremos e funciona com uma única agenda', () => {
  assert.equal(barberSwipeDestination(start, end(40, 120), 2, 3), 2)
  assert.equal(barberSwipeDestination(start, end(200, 120), 0, 3), 0)
  assert.equal(barberSwipeDestination(start, end(40, 120), 0, 1), 0)
})

test('rolagem vertical, diagonal, toques curtos e cancelados não trocam de agenda', () => {
  for (const finish of [end(100, 210), end(35, 200), end(90, 110), null]) {
    assert.equal(barberSwipeDestination(start, finish, 1, 3), 1)
  }
  assert.equal(barberSwipeDestination(null, end(40, 120), 1, 3), 1)
  assert.equal(barberSwipeDestination(start, end(40, 120, 5), 1, 3), 1)
})

test('a seleção direta segue o ID e retorna ao primeiro quando o barbeiro sai da lista', () => {
  const barbers = [{ id: 'a' }, { id: 'b' }]
  assert.equal(selectedBarberIndex(barbers, 'b'), 1)
  assert.equal(selectedBarberIndex([...barbers].reverse(), 'b'), 0)
  assert.equal(selectedBarberIndex([{ id: 'c' }, ...barbers], 'b'), 2)
  assert.equal(selectedBarberIndex([{ id: 'a' }, { id: 'c' }], 'b'), 0)
  assert.equal(selectedBarberIndex(barbers, 'c'), 0)
  assert.equal(selectedBarberIndex([], 'b'), 0)
})

test('o gesto nos cartões e nos controles não inicia navegação', () => {
  const targetInside = (ancestor, matchedElement = {}) => ({
    closest: (selectors) => selectors.split(', ').includes(ancestor) ? matchedElement : null
  })
  for (const classes of ['is-booked', 'is-free', 'is-blocked', 'is-past']) {
    const target = targetInside('.admin-calendar-event', { className: `admin-calendar-event ${classes}` })
    assert.equal(barberSwipeStart({ target, touches: [start] }), null)
  }
  for (const ancestor of ['button', 'select']) {
    assert.equal(barberSwipeStart({ target: targetInside(ancestor), touches: [start] }), null)
  }
  const target = targetInside('.admin-calendar-mobile-identity')
  assert.equal(barberSwipeStart({ target, touches: [start] }), start)
  assert.equal(barberSwipeStart({ target, touches: [start, end(130, 130, 3)] }), null)
})

test('o cartão mantém ações de confirmação à direita e cancelamento à esquerda', () => {
  const pointer = { x: 120, y: 120 }
  assert.equal(appointmentSwipeAction(pointer, end(195, 125)), 'complete')
  assert.equal(appointmentSwipeAction(pointer, end(45, 125)), 'cancel')
  assert.equal(appointmentSwipeAction(pointer, end(120, 220)), null)
  assert.equal(appointmentSwipeAction(pointer, end(180, 120)), null)
})

test('identifica barbeiros históricos por ID sem duplicar ativos ou inferir IDs pelo nome', () => {
  assert.deepEqual(historicalBarbers([{ id: 'a', name: 'Nome atual' }], [
    { barber_id: 'a', barber_name: 'Nome anterior' },
    { barber_id: 'b', barber_name: 'Bruno' },
    { barber_id: 'b', barber_name: 'Bruno' },
    { barber_name: 'Sem vínculo' }
  ]), [{ id: 'b', name: 'Bruno', active: false }])
})
