import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const blockers = new Set()
const subscribers = new Set()
const notify = () => subscribers.forEach((listener) => listener())

export function holdUpdate() {
  const key = Symbol()
  blockers.add(key)
  notify()
  return () => { blockers.delete(key); notify() }
}

export function useUpdateBlock(value) {
  useLayoutEffect(() => {
    if (!value) return
    return holdUpdate()
  }, [value])
}

export function watchPwa(serviceWorker, win, doc, onState, now = Date.now) {
  let running = true
  let registration
  let previousController = serviceWorker.controller
  let changed = false
  let requested = false
  let reloaded = false
  let lastCheck = -Infinity
  let pendingCheck = false
  let timer
  const installers = new Set()

  function publish() {
    if (running) onState({ available: Boolean(registration?.waiting || changed), busy: blockers.size > 0, requested })
  }
  function reload() {
    if (reloaded) return
    reloaded = true
    win.location.reload()
  }
  function controllerChanged() {
    const initiatedHere = requested
    if (previousController) changed = true
    previousController = serviceWorker.controller
    requested = false
    win.clearTimeout(timer)
    if (initiatedHere && !blockers.size) return reload()
    // An upgrade started in another tab never reloads this one.
    publish()
  }
  async function check() {
    if (!registration || pendingCheck || now() - lastCheck < 60000) return
    pendingCheck = true
    lastCheck = now()
    try { await registration.update() } catch { /* Offline. */ }
    finally { pendingCheck = false; publish() }
  }
  function inspect() {
    const worker = registration.installing
    if (worker && !installers.has(worker)) {
      installers.add(worker)
      worker.addEventListener('statechange', publish)
    }
    publish()
  }
  function visible() { if (doc.visibilityState === 'visible') check() }

  subscribers.add(publish)
  serviceWorker.addEventListener('controllerchange', controllerChanged)
  win.addEventListener('focus', check)
  win.addEventListener('online', check)
  doc.addEventListener('visibilitychange', visible)
  const periodic = win.setInterval(visible, 5 * 60 * 1000)
  serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((value) => {
    if (!running) return
    registration = value
    registration.addEventListener('updatefound', inspect)
    inspect()
    check()
  }).catch(() => {})

  return {
    apply() {
      if (!running || blockers.size || requested || reloaded) return
      if (changed) return reload()
      if (!registration?.waiting) return
      requested = true
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      timer = win.setTimeout(() => { requested = false; publish() }, 10000)
      publish()
    },
    close() {
      running = false
      win.clearTimeout(timer)
      win.clearInterval(periodic)
      subscribers.delete(publish)
      serviceWorker.removeEventListener('controllerchange', controllerChanged)
      win.removeEventListener('focus', check)
      win.removeEventListener('online', check)
      doc.removeEventListener('visibilitychange', visible)
      registration?.removeEventListener('updatefound', inspect)
      installers.forEach((worker) => worker.removeEventListener('statechange', publish))
    }
  }
}

export function usePwaUpdate() {
  const [update, setUpdate] = useState(null)
  const controllerRef = useRef(null)
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    const controller = watchPwa(navigator.serviceWorker, window, document, setUpdate)
    controllerRef.current = controller
    return () => controller.close()
  }, [])
  return { ...update, apply: () => controllerRef.current?.apply() }
}
