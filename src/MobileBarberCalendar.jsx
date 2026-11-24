import { useRef } from 'react'
import { barberSwipeDestination, barberSwipeStart, selectedBarberIndex } from './barberCalendarNavigation'

export default function MobileBarberCalendar({ enabled, barbers, selectedId, setSelectedId, renderBarber }) {
  const touchStart = useRef(null)
  const index = selectedBarberIndex(barbers, selectedId)
  const selected = barbers[index]

  function startSwipe(event) {
    const touch = barberSwipeStart(event)
    touchStart.current = touch && { touch, barberId: selected?.id }
  }

  function endSwipe(event) {
    const start = touchStart.current
    touchStart.current = null
    if (event.touches.length || start?.barberId !== selected?.id) return

    const destination = barberSwipeDestination(start?.touch, event.changedTouches[0], index, barbers.length)
    if (destination !== index) setSelectedId(barbers[destination].id)
  }

  return (
    <div className={enabled ? 'admin-calendar-overview' : undefined}>
      {enabled && selected && (
        <div
          className="admin-calendar-mobile-nav"
          onTouchStart={startSwipe}
          onTouchEnd={endSwipe}
          onTouchCancel={() => { touchStart.current = null }}
        >
          <div className="admin-calendar-mobile-identity" aria-live="polite">
            {selected.photo_url ? (
              <img key={selected.id} src={selected.photo_url} alt="" draggable={false} />
            ) : (
              <span aria-hidden="true">{selected.name.charAt(0).toUpperCase()}</span>
            )}
            <strong>{selected.name}</strong>
          </div>
          <select
            aria-label="Selecionar barbeiro no calendário"
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}
          </select>
          {barbers.length > 1 && (
            <div className="admin-calendar-mobile-dots" role="group" aria-label="Agendas dos barbeiros">
              {barbers.map((barber) => (
                <button
                  key={barber.id}
                  type="button"
                  aria-label={barber.name}
                  aria-pressed={barber.id === selected.id}
                  onClick={() => setSelectedId(barber.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <div
        className="admin-calendar-columns"
        onTouchStart={enabled ? startSwipe : undefined}
        onTouchEnd={enabled ? endSwipe : undefined}
        onTouchCancel={enabled ? () => { touchStart.current = null } : undefined}
      >
        {barbers.map((barber) => (
          <section
            key={barber.id}
            className="admin-calendar-barber"
            data-mobile-selected={barber.id === selected?.id}
          >
            {renderBarber(barber)}
          </section>
        ))}
      </div>
    </div>
  )
}
