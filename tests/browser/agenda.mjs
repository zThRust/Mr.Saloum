// Use Vite em 127.0.0.1:5179 com Supabase fictício em 127.0.0.1:59887
// e um Chromium de teste com a porta CDP 9436. Nenhuma RPC sai do mock.
import assert from 'node:assert/strict'

const origin = 'http://127.0.0.1:5179'
const debuggerOrigin = 'http://127.0.0.1:9436'
const page = await (await fetch(debuggerOrigin + '/json/new?about:blank', {
  method: 'PUT', signal: AbortSignal.timeout(3000)
})).json()
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Tempo limite ao conectar ao CDP')), 3000)
  socket.onopen = () => { clearTimeout(timeout); resolve() }
  socket.onerror = () => { clearTimeout(timeout); reject(new Error('Falha ao conectar ao CDP')) }
})
const pending = new Map()
let sequence = 0
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  pending.get(message.id)?.(message)
}

async function cdp(method, params = {}) {
  const id = ++sequence
  let timeout
  try {
    const response = await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Tempo limite de ${method}`)), 5000)
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
    if (response.error) throw new Error(JSON.stringify(response.error))
    return response.result
  } finally {
    clearTimeout(timeout)
    pending.delete(id)
  }
}

async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
  return response.result.value
}

async function until(expression) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate(expression)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const screen = await evaluate('document.body.innerText.slice(0, 500)')
  const calls = await evaluate('window.testCalls?.map(({ name }) => name).join(", ")')
  throw new Error(`Condição não atingida: ${expression}\n${screen}\nChamadas simuladas: ${calls}`)
}

function installMock() {
  if (location.origin !== 'http://127.0.0.1:5179') return
  const barber = (id, name) => ({ id, name, active: true })
  const user = { id: '00000000-0000-4000-8000-000000000001', role: 'authenticated', is_anonymous: false }
  const barbers = [barber(user.id, 'Aline'), barber('b', 'Bruno'), barber('c', 'Caio'), barber('d', 'Deise')]
  const contact = { ...barbers[0], photo_url: 'https://example.test/foto-legada.png', whatsapp: null, version: 'fixture-v1' }
  const service = { id: 's', name: 'Corte simulado', price: 30, slot_units: 1, active: true }
  const historical = {
    id: '00000000-0000-4000-8000-000000000009',
    name: 'Eva', active: false, photo_url: null, whatsapp: null, version: 'fixture-history', can_delete: false
  }
  const master = location.search === '?master'
  const expires = Math.floor(Date.now() / 1000) + 3600
  const jwt = [{ alg: 'HS256' }, { sub: user.id, role: user.role, exp: expires }]
    .map((value) => btoa(JSON.stringify(value)).replace(/=/g, '')).join('.') + '.c2ln'
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
  const appointment = (id, barberId, barberName) => ({
    id, barber_id: barberId, barber_name: barberName, customer_name: 'Cliente de teste',
    starts_at: day + 'T06:00:00-03:00', ends_at: day + 'T06:35:00-03:00', status: 'confirmed', items: []
  })
  window.testCalls = []
  window.confirm = () => true
  window.revisePublicCatalog = () => {
    barbers[0].name = 'Aline atualizada'
    Object.assign(service, { name: 'Corte atualizado', price: 48, slot_units: 2 })
  }
  window.deactivatePublicBarber = () => { barbers[0].active = false }
  let completed = false
  const fetchLocal = window.fetch.bind(window)
  window.fetch = async (input, options) => {
    const request = new Request(input, options)
    const url = new URL(request.url)
    if (url.origin === location.origin) return fetchLocal(request)
    if (url.origin !== 'http://127.0.0.1:59887') throw new Error('Origem fora do mock')
    if (url.pathname === '/functions/v1/barber-photo-upload') {
      const path = request.headers.get('x-barber-id') + '/' + crypto.randomUUID() + '.webp'
      const blob = new Blob([await request.arrayBuffer()], { type: 'image/webp' })
      const bitmap = await createImageBitmap(blob)
      window.testCalls.push({ name: 'upload-photo', path, size: blob.size, type: blob.type,
        width: bitmap.width, height: bitmap.height, upsert: request.headers.get('x-upsert') })
      bitmap.close()
      if ((!master && !path.startsWith(user.id + '/')) || window.rejectPhotoUpload) {
        return Response.json({ message: 'Upload bloqueado. A foto atual foi preservada.' }, { status: 403 })
      }
      return Response.json({ public_url: url.origin + '/storage/v1/object/public/barber-photos/' + path })
    }
    if (url.pathname.startsWith('/storage/v1/object/barber-photos/')) throw new Error('Upload direto proibido')
    const name = url.pathname.split('/').at(-1)
    const body = request.method === 'POST' ? await request.json() : null
    const projection = url.searchParams.get('select')?.split(',').sort().join(',')
    window.testCalls.push({ name, body, projection })
    if (name === 'barbers' && !['active,id,name,photo_url', 'id,name,photo_url'].includes(projection)) {
      return Response.json({ code: '42501', message: 'Projeção não permitida no teste' }, { status: 403 })
    }
    if (name === 'admin_marcar_atendimento') completed = body.p_realizado
    const session = { user, access_token: jwt, refresh_token: 'fixture', expires_at: expires, expires_in: 3600, token_type: 'bearer' }
    const response = {
      profiles: { name: 'Teste', role: location.search === '?barber' ? 'barber' : 'admin', barber_id: user.id },
      user,
      token: session,
      signup: { ...session, user: { ...user, is_anonymous: true, user_metadata: body?.data ?? {} } },
      barbers: barbers.filter(({ active }) => active),
      services: service.active ? [service] : [],
      painel_agendamentos: [appointment('local-active', user.id, 'Aline'), appointment('local-history', historical.id, 'Eva')],
      painel_atendimentos: completed ? [{ appointment_id: 'local-active', completed_at: day + 'T07:00:00-03:00' }] : [],
      painel_financeiro: [
        { barber_id: historical.id, barber_name: 'Eva', total_dia: 42, total_semana: 132 },
        { barber_id: user.id, barber_name: 'Aline', total_dia: 60, total_semana: 180 }
      ],
      consultar_disponibilidade: ['05:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00']
        .map((horario) => ({ horario, disponivel: true })),
      mr_saloum_pode_gerenciar_catalogo_v1: master,
      mr_saloum_pode_editar_foto_v1: master || (location.search === '?barber' && body?.p_barber_id === user.id),
      mr_saloum_listar_catalogo_v1: {
        barbers: [...barbers.map((item) => ({ ...item, version: 'fixture-v1', can_delete: item.id === 'b' })), historical],
        services: [{ ...service, version: 'fixture-service', can_delete: false }]
      },
      mr_saloum_listar_perfis_editaveis_v1: master || location.search === '?admin-contact'
        ? [contact, historical] : location.search === '?barber' ? [contact] : []
    }
    if (location.search === '?admin-contact' && name === 'mr_saloum_pode_editar_foto_v1') {
      return Response.json({ code: 'PGRST202', message: 'RPC ainda não instalada' }, { status: 404 })
    }
    if (name === 'mr_saloum_atualizar_perfil_barbeiro_v1') {
      if (!window.allowProfileSave) return Response.json({ code: 'MS004', message: 'Fixture vencida' }, { status: 400 })
      if (body.p_barber_id !== contact.id || body.p_expected_version !== contact.version) {
        return Response.json({ code: '42501', message: 'Alvo inválido no teste' }, { status: 403 })
      }
      Object.assign(contact, { photo_url: body.p_photo_url, whatsapp: body.p_whatsapp, version: 'fixture-profile-v2' })
      barbers[0].photo_url = body.p_photo_url
      if (window.uncertainPhotoSave) return Response.json({ message: 'Resposta perdida' }, { status: 503 })
    }
    if (name === 'mr_saloum_criar_barbeiro_para_foto_v1') {
      const id = '00000000-0000-4000-8000-000000000008'
      barbers.push(barber(id, body.p_values.name))
      return Response.json({ id, version: 'fixture-v1' })
    }
    if (name === 'mr_saloum_alterar_catalogo_v1') {
      if (window.catalogError) {
        const code = window.catalogError
        window.catalogError = ''
        return Response.json({ code, message: 'Fixture de erro' }, { status: code === '42501' ? 403 : 400 })
      }
      const target = barbers.find(({ id }) => id === body.p_id)
      if (body.p_action === 'create' && body.p_kind === 'barber') {
        barbers.push(barber('00000000-0000-4000-8000-000000000006', body.p_values.name))
        if (window.uncertainCreate) return Response.json({ message: 'Resposta perdida' }, { status: 503 })
      } else if (target && body.p_action === 'delete') barbers.splice(barbers.indexOf(target), 1)
      else if (target && body.p_action === 'deactivate') target.active = false
      else if (target && body.p_action === 'update') Object.assign(target, body.p_values)
      else if (body.p_kind === 'service' && body.p_id === service.id && body.p_action === 'update') {
        Object.assign(service, body.p_values)
      }
      else return Response.json({ code: '22023', message: 'Fixture inválida' }, { status: 400 })
    }
    return Response.json(response[name] ?? [])
  }
  window.testSwipe = (element, dx, dy, pointer = false) => {
    const start = { identifier: 1, clientX: 150, clientY: 100 }
    const end = { identifier: 1, clientX: 150 + dx, clientY: 100 + dy }
    for (const [type, touches, point] of [['touchstart', [start], start], ['touchend', [], end]]) {
      if (pointer) {
        element.dispatchEvent(new PointerEvent(touches.length ? 'pointerdown' : 'pointerup', {
          bubbles: true, clientX: point.clientX, clientY: point.clientY, pointerType: 'touch', pointerId: 1
        }))
      }
      const event = new Event(type, { bubbles: true })
      element.dispatchEvent(Object.assign(event, { touches, changedTouches: [point] }))
    }
  }
}

const countVisible = '[...document.querySelectorAll(".admin-calendar-barber")].filter(e => e.getClientRects().length).length'
const select = 'document.querySelector(".admin-calendar-mobile-nav select")'
const dateField = 'document.querySelector("input[type=date]")'
const identity = 'document.querySelector(".admin-calendar-mobile-identity")'
const booked = 'document.querySelector(".admin-calendar-event.is-booked")'
const slot = 'document.querySelector(".admin-calendar-event.is-past, .admin-calendar-event.is-free")'
const swipe = (element, dx, dy, pointer = false) => evaluate(`testSwipe(${element}, ${dx}, ${dy}, ${pointer})`)
const clickButton = (label) => evaluate(`[...document.querySelectorAll("button")].find(
  button => button.textContent === ${JSON.stringify(label)}
).click()`)
const viewport = (width, mobile) => cdp('Emulation.setDeviceMetricsOverride', {
  width, height: 844, deviceScaleFactor: 1, mobile
})
const pickPhoto = (kind = 'valid') => evaluate(`(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 720
  canvas.height = 560
  const context = canvas.getContext('2d')
  context.fillStyle = '#98583a'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const kind = ${JSON.stringify(kind)}
  const file = kind === 'valid' ? new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], 'foto.png', { type: 'image/png' })
    : kind === 'large' ? new File([new Uint8Array(10485761)], 'grande.png', { type: 'image/png' })
    : new File(['<svg></svg>'], 'falsa.png', { type: 'image/png' })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  const field = document.querySelector('.admin-photo-field input[type=file]')
  field.files = transfer.files
  field.dispatchEvent(new Event('change', { bubbles: true }))
})()`)
const photoReady = () => until('document.querySelector(".admin-photo-field img")?.getAttribute("src")?.startsWith("blob:")')
const navLabels = '[...document.querySelectorAll(".admin-shell-nav button")].map(button => button.textContent.trim())'
async function openSection(label, id) {
  await evaluate(`[...document.querySelectorAll('.admin-shell-nav button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`)
  await until(`document.querySelector('[data-admin-section]')?.dataset.adminSection === "${id}"`)
  assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-admin-section]")].map(node => node.dataset.adminSection)'), [id])
}

