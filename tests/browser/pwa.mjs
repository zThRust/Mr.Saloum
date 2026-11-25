// Chromium CDP 9436, three production builds on the same temporary localhost origin.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const builds = process.argv.slice(2).map((path) => resolve(path))
if (builds.length !== 3) throw new Error('Uso: node tests/browser/pwa.mjs <dist-antigo> <dist-b> <dist-c>')
const debug = 'http://127.0.0.1:9436'
const origin = 'http://127.0.0.1:5182'
let published = 0
const mime = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'
}
const http = createServer(async (request, response) => {
  const url = new URL(request.url, origin)
  const root = builds[published]
  const path = url.pathname === '/' || (published === 0 && url.pathname.startsWith('/admin'))
    ? '/index.html' : ['/admin', '/admin/'].includes(url.pathname) ? '/admin/index.html' : url.pathname
  const file = resolve(root, '.' + path)
  if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return }
  try {
    const body = await readFile(file)
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': path.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache'
    }).end(body)
  } catch { response.writeHead(404).end() }
})
await new Promise((ready, reject) => {
  http.once('error', reject)
  http.listen(5182, '127.0.0.1', ready)
})

let page
async function tab() {
  const info = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json()
  const socket = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  const pending = new Map()
  let id = 0
  socket.onmessage = ({ data }) => { const value = JSON.parse(data); pending.get(value.id)?.(value) }
  async function command(method, params = {}) {
    const next = ++id
    let timeout
    try {
      const result = await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Tempo limite de ' + method)), 6000)
        pending.set(next, resolve)
        socket.send(JSON.stringify({ id: next, method, params }))
      })
      if (result.error) throw new Error(JSON.stringify(result.error))
      return result.result
    } finally { clearTimeout(timeout); pending.delete(next) }
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  async function until(expression) {
    for (let attempt = 0; attempt < 70; attempt++) {
      try { if (await evaluate(expression)) return }
      catch (error) { if (!/context was destroyed|Cannot find context/i.test(error.message)) throw error }
      await delay(100)
    }
    throw new Error('Condição não atingida: ' + expression)
  }
  async function close() {
    socket.close()
    await fetch(debug + '/json/close/' + info.id, { signal: AbortSignal.timeout(3000) }).catch(() => {})
  }
  await command('Page.enable')
  await command('Page.addScriptToEvaluateOnNewDocument', { source: '(' + mocks.toString() + ')()' })
  return { command, evaluate, until, close }
}

function mocks() {
  if (location.origin !== 'http://127.0.0.1:5182') return
  const user = { id: '00000000-0000-4000-8000-000000000001', role: 'authenticated', is_anonymous: false }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const access_token = [{ alg: 'HS256' }, { sub: user.id, exp }]
    .map((value) => btoa(JSON.stringify(value)).replace(/=/g, '')).join('.') + '.c2ln'
  const request = window.fetch.bind(window)
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input, location.origin)
    if (url.origin === location.origin) return request(input, options)
    if (url.origin !== 'http://127.0.0.1:59887') throw new Error('Origem fora do mock')
    const name = url.pathname.split('/').at(-1)
    if (name === 'token') return Response.json({ user, access_token, refresh_token: 'fixture', expires_in: 3600, expires_at: exp })
    if (name === 'profiles') return Response.json({ name: 'Sessão simulada', role: 'admin', barber_id: user.id })
    if (name === 'user') return Response.json(user)
    return Response.json([])
  }
}

