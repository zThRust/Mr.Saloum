import { usePwaUpdate } from './pwaUpdate'

export default function PwaUpdateBanner() {
  const update = usePwaUpdate()
  if (!update.available) return null
  return (
    <aside className="pwa-update-banner" aria-label="Atualização do aplicativo">
      <span role="status">{update.requested ? 'Preparando atualização…' : update.busy
        ? 'Nova versão disponível. Conclua ou feche a operação para atualizar.'
        : 'Nova versão disponível.'}</span>
      <button type="button" disabled={update.busy || update.requested} onClick={update.apply}>Atualizar</button>
    </aside>
  )
}
