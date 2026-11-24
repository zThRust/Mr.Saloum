import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { calcularDuracaoSlots, SERVICE_SOBRANCELHA_ID } from './bookingValues'
import BarberPhotoField from './BarberPhotoField'
import { resolvePhotoDraft } from './barberPhotoStorage'
import { holdUpdate, useUpdateBlock } from './pwaUpdate'

const fields = {
  barber: [
    { key: 'name', label: 'Nome', required: true },
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

export default function CatalogManagement({ kind, onChange, onDenied, canEditContact, onEditContact }) {
  const [catalog, setCatalog] = useState(null)
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [photoDraft, setPhotoDraft] = useState(null)
  const pending = useRef(false)
  useUpdateBlock(Boolean(editor))

  const loadCatalog = useCallback(async () => {
    try {
      const { data, error, status } = await supabase.rpc('mr_saloum_listar_catalogo_v1')
      if (error?.code === '42501' || status === 401 || status === 403) {
        onDenied(errorMessages['42501'])
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
  }, [onDenied])

  useEffect(() => {
    Promise.resolve().then(loadCatalog).finally(() => setBusy(false))
  }, [loadCatalog])

  async function reloadCatalog(refreshDashboard = false) {
    setCatalog(null)
    setEditor(null)
    setPhotoDraft(null)
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

  function requireReload(message) {
    setCatalog(null)
    setEditor(null)
    setPhotoDraft(null)
    setError(message)
  }

  async function mutate(kind, action, record, values = null, photo = null) {
    if (busy || pending.current || !catalog || photo?.kind === 'pending') return
    if (action !== 'create' && (!record?.id || !record.version)) {
      requireReload(errorMessages.MS004)
      return
    }
    if (action === 'delete' && !window.confirm(`Excluir definitivamente “${record.name}”? Esta ação é irreversível.`)) return

    const unknownOutcome = 'Não foi possível confirmar a operação. Recarregue o catálogo e confira se ela foi aplicada antes de tentar novamente.'
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const releaseUpdate = holdUpdate()
    function reportFailure(error, status) {
      if (error.code === '42501' || status === 401 || status === 403) onDenied(errorMessages['42501'])
      else if (error.code === 'MS004') requireReload(errorMessages.MS004)
      else if (error.code === 'MS002' && action === 'deactivate') {
        setError('O banco protege este cadastro contra desativação.')
      }
      else if (errorMessages[error.code]) setError(errorMessages[error.code])
      else if (!status || status >= 500 || status === 408) requireReload(unknownOutcome)
      else setError('Não foi possível concluir a operação.')
    }
    let created = false
    try {
      if (kind === 'barber' && action === 'create' && photo?.kind === 'upload') {
        const { data, error, status } = await supabase.rpc('mr_saloum_criar_barbeiro_para_foto_v1', { p_values: values })
        if (error) { reportFailure(error, status); return }
        created = true
        if (!data?.id || !data?.version) {
          requireReload('Barbeiro cadastrado. Recarregue o catálogo e envie a foto pelo registro criado.')
          return
        }
        record = { ...data, name: values.name }
        action = 'update'
        values = { name: record.name }
      }
      if (kind === 'barber' && values) {
        try { values.photo_url = await resolvePhotoDraft(photo, record) }
        catch (error) {
          if (!created) { setError(error.message); return }
          setEditor(null)
          setPhotoDraft(null)
          setNotice('Barbeiro cadastrado. Retome o envio da foto pelo registro criado.')
          await Promise.allSettled([loadCatalog(), onChange()])
          return
        }
      }
      const { error, status } = await supabase.rpc('mr_saloum_alterar_catalogo_v1', {
        p_kind: kind,
        p_action: action,
        p_id: record?.id ?? null,
        p_expected_version: record?.version ?? null,
        p_values: values
      })
      if (error) {
        if (created) requireReload('Barbeiro cadastrado. Recarregue o catálogo, confira a foto atual e retome pelo registro criado.')
        else reportFailure(error, status)
        return
      }
      setEditor(null)
      setPhotoDraft(null)
      setNotice('Alteração salva.')
      const [, refresh] = await Promise.allSettled([loadCatalog(), onChange()])
      if (refresh.status !== 'fulfilled' || !refresh.value) {
        setNotice('Alteração salva. Recarregue o painel para atualizar a agenda e o agendamento manual.')
      }
    } catch {
      requireReload(created ? 'Barbeiro cadastrado. Recarregue o catálogo e confira a foto antes de tentar novamente.' : unknownOutcome)
    } finally {
      pending.current = false
      setBusy(false)
      releaseUpdate()
    }
  }

  function startEditor(kind, record = null) {
    setError('')
    setNotice('')
    setPhotoDraft(null)
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
    mutate(kind, record ? 'update' : 'create', record, values, photoDraft)
  }

  const isBarber = kind === 'barber'
  const list = isBarber ? catalog?.barbers : catalog?.services
  const records = list && [...list].sort((a, b) => Number(b.active) - Number(a.active))

  return (
    <section className="admin-catalog">
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
          {records && (
              <div key={kind} className="admin-catalog-group">
                <button type="button" className="admin-primary-button" disabled={busy} onClick={() => startEditor(kind)}>
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
                      {isBarber && <BarberPhotoField barberId={editor.record?.id} existing={editor.record?.photo_url} draft={photoDraft} onChange={setPhotoDraft} />}
                      <button type="submit" disabled={photoDraft?.kind === 'pending'}>{actionLabels[editor.record ? 'update' : 'create']}</button>
                      <button type="button" onClick={() => setEditor(null)}>Cancelar edição</button>
                    </fieldset>
                  </form>
                )}
                {records.length === 0 && <p>Nenhum cadastro.</p>}
                {records.length > 0 && (
                  <ul>
                    {records.map((record, index) => (
                      <Fragment key={record.id}>
                      {record.active !== records[index - 1]?.active && (
                        <li className="admin-catalog-divider"><h3>{record.active ? 'Ativos' : 'Inativos'}</h3></li>
                      )}
                      <li>
                        <div className="admin-record-identity">
                          {isBarber && (record.photo_url ? <img src={record.photo_url} alt="" /> : <span className="admin-record-avatar" aria-hidden="true">{record.name.charAt(0)}</span>)}
                          <div>
                            <strong>{record.name}</strong>
                            {!isBarber && (
                              <small>{Number(record.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · {calcularDuracaoSlots([record]) * 35} min{record.id === SERVICE_SOBRANCELHA_ID ? ' avulsa' : ''}</small>
                            )}
                          </div>
                          <span className="admin-record-status" data-active={record.active}>{record.active ? 'Ativo' : 'Inativo'}</span>
                        </div>
                        <div className="admin-catalog-actions">
                          <button type="button" disabled={busy} onClick={() => startEditor(kind, record)}>Editar</button>
                          {isBarber && canEditContact?.(record.id) && (
                            <button type="button" disabled={busy} onClick={() => onEditContact(record.id)}>Foto e contato</button>
                          )}
                          {(!record.active || record.can_deactivate !== false) && (
                            <button type="button" disabled={busy} onClick={() => mutate(kind, record.active ? 'deactivate' : 'reactivate', record)}>
                              {actionLabels[record.active ? 'deactivate' : 'reactivate']}
                            </button>
                          )}
                          {record.active && record.can_deactivate === false && (
                            <small>Desativação indisponível enquanto houver agendamentos futuros ou em andamento.</small>
                          )}
                          {record.can_delete === true && (
                            <button type="button" disabled={busy} onClick={() => mutate(kind, 'delete', record)}>{actionLabels.delete}</button>
                          )}
                        </div>
                      </li>
                      </Fragment>
                    ))}
                  </ul>
                )}
              </div>
          )}
        </div>
    </section>
  )
}