try {
  page = await tab()
  await page.command('Page.navigate', { url: origin + '/admin' })
  await page.until('!!document.querySelector("#admin-email")')
  await page.evaluate(`{
    const put = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    for (const [selector, value] of [['#admin-email', 'fixture@example.test'], ['#admin-password', 'fixture-password']]) {
      const input = document.querySelector(selector)
      put.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    document.querySelector('#admin-email').form.requestSubmit()
  }`)
  await page.until('document.body?.innerText.includes("Sessão simulada")')
  await page.until('navigator.serviceWorker.getRegistration().then(r => r?.active?.state === "activated")')
  if (!await page.evaluate('!!navigator.serviceWorker.controller')) {
    await page.command('Page.reload')
    await page.until('document.body?.innerText.includes("Sessão simulada")')
  }
  await page.until('!!navigator.serviceWorker.controller')
  await page.evaluate('sessionStorage.setItem("pwa-volume", "preservar"); localStorage.setItem("pwa-migracao", "preservar"); caches.open("cache-alheio")')
  const loginKey = await page.evaluate('Object.keys(localStorage).find(k => k.endsWith("-auth-token"))')
  assert.ok(loginKey)
  assert.equal(await page.evaluate('window.__SAL_TEST_BUILD'), 'antigo')

  published = 1
  // A navegação controlada pelo Workbox antigo ainda usa index.html precacheado.
  await page.command('Page.reload')
  await page.until('window.__SAL_TEST_BUILD === "antigo"')
  await page.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
  await page.until('navigator.serviceWorker.getRegistration().then(r => !!r.waiting)')
  await page.close()
  // Give Chromium time to release the closed client before opening a new one under the same scope.
  await delay(750)
  page = await tab()
  const directEntry = await fetch(origin + '/admin/index.html')
  assert.equal(directEntry.status, 200)
  await page.command('Page.navigate', { url: origin + '/admin/index.html' })
  await page.until('window.__SAL_TEST_BUILD === "B" && document.body?.innerText.includes("Sessão simulada")')
  await page.until('!!navigator.serviceWorker.controller')
  assert.equal(await page.evaluate('localStorage.getItem("pwa-migracao")'), 'preservar')
  assert.ok(await page.evaluate(`!!localStorage.getItem(${JSON.stringify(loginKey)})`))

  await page.evaluate('sessionStorage.setItem("pwa-volume", "continuar"); document.querySelector(\'[aria-label="Criar agendamento presencial"]\').click()')
  await page.until('!!document.querySelector("[role=dialog]")')
  published = 2
  await page.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
  await page.until('!!document.querySelector(".pwa-update-banner button")?.disabled')
  assert.equal(await page.evaluate('window.__SAL_TEST_BUILD'), 'B')
  await page.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))')
  await page.until('document.querySelector(".pwa-update-banner button")?.disabled === false')
  await page.evaluate('document.querySelector(".pwa-update-banner button").click()')
  await page.until('window.__SAL_TEST_BUILD === "C" && document.body?.innerText.includes("Sessão simulada")')
  const navigation = await page.evaluate('performance.timeOrigin')
  await delay(800)
  assert.equal(await page.evaluate('performance.timeOrigin'), navigation)
  assert.equal(await page.evaluate('sessionStorage.getItem("pwa-volume")'), 'continuar')
  assert.equal(await page.evaluate('caches.has("cache-alheio")'), true)
  assert.equal(await page.evaluate('!!document.querySelector(".pwa-update-banner")'), false)
  await page.until('document.querySelector(".admin-shell-brand")?.naturalWidth === 400')
  assert.equal(await page.evaluate('caches.match("/mr-saloum-logo-header.webp").then(Boolean)'), true)
  const manifest = await (await fetch(origin + '/manifest.webmanifest')).json()
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.deepEqual(manifest.icons.map(({ sizes, purpose }) => [sizes, purpose]), [
    ['192x192', 'any'], ['512x512', 'any'], ['192x192', 'maskable'], ['512x512', 'maskable']
  ])
  const metadata = await page.evaluate(`(async () => {
    const manifest = await fetch('/manifest.webmanifest').then(response => response.json())
    const home = new DOMParser().parseFromString(await fetch('/').then(response => response.text()), 'text/html')
    const faviconLinks = [...home.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')]
    const shareLinks = [...home.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')]
    const urls = [
      ...manifest.icons.map(icon => icon.src),
      ...faviconLinks.map(link => link.getAttribute('href')),
      ...shareLinks.map(meta => new URL(meta.content).pathname + new URL(meta.content).search)
    ]
    return Promise.all(urls.map(async (url) => {
      const image = new Image()
      image.src = url
      await image.decode()
      return [new URL(url, location.origin).search, image.naturalWidth, image.naturalHeight]
    }))
  })()`)
  assert.deepEqual(metadata, [
    [192, 192], [512, 512], [192, 192], [512, 512],
    [16, 16], [32, 32], [48, 48], [180, 180], [1200, 630], [1200, 630]
  ].map(([width, height]) => ['?v=11', width, height]))
  console.log('PWA: legado → B → C, espera, operação, sessão, cache alheio e recarga única aprovados.')
} finally {
  await page?.close()
  http.close()
}
