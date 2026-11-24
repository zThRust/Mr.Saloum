import { test } from 'node:test'
import assert from 'node:assert/strict'
import { holdUpdate, watchPwa } from '../src/pwaUpdate.js'

function fixture() {
  const state = {}
  const events = new EventTarget()
  const registration = new EventTarget()
  const win = new EventTarget()
  const doc = new EventTarget()
  let reloads = 0
  let checks = 0
  let messages = 0
  let now = 1000
  events.controller = {}
  events.register = async () => registration
  registration.update = async () => { checks++ }
  registration.waiting = { postMessage() { messages++ } }
  win.location = { reload() { reloads++ } }
  win.setTimeout = setTimeout
  win.clearTimeout = clearTimeout
  win.setInterval = setInterval
  win.clearInterval = clearInterval
  doc.visibilityState = 'visible'
  const watcher = watchPwa(events, win, doc, (next) => Object.assign(state, next), () => now)
  return { state, events, registration, win, watcher, counts: () => [reloads, checks, messages], advance: () => { now += 60000 } }
}

test('uma atualização espera o fim da operação e recarrega uma única vez', async () => {
  const f = fixture()
  const release = holdUpdate()
  try {
    await Promise.resolve()
    assert.equal(f.state.busy, true)
    f.watcher.apply()
    assert.deepEqual(f.counts(), [0, 1, 0])
    release()
    f.watcher.apply()
    f.watcher.apply()
    assert.deepEqual(f.counts(), [0, 1, 1])
    f.registration.waiting = null
    f.events.dispatchEvent(new Event('controllerchange'))
    f.events.dispatchEvent(new Event('controllerchange'))
    assert.deepEqual(f.counts(), [1, 1, 1])
  } finally {
    release()
    f.watcher.close()
  }
})

test('atualização em outra aba não recarrega esta aba e foco respeita limite', async () => {
  const f = fixture()
  try {
    await Promise.resolve()
    await Promise.resolve()
    f.win.dispatchEvent(new Event('focus'))
    assert.deepEqual(f.counts(), [0, 1, 0])
    f.advance()
    f.win.dispatchEvent(new Event('focus'))
    f.registration.waiting = null
    f.events.dispatchEvent(new Event('controllerchange'))
    assert.deepEqual(f.counts(), [0, 2, 0])
    f.watcher.apply()
    assert.deepEqual(f.counts(), [1, 2, 0])
  } finally { f.watcher.close() }
})