async function login(path) {
  await cdp('Page.navigate', { url: origin + path })
  await until('!!document.querySelector("#admin-email")')
  await evaluate(`window.testCalls ??= ((${installMock.toString()})(), window.testCalls)`)
  assert.equal(await evaluate('Array.isArray(window.testCalls)'), true)
  await evaluate(`{
    const email = document.querySelector('#admin-email')
    const password = document.querySelector('#admin-password')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setValue.call(email, 'fixture@example.test')
    email.dispatchEvent(new Event('input', { bubbles: true }))
    setValue.call(password, 'fixture-password')
    password.dispatchEvent(new Event('input', { bubbles: true }))
  }`)
  await evaluate('document.querySelector("#admin-email").form.requestSubmit()')
}

try {
  await cdp('Page.enable')
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(${installMock.toString()})()` })
  await viewport(390, true)
  await login('/admin')
  await until(`!!${booked} && !!${slot}`)
  assert.equal(await evaluate('document.querySelector("[data-admin-section]").dataset.adminSection'), 'agenda')
  await until('testCalls.some(call => call.name === "mr_saloum_pode_gerenciar_catalogo_v1")')
  assert.deepEqual(await evaluate(navLabels), ['Agenda', 'Financeiro', 'Configurações'])
  assert.equal(await evaluate('testCalls.some(call => call.name === "mr_saloum_listar_catalogo_v1")'), false)
  await evaluate('document.querySelector(\'[aria-label="Criar agendamento presencial"]\').click()')
  await until('document.activeElement?.getAttribute("role") === "dialog"')
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))')
  await until('!document.querySelector(\'[role="dialog"]\')')
  assert.equal(await evaluate(countVisible), 1)
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".admin-calendar-step")).backgroundColor'), 'rgb(255, 255, 255)')
  assert.equal(await evaluate(`{
    const past = document.querySelector('.admin-calendar-event.is-past')
    const action = past?.querySelector('.admin-calendar-add-past-button')
    !action || action.getBoundingClientRect().top >= past.querySelector('.admin-calendar-event-info').getBoundingClientRect().bottom
  }`), true)

  await swipe(slot, -100, 0)
  await swipe(booked, 100, 0, true)
  await until('testCalls.some(call => call.name === "admin_marcar_atendimento" && call.body.p_realizado)')
  await until(`${booked}.matches(".is-completed:not(.is-action-loading)")`)
  await swipe(booked, 100, 0, true)
  await until('testCalls.some(call => call.name === "admin_marcar_atendimento" && !call.body.p_realizado)')
  await until(`${booked}.matches(":not(.is-completed):not(.is-action-loading)")`)
  await swipe(booked, -100, 0, true)
  await until('testCalls.some(call => call.name === "admin_cancelar_agendamento")')
  assert.equal(await evaluate(`${select}.selectedOptions[0].text`), 'Aline')
  assert.equal(await evaluate('testCalls.some(call => call.name === "consultar_disponibilidade" && call.body.p_barber_id.endsWith("0009"))'), false)
  const originalDate = await evaluate(`${dateField}.value`)
  await evaluate('document.querySelector(\'[aria-label="Próximo dia"]\').click()')
  await until(`${dateField}.value !== ${JSON.stringify(originalDate)}`)
  const otherDate = await evaluate(`${dateField}.value`)
  for (const id of ['b', 'c', 'd']) {
    await swipe(identity, -100, 2)
    await until(`${select}.value === "${id}"`)
    assert.equal(await evaluate(`${dateField}.value`), otherDate)
  }
  await swipe(identity, 50, 130)
  assert.equal(await evaluate(`${select}.value`), 'd')
  await evaluate(`{
    const first = { identifier: 1, clientX: 150, clientY: 100 }
    const second = { identifier: 2, clientX: 170, clientY: 100 }
    const end = { ...first, clientX: 250 }
    ${identity}.dispatchEvent(Object.assign(new Event("touchstart", { bubbles: true }), {
      touches: [first, second], changedTouches: [first, second]
    }))
    ${identity}.dispatchEvent(Object.assign(new Event("touchend", { bubbles: true }), {
      touches: [], changedTouches: [end]
    }))
  }`)
  assert.equal(await evaluate(`${select}.value`), 'd')
  for (const width of [360, 390, 412]) {
    await viewport(width, true)
    await until(`innerWidth === ${width} && ${countVisible} === 1`)
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Largura ${width}`)
  }
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  const scrollStart = await evaluate(`{
    ${identity}.scrollIntoView({ block: 'center', behavior: 'instant' })
    const rect = ${identity}.getBoundingClientRect()
    const point = { x: Math.round(rect.left + 30), y: Math.round(rect.top + rect.height / 2), top: scrollY }
    point
  }`)
  const { x, y, top } = scrollStart
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (const offset of [25, 60, 100, 150]) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - offset }] })
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await until(`scrollY > ${top}`)
  assert.equal(await evaluate(`${select}.value`), 'd')
  await evaluate(`${select}.value = "b"; ${select}.dispatchEvent(new Event("change", { bubbles: true }))`)
  await until(`${select}.value === "b"`)
  for (const width of [768, 1280, 1920]) {
    await viewport(width, false)
    await until(`innerWidth === ${width} && ${countVisible} === 4`)
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Largura ${width}`)
  }
  await viewport(390, true)
  await until(`${countVisible} === 1 && ${select}.value === "b"`)
  await openSection('Financeiro', 'financeiro')
  await until('document.querySelector(".admin-finance-grid")?.textContent.includes("Eva")')
  assert.equal(await evaluate('!!document.querySelector(".admin-calendar-columns")'), false)
  await evaluate(`{
    const input = document.querySelector('.admin-finance-period input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2027-01-02')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }`)
  await until('testCalls.some(call => call.name === "painel_financeiro" && call.body.p_data === "2027-01-02")')
  await until('document.querySelector(".admin-finance-weekly")?.textContent.includes("132,00")')
  await openSection('Configurações', 'configuracoes')
  await openSection('Agenda', 'agenda')
  assert.equal(await evaluate(`${dateField}.value`), otherDate)
  assert.equal(await evaluate(`${select}.value`), 'b')
  await clickButton('Lista')
  await openSection('Financeiro', 'financeiro')
  await openSection('Agenda', 'agenda')
  assert.equal(await evaluate('document.body.innerText.includes("Agendamentos confirmados")'), true)
  await clickButton('Calendário')
  await evaluate('localStorage.clear()')
  await login('/admin?barber')
  await until(`!${select} && ${countVisible} === 1`)
  assert.deepEqual(await evaluate(navLabels), ['Agenda', 'Financeiro', 'Configurações'])
  await openSection('Financeiro', 'financeiro')
  await until('document.querySelector(".admin-finance-grid")?.textContent.includes("Aline")')
  assert.equal(await evaluate('document.querySelector(".admin-finance-grid").textContent.includes("Eva")'), false)
  await openSection('Configurações', 'configuracoes')
  await until('document.body.innerText.includes("Editar meu contato")')
  await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent === "Editar meu contato").click()')
  const fillContact = () => evaluate(`{
    const phone = document.querySelector('input[name="phone"]')
    phone.value = '(84) 99999-1234'
    phone.form.requestSubmit()
  }`)
  await fillContact()
  await until('document.body.innerText.includes("Este perfil mudou ou foi removido")')
  const writes = await evaluate('testCalls.filter(call => call.name === "mr_saloum_atualizar_perfil_barbeiro_v1")')
  assert.deepEqual(writes.map(({ body }) => body), [{
    p_barber_id: '00000000-0000-4000-8000-000000000001',
    p_expected_version: 'fixture-v1',
    p_photo_url: 'https://example.test/foto-legada.png',
    p_whatsapp: '84999991234'
  }])
  assert.equal(await evaluate('document.querySelector("input[name=phone]") === null'), true)
  await clickButton('Recarregar contatos')
  await until('!!document.querySelector(".admin-photo-field input[type=file]")')
  await pickPhoto('invalid')
  await until('document.body.innerText.includes("JPEG, PNG ou WebP válida")')
  await pickPhoto('large')
  await until('document.body.innerText.includes("até 10 MB")')
  await pickPhoto()
  await photoReady()
  await evaluate(`{
    const slider = document.querySelector('.admin-photo-field input[type=range]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '2')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    slider.dispatchEvent(new Event('change', { bubbles: true }))
  }`)
  await until('!document.body.innerText.includes("Processando foto")')
  await clickButton('Cancelar alteração da foto')
  assert.equal(await evaluate('document.querySelector(".admin-photo-field img").src.endsWith("foto-legada.png")'), true)
  await pickPhoto()
  await photoReady()
  await evaluate('window.rejectPhotoUpload = true')
  await fillContact()
  await until('document.body.innerText.includes("A foto atual foi preservada")')
  assert.equal(await evaluate('testCalls.filter(call => call.name === "mr_saloum_atualizar_perfil_barbeiro_v1").length'), 1)
  await evaluate('window.rejectPhotoUpload = false')
  await evaluate('window.allowProfileSave = true')
  await fillContact()
  await until('document.body.innerText.includes("Contato atualizado.")')
  assert.equal(await evaluate('document.querySelector("input[name=phone]").value'), '84999991234')
  const upload = await evaluate('testCalls.filter(call => call.name === "upload-photo").at(-1)')
  assert.ok(upload.path.startsWith('00000000-0000-4000-8000-000000000001/'))
  assert.equal(upload.type, 'image/webp')
  assert.equal(upload.width, upload.height)
  assert.ok(upload.width <= 512 && upload.size <= 150 * 1024)
  assert.notEqual(upload.upsert, 'true')
  await until('!!document.querySelector(".admin-photo-field input[type=file]")')
  await clickButton('Remover foto')
  await evaluate('window.uncertainPhotoSave = true')
  await fillContact()
  await until('document.body.innerText.includes("Não foi possível confirmar a alteração")')
  assert.equal(await evaluate('testCalls.filter(call => call.name === "upload-photo").length'), 2)
  await clickButton('Recarregar contatos')
  await until('!!document.querySelector(".admin-photo-field input[type=file]")')
  assert.equal(await evaluate('!!document.querySelector(".admin-photo-field img")'), false)

  await evaluate('localStorage.clear()')
  await login('/admin?admin-contact')
  await until(`${navLabels}.includes('Equipe')`)
  assert.deepEqual(await evaluate(navLabels), ['Agenda', 'Equipe', 'Financeiro', 'Configurações'])
  await openSection('Equipe', 'equipe')
  await until('document.querySelector(".admin-team-list")?.textContent.includes("Eva")')
  assert.equal(await evaluate('testCalls.some(call => call.name === "mr_saloum_listar_catalogo_v1")'), false)
  await evaluate('document.querySelector(".admin-team-list button").click()')
  await until('!!document.querySelector("input[name=phone]") && document.body.innerText.includes("Alteração de foto indisponível")')
  assert.equal(await evaluate('!!document.querySelector(".admin-photo-field input[type=file]")'), false)
  await evaluate('window.allowProfileSave = true')
  await fillContact()
  await until('document.body.innerText.includes("Contato atualizado.")')
  assert.equal(await evaluate('testCalls.some(call => call.name === "upload-photo")'), false)
  await evaluate('localStorage.clear()')
  await login('/admin?master')
  await until(`${navLabels}.length === 5`)
  assert.deepEqual(await evaluate(navLabels), ['Agenda', 'Equipe', 'Serviços', 'Financeiro', 'Configurações'])
  for (const width of [360, 390, 412]) {
    await viewport(width, true)
    await until(`innerWidth === ${width}`)
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Cinco abas em ${width}`)
  }
  await openSection('Serviços', 'servicos')
  await until('document.body.innerText.includes("Corte simulado")')
  assert.equal(await evaluate('document.body.innerText.includes("Cadastrar barbeiro")'), false)
  await clickButton('Editar')
  await evaluate(`{
    const form = document.querySelector('input[name="price"]').form
    form.elements.price.value = '45'
    form.elements.slot_units.value = '2'
    form.requestSubmit()
  }`)
  await until('document.body.innerText.includes("45,00") && document.body.innerText.includes("70 min")')
  await openSection('Equipe', 'equipe')
  await until('document.body.innerText.includes("Excluir definitivamente remove o cadastro")')
  await evaluate(`{
    const row = [...document.querySelectorAll('.admin-catalog-group li')].find(li => li.querySelector('strong')?.textContent === 'Eva')
    const button = [...row.querySelectorAll('button')].find(button => button.textContent === 'Foto e contato')
    button.click()
  }`)
  await until('document.body.innerText.includes("Contato de Eva")')
  await clickButton('Fechar edição de contato')
  await until('document.body.innerText.includes("Excluir definitivamente remove o cadastro")')
  await evaluate(`[...document.querySelectorAll('.admin-catalog-group li')].find(
    row => row.querySelector('strong')?.textContent === 'Deise'
  ).querySelectorAll('button')[1].click()`)
  await until('document.body.innerText.includes("Alteração salva.")')
  await openSection('Agenda', 'agenda')
  await until(`!!${select} && !${select}.querySelector('option[value=d]')`)
  await openSection('Equipe', 'equipe')
  await until('document.body.innerText.includes("Excluir definitivamente remove o cadastro")')
  const lifecycle = await evaluate('testCalls.find(call => call.name === "mr_saloum_alterar_catalogo_v1" && call.body.p_kind === "barber").body')
  assert.equal(lifecycle.p_expected_version, 'fixture-v1')
  assert.equal(lifecycle.p_action, 'deactivate')

  const brunoAction = (label) => evaluate(`{
    const row = [...document.querySelectorAll('.admin-catalog-group li')]
      .find(item => item.querySelector('strong')?.textContent === 'Bruno')
    const button = [...row.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(label)})
    button.click()
  }`)
  await evaluate('confirm = () => false')
  await brunoAction('Excluir definitivamente')
  assert.equal(await evaluate('testCalls.filter(call => call.name === "mr_saloum_alterar_catalogo_v1" && call.body.p_kind === "barber").length'), 1)
  await evaluate('window.uncertainCreate = true')
  await clickButton('Cadastrar barbeiro')
  await evaluate(`{
    const form = document.querySelector('input[name=profile_id]').form
    form.elements.name.value = 'Fabiana'
    form.elements.profile_id.value = '00000000-0000-4000-8000-000000000006'
    form.requestSubmit()
  }`)
  await until('document.body.innerText.includes("Não foi possível confirmar a operação")')
  assert.equal(await evaluate('testCalls.filter(call => call.body?.p_action === "create").length'), 1)
  await clickButton('Recarregar catálogo')
  await until('document.body.innerText.includes("Fabiana")')
  await clickButton('Cadastrar barbeiro')
  await until('!!document.querySelector(".admin-photo-field input[type=file]")')
  await pickPhoto()
  await photoReady()
  await evaluate(`{
    const form = document.querySelector('input[name=profile_id]').form
    form.elements.name.value = 'Gabi'
    form.elements.profile_id.value = '00000000-0000-4000-8000-000000000008'
    form.requestSubmit()
  }`)
  await until('document.body.innerText.includes("Gabi") && !document.querySelector("input[name=profile_id]")')
  assert.equal(await evaluate('testCalls.filter(call => call.name === "mr_saloum_criar_barbeiro_para_foto_v1").length'), 1)
  assert.equal(await evaluate('testCalls.find(call => call.name === "upload-photo").path.split("/")[0]'), '00000000-0000-4000-8000-000000000008')
  await evaluate('confirm = () => true')
  await brunoAction('Excluir definitivamente')
  await until('document.body.innerText.includes("Alteração salva.")')
  await openSection('Agenda', 'agenda')
  await until(`!!${select} && !${select}.querySelector('option[value=b]') && [...${select}.options].some(option => option.text === "Fabiana")`)
  await openSection('Equipe', 'equipe')
  await until('document.body.innerText.includes("Excluir definitivamente remove o cadastro")')
  const caioAction = (label) => evaluate(`{
    const row = [...document.querySelectorAll('.admin-catalog-group li')]
      .find(item => item.querySelector('strong')?.textContent === 'Caio')
    const button = [...row.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(label)})
    button.click()
  }`)
  for (const [code, message] of [
    ['MS001', 'agendamentos futuros ou em andamento'],
    ['MS002', 'registro é protegido ou tem dependências'],
    ['MS003', 'perfil informado não está apto'],
    ['22023', 'dados enviados são inválidos'],
    ['MS004', 'Recarregue o catálogo antes de continuar']
  ]) {
    await evaluate(`window.catalogError = ${JSON.stringify(code)}`)
    await caioAction('Desativar')
    await until(`document.body.innerText.includes(${JSON.stringify(message)})`)
  }
  await clickButton('Recarregar catálogo')
  await until('document.body.innerText.includes("Excluir definitivamente remove o cadastro")')
  await evaluate('window.catalogError = "42501"')
  await caioAction('Desativar')
  await until('document.body.innerText.includes("Sua conta não possui autorização")')
  assert.equal(await evaluate(`${navLabels}.includes('Serviços')`), false)
  assert.equal(await evaluate('document.body.innerText.includes("Cadastrar barbeiro")'), false)
  await evaluate('localStorage.clear()')
  await cdp('Page.navigate', { url: origin + '/' })
  await until('!!document.querySelector("#customer-name")')
  await evaluate(`{
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const name = document.querySelector('#customer-name')
    const phone = document.querySelector('#customer-phone')
    setValue.call(name, 'Cliente simulado')
    name.dispatchEvent(new Event('input', { bubbles: true }))
    setValue.call(phone, '84999991234')
    phone.dispatchEvent(new Event('input', { bubbles: true }))
  }`)
  await evaluate('document.querySelector("#customer-name").form.requestSubmit()')
  await until('document.querySelector(".barber-card h3")?.textContent === "Aline"')
  assert.equal(await evaluate('testCalls.find(call => call.name === "barbers").projection'), 'id,name,photo_url')
  assert.equal(await evaluate('testCalls.some(call => call.name === "mr_saloum_listar_perfis_editaveis_v1")'), false)
  await evaluate('document.querySelector(".barber-card").click()')
  await until('!!document.querySelector(".barber-card.selected")')
  await evaluate('document.querySelector(".service-card").click()')
  await until('!!document.querySelector(".service-card.selected")')
  await evaluate('revisePublicCatalog(); dispatchEvent(new Event("focus"))')
  await until('document.querySelector(".barber-card.selected h3")?.textContent === "Aline atualizada" && document.querySelector(".service-card.selected").innerText.includes("48")')
  await evaluate('deactivatePublicBarber(); dispatchEvent(new Event("focus"))')
  await until('!document.querySelector(".barber-card.selected") && document.querySelector(".barber-card h3")?.textContent === "Bruno"')
  assert.equal(await evaluate('testCalls.some(call => call.name === "criar_agendamento")'), false)
  console.log('Painel em 360, 390, 412, 768, 1280 e 1920 px, seções, agenda, financeiro, catálogo, contato e privacidade validados com dados simulados.')
} finally {
  socket.close()
  await fetch(debuggerOrigin + '/json/close/' + page.id, { signal: AbortSignal.timeout(3000) }).catch(() => {})
}
