import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const fields = {
  barber: [
    { key: 'name', label: 'Nome', required: true },
    { key: 'photo_url', label: 'URL da foto', type: 'url' },
    { key: 'profile_id', label: 'UUID do perfil existente', required: true, createOnly: true,
      pattern: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' }
  ],
  service: [
    { key: 'name', label: 'Nome', required: true },
    { key: 'price', label: 'Preço (R$)', type: 'number', min: 0, step: '0.01', required: true },
    { key: 'slot_units', label: 'Unidades de 35 minutos', type: 'number', min: 0, step: '1', required: true },
    { key: 'icon', label: 'Ícone' },
    { key: 'description', label: 'Descrição' }
  ]
}

const actionLabels = {
  create: 'Cadastrar',
  update: 'Salvar alterações',
  deactivate: 'Desativar',
  reactivate: 'Reativar',
  delete: 'Excluir definitivamente'
}

const errorMessages = {
  'MS001': 'Há agendamentos futuros ou em andamento para este barbeiro. Resolva esses agendamentos antes de desativá-lo.',
  'MS002': 'Este registro é protegido ou tem dependências. A exclusão definitiva não é permitida.',
  'MS003': 'O perfil informado não está apto para vinculação. Confira a conta e os vínculos existentes.',
  'MS004': 'Este cadastro mudou desde a consulta. Recarregue o catálogo antes de continuar.',
  '42501': 'Sua conta não possui autorização para gerenciar este cadastro.',
  '22023': 'Os dados enviados são inválidos. Revise o cadastro antes de salvar.'
}

export default function CatalogManagement({ onChange }) {
  const [authorized, setAuthorized] = useState(false)
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState(null)
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    async function checkCapability() {
      try {
        const { data, error } = await supabase.rpc('mr_saloum_pode_gerenciar_catalogo_v1')
        if (current) setAuthorized(!error && data === true)
      } catch {
        if (current) setAuthorized(false)
      }
    }
    checkCapability()
    return () => { current = false }
  }, [])

  async function loadCatalog() {
    try {
      const { data, error, status } = await supabase.rpc('mr_saloum_listar_catalogo_v1')
      if (error?.code === '42501' || status === 401 || status === 403) {
        setAuthorized(false)
        requireReload(errorMessages['42501'])
        return
      }
      if (!error && [data?.barbers, data?.services].every((records) =>
        Array.isArray(records) && records.every((record) =>
          typeof record?.id === 'string' && typeof record.version === 'string' && record.version.length > 0
        )
      )) {
        setCatalog(data)
        return
      }
    } catch {
      // Uma falha de transporte também mantém as ações indisponíveis.
    }
    setCatalog(null)
    setError('Não foi possível carregar o catálogo de gerenciamento.')
  }

  async function reloadCatalog(refreshDashboard = false) {
    setCatalog(null)
    setEditor(null)
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (refreshDashboard) {
        const [, refresh] = await Promise.allSettled([loadCatalog(), onChange()])
        if (refresh.status !== 'fulfilled' || !refresh.value) {
          setNotice('Recarregue o painel para atualizar a agenda e o agendamento manual.')
        }
      } else {
        await loadCatalog()
      }
    } finally {
      setBusy(false)
    }
  }

  function toggleCatalog() {
    setOpen(!open)
    if (!open) reloadCatalog()
  }

  function requireReload(message) {
    setCatalog(null)
    setEditor(null)
    setError(message)
  }

  async function mutate(kind, action, record, values = null) {
    if (busy || !authorized || !catalog) return
    if (action !== 'create' && (!record?.id || !record.version)) {
      requireReload(errorMessages.MS004)
      return
    }
    if (action === 'delete' && !window.confirm(`Excluir definitivamente “${record.name}”? Esta ação é irreversível.`)) return

    const unknownOutcome = 'Não foi possível confirmar a operação. Recarregue o catálogo e confira se ela foi aplicada antes de tentar novamente.'
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error, status } = await supabase.rpc('mr_saloum_alterar_catalogo_v1', {
        p_kind: kind,
        p_action: action,
        p_id: record?.id ?? null,
        p_expected_version: record?.version ?? null,
        p_values: values
      })
      if (error) {
        if (error.code === '42501' || status === 401 || status === 403) {
          setAuthorized(false)
          requireReload(errorMessages['42501'])
        } else if (error.code === 'MS004') requireReload(errorMessages.MS004)
        else if (errorMessages[error.code]) setError(errorMessages[error.code])
        else if (!status || status >= 500 || status === 408) requireReload(unknownOutcome)
        else setError('Não foi possível concluir a operação.')
        return
      }
      setEditor(null)
      setNotice('Alteração salva.')
      const [, refresh] = await Promise.allSettled([loadCatalog(), onChange()])
      if (refresh.status !== 'fulfilled' || !refresh.value) {
        setNotice('Alteração salva. Recarregue o painel para atualizar a agenda e o agendamento manual.')
      }
    } catch {
      requireReload(unknownOutcome)
    } finally {
      setBusy(false)
    }
  }

  function startEditor(kind, record = null) {
    setError('')
    setNotice('')
    setEditor({ kind, record })
  }

  function saveEditor(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const { kind, record } = editor
    const values = Object.fromEntries(
      fields[kind].filter(({ createOnly }) => !record || !createOnly).map(({ key, type }) => {
        const value = form.get(key).trim()
        return [key, type === 'number' ? Number(value) : value || null]
      })
    )
    if (!values.name) {
      setError('Informe um nome válido.')
      return
    }
    mutate(kind, record ? 'update' : 'create', record, values)
  }

  if (!authorized) return error ? <p role="alert">{error}</p> : null

  return (
    <section className="admin-catalog">
      <button type="button" aria-expanded={open} disabled={busy} onClick={toggleCatalog}>
        {open ? 'Fechar gerenciamento' : 'Gerenciar barbeiros e serviços'}
      </button>
      {open && (
        <div className="admin-catalog-content" aria-busy={busy}>
          {busy && <p role="status">Aguarde…</p>}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {!catalog && !busy && (
            <button type="button" onClick={() => reloadCatalog(true)}>Recarregar catálogo</button>
          )}
          {catalog && (
            <p>Desativar impede novos agendamentos e preserva o cadastro e seu histórico. Excluir definitivamente remove o cadastro quando o banco permite.</p>
          )}
          {catalog && ['barber', 'service'].map((kind) => {
            const isBarber = kind === 'barber'
            const records = isBarber ? catalog.barbers : catalog.services
            return (
              <div key={kind} className="admin-catalog-group">
                <h2>{isBarber ? 'Barbeiros' : 'Serviços'}</h2>
                <button type="button" disabled={busy} onClick={() => startEditor(kind)}>
                  {isBarber ? 'Cadastrar barbeiro' : 'Cadastrar serviço'}
                </button>
                {editor?.kind === kind && (
                  <form key={editor.record?.id ?? 'new'} onSubmit={saveEditor}>
                    <fieldset disabled={busy}>
                      <legend>{editor.record ? `Editar ${editor.record.name}` : isBarber ? 'Novo barbeiro' : 'Novo serviço'}</legend>
                      {isBarber && !editor.record && <p>Use o UUID de um perfil já criado pelo fluxo de autenticação da barbearia.</p>}
                      {fields[kind].filter(({ createOnly }) => !editor.record || !createOnly).map(({ key, label, createOnly: _createOnly, ...constraints }) => (
                        <label key={key}>
                          {label}
                          <input {...constraints} name={key} defaultValue={editor.record?.[key] ?? ''} />
                        </label>
                      ))}
                      <button type="submit">{actionLabels[editor.record ? 'update' : 'create']}</button>
                      <button type="button" onClick={() => setEditor(null)}>Cancelar edição</button>
                    </fieldset>
                  </form>
                )}
                {records.length === 0 && <p>Nenhum cadastro.</p>}
                {records.length > 0 && (
                  <ul>
                    {records.map((record) => (
                      <li key={record.id}>
                        <strong>{record.name}</strong>
                        <span>{record.active ? 'Ativo' : 'Inativo'}</span>
                        <div className="admin-catalog-actions">
                          <button type="button" disabled={busy} onClick={() => startEditor(kind, record)}>Editar</button>
                          <button type="button" disabled={busy} onClick={() => mutate(kind, record.active ? 'deactivate' : 'reactivate', record)}>
                            {actionLabels[record.active ? 'deactivate' : 'reactivate']}
                          </button>
                          {record.can_delete === true && (
                            <button type="button" disabled={busy} onClick={() => mutate(kind, 'delete', record)}>{actionLabels.delete}</button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
