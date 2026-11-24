export function adminSections({ role, catalog, editableProfiles }) {
  const sections = [{ id: 'agenda', label: 'Agenda' }]
  if (role === 'admin' && (catalog || editableProfiles.length)) sections.push({ id: 'equipe', label: 'Equipe' })
  if (role === 'admin' && catalog) sections.push({ id: 'servicos', label: 'Serviços' })
  sections.push({ id: 'financeiro', label: 'Financeiro' }, { id: 'configuracoes', label: 'Configurações' })
  return sections
}
