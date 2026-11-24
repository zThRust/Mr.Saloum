const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function editableBarberProfiles(data, { role, barber_id: ownId }) {
  if (!Array.isArray(data) || (role !== 'admin' && role !== 'barber')) return []
  const seen = new Set()
  for (const record of data) {
    if (!record || typeof record.id !== 'string' || !uuid.test(record.id) || seen.has(record.id) ||
        typeof record.name !== 'string' || typeof record.active !== 'boolean' ||
        typeof record.version !== 'string' || !record.version.trim() ||
        (record.photo_url !== null && typeof record.photo_url !== 'string') ||
        (record.whatsapp !== null && typeof record.whatsapp !== 'string') ||
        (role === 'barber' && record.id !== ownId)) return []
    seen.add(record.id)
  }
  return data
}

export function barberProfilePayload(record, photoInput, phoneInput) {
  const photo = photoInput.trim()
  if (photo) {
    try {
      const url = new URL(photo)
      if (!/^https:\/\//i.test(photo) || url.protocol !== 'https:' || url.username || url.password) {
        return { error: 'Informe uma URL HTTPS de foto sem credenciais.' }
      }
    } catch {
      return { error: 'Informe uma URL HTTPS válida para a foto.' }
    }
  }

  const phone = phoneInput.trim()
  const digits = phone.replace(/\D/g, '')
  if (phone && (!/^\+?[0-9 ().-]+$/.test(phone) ||
      !/^(?:55)?[1-9]\d{9,10}$/.test(digits) ||
      (phone.startsWith('+') && !/^55[1-9]\d{9,10}$/.test(digits)))) {
    return { error: 'Informe um telefone brasileiro com DDD, com ou sem +55.' }
  }

  return {
    p_barber_id: record.id,
    p_expected_version: record.version,
    p_photo_url: photo || null,
    p_whatsapp: digits || null
  }
}

export function barberProfileFailure(error, status) {
  if (error.code === '42501' || status === 401 || status === 403) {
    return { invalidate: true, message: 'Sua conta não tem autorização para editar este contato.' }
  }
  switch (error.code) {
    case 'MS004':
      return { invalidate: true, message: 'Este perfil mudou ou foi removido. Recarregue os contatos antes de continuar.' }
    case '22023':
      return { invalidate: false, message: 'Os dados do contato são inválidos. Revise a foto e o telefone.' }
    default:
      if (!status || status >= 500 || status === 408) {
        return { invalidate: true, message: 'Não foi possível confirmar a alteração. Recarregue e confira os dados antes de tentar novamente.' }
      }
      return { invalidate: false, message: 'Não foi possível salvar o contato.' }
  }
}
