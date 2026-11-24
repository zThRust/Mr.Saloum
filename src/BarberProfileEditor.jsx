import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { barberProfileFailure, barberProfilePayload, editableBarberProfiles } from './barberProfile'

async function loadProfiles(profile) {
  try {
    const { data, error } = await supabase.rpc('mr_saloum_listar_perfis_editaveis_v1')
    return error ? [] : editableBarberProfiles(data, profile)
  } catch {
    return []
  }
}

export default function BarberProfileEditor({ profile, onChange, targetId, onClose }) {
  const { role, barber_id } = profile
  const [records, setRecords] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const showForm = Boolean(targetId) || open
  const record = targetId ? records.find(({ id }) => id === targetId) : records[0]

  useEffect(() => {
    let current = true
    loadProfiles({ role, barber_id }).then((profiles) => {
      if (current) {
        setRecords(profiles)
        setBusy(false)
      }
    })
    return () => { current = false }
  }, [role, barber_id])

  async function reload() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const profiles = await loadProfiles({ role, barber_id })
      setRecords(profiles)
      if (!profiles.length) setError('A edição de contato está indisponível para esta sessão.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    if (pending.current || !record) return
    const form = new FormData(event.currentTarget)
    const payload = barberProfilePayload(record, form.get('photo'), form.get('phone'))
    if (payload.error) {
      setError(payload.error)
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    let result
    try {
      result = await supabase.rpc('mr_saloum_atualizar_perfil_barbeiro_v1', payload)
    } catch {
      result = { error: {}, status: 0 }
    }
    try {
      if (result.error) {
        const failure = barberProfileFailure(result.error, result.status)
        if (failure.invalidate) setRecords([])
        setError(failure.message)
        return
      }
      const [profiles, refresh] = await Promise.allSettled([
        loadProfiles({ role, barber_id }), onChange()
      ])
      setRecords(profiles.status === 'fulfilled' ? profiles.value : [])
      setNotice(refresh.status === 'fulfilled' && refresh.value
        ? 'Contato atualizado.'
        : 'Contato atualizado. Recarregue o painel para atualizar a agenda.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  if (!record && !showForm) return busy ? <p role="status">Carregando contato…</p> : <p>Edição de contato indisponível para esta conta.</p>

  return (
    <section className="admin-catalog">
      <button type="button" aria-expanded={showForm} disabled={busy} onClick={targetId ? onClose : () => setOpen(!open)}>
        {showForm ? 'Fechar edição de contato' : 'Editar meu contato'}
      </button>
      {showForm && (
        <div className="admin-catalog-group admin-catalog-content" aria-busy={busy}>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {record ? (
            <>
              <form key={`${record.id}:${record.version}`} onSubmit={save}>
                <fieldset disabled={busy}>
                  <legend>Contato de {record.name}</legend>
                  <label>
                    URL HTTPS da foto
                    <input type="url" name="photo" defaultValue={record.photo_url ?? ''} />
                  </label>
                  <label>
                    Telefone de contato com DDD
                    <input type="tel" name="phone" defaultValue={record.whatsapp ?? ''} />
                  </label>
                  <button type="submit">Salvar contato</button>
                </fieldset>
              </form>
            </>
          ) : (
            <button type="button" onClick={reload} disabled={busy}>Recarregar contatos</button>
          )}
        </div>
      )}
    </section>
  )
}
