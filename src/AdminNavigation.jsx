import BrandLogo from './BrandLogo'

const icons = {
  agenda: 'M3 6h18v15H3z M7 3v6m10-6v6M3 11h18',
  equipe: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4m-6-6a4 4 0 1 1-8 0 4 4 0 0 1 8 0m4-4a4 4 0 0 1 0 8',
  servicos: 'M4 7h16M4 12h16M4 17h16M4 4v16m16-16v16',
  financeiro: 'M3 3v18h18M8 16v-4m5 4V8m5 8V5',
  configuracoes: 'M4 7h16M4 17h16m-11-7V4m6 16v-6'
}

export default function AdminNavigation({ name, role, sections, active, onSelect, onLogout }) {
  return (
    <header className="admin-shell-header">
      <div className="admin-shell-top">
        <BrandLogo className="admin-shell-brand" />
        <div className="admin-shell-account"><strong>{name}</strong><span>{role}</span></div>
        <button type="button" onClick={onLogout} aria-label="Sair da conta">Sair</button>
      </div>
      <nav className="admin-shell-nav" aria-label="Seções do painel">
        {sections.map(({ id, label }) => (
          <button key={id} type="button" aria-current={active === id ? 'page' : undefined} onClick={() => onSelect(id)}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={icons[id]} />
            </svg>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </header>
  )
}
