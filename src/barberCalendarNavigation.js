export function selectedBarberIndex(barbers, selectedId) {
  return Math.max(0, barbers.findIndex((barber) => barber.id === selectedId))
}

export function barberSwipeStart({ target, touches }) {
  // As linhas da agenda têm seus próprios gestos de atendimento e bloqueio.
  if (touches.length !== 1 ||
      target.closest('.admin-calendar-event, button, select, input, a')) return null
  return touches[0]
}

export function barberSwipeDestination(start, end, index, count) {
  if (count < 2 || !start || !end || start.identifier !== end.identifier) return index

  const horizontal = end.clientX - start.clientX
  const vertical = end.clientY - start.clientY
  if (Math.abs(horizontal) < 55 || Math.abs(horizontal) <= Math.abs(vertical) * 1.35) {
    return index
  }

  return Math.min(count - 1, Math.max(0, index + (horizontal < 0 ? 1 : -1)))
}

export function appointmentSwipeAction(start, end) {
  const horizontal = end.clientX - start.x
  const vertical = end.clientY - start.y
  if (Math.abs(horizontal) < 65 || Math.abs(horizontal) < Math.abs(vertical) * 1.25) {
    return null
  }
  return horizontal > 0 ? 'complete' : 'cancel'
}

export function historicalBarbers(activeBarbers, appointments) {
  const knownIds = new Set(activeBarbers.map((barber) => barber.id))
  const historical = []
  for (const { barber_id: id, barber_name: name } of appointments) {
    if (!id || !name || knownIds.has(id)) continue
    knownIds.add(id)
    historical.push({ id, name, active: false })
  }
  return historical
}
