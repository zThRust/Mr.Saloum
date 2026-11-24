import { useEffect, useRef, useState } from 'react'
import { decodeBarberPhoto, renderBarberPhoto } from './barberPhoto'
import { supabase } from './lib/supabase'

const initialFrame = { zoom: 1, x: 50, y: 50 }

function PhotoPreview({ blob, url }) {
  const imageRef = useRef(null)
  useEffect(() => {
    if (!blob) return
    const objectUrl = URL.createObjectURL(blob)
    imageRef.current.src = objectUrl
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])
  return <img ref={imageRef} src={blob ? undefined : url} alt="Prévia circular da foto" />
}

export default function BarberPhotoField({ barberId, existing, draft, onChange }) {
  const [allowed, setAllowed] = useState(false)
  const [error, setError] = useState('')
  const [frame, setFrame] = useState(initialFrame)
  const source = useRef(null)
  const sequence = useRef(0)
  const previous = useRef(null)

  useEffect(() => {
    let current = true
    async function check() {
      try {
        const { data, error } = await supabase.rpc('mr_saloum_pode_editar_foto_v1', { p_barber_id: barberId ?? null })
        if (current) setAllowed(!error && data === true)
      } catch { if (current) setAllowed(false) }
    }
    check()
    function dispose() {
      current = false
      sequence.current++
      source.current?.close()
      source.current = null
    }
    return dispose
  }, [barberId])

  async function draw(image, settings, ticket) {
    const blob = await renderBarberPhoto(image, settings)
    if (ticket === sequence.current) onChange({ kind: 'upload', blob })
  }

  async function choose(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const ticket = ++sequence.current
    previous.current = draft?.kind === 'pending' ? previous.current : draft
    onChange({ kind: 'pending' })
    setError('')
    try {
      const image = await decodeBarberPhoto(file)
      if (ticket !== sequence.current) { image.close(); return }
      source.current?.close()
      source.current = image
      setFrame(initialFrame)
      await draw(image, initialFrame, ticket)
    } catch (error) {
      if (ticket === sequence.current) {
        setError(error instanceof DOMException ? 'Não foi possível decodificar a imagem.' : error.message)
        onChange(previous.current)
      }
    }
  }

  async function crop(next) {
    if (!source.current) return
    setFrame(next)
    const ticket = ++sequence.current
    if (draft?.blob) previous.current = draft
    onChange({ kind: 'pending', blob: previous.current?.blob })
    try { await draw(source.current, next, ticket) }
    catch (error) {
      if (ticket === sequence.current) { setError(error.message); onChange(previous.current) }
    }
  }

  function reset(change) {
    sequence.current++
    source.current?.close()
    source.current = null
    setError('')
    onChange(change)
  }

  const image = draft?.kind === 'remove' ? '' : existing
  const canCapture = 'capture' in HTMLInputElement.prototype && navigator.maxTouchPoints > 0
  return (
    <div className="admin-photo-field">
      {(image || draft?.blob) && <PhotoPreview key={draft?.blob ? 'draft' : 'existing'} blob={draft?.blob} url={image} />}
      {allowed ? (
        <>
          <label>Escolher foto<input type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} /></label>
          {canCapture && <label>Usar câmera<input type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={choose} /></label>}
          {draft?.blob && ['zoom', 'x', 'y'].map((key) => (
            <label key={key}>{({ zoom: 'Zoom', x: 'Posição horizontal', y: 'Posição vertical' })[key]}
              <input type="range" min={key === 'zoom' ? 1 : 0} max={key === 'zoom' ? 3 : 100}
                step={key === 'zoom' ? 0.05 : 1} value={frame[key]} onChange={(event) => crop({ ...frame, [key]: Number(event.target.value) })} />
            </label>
          ))}
          {draft?.kind === 'pending' && <p role="status">Processando foto…</p>}
          {error && <p role="alert">{error}</p>}
          {existing && draft?.kind !== 'remove' && <button type="button" onClick={() => reset({ kind: 'remove' })}>Remover foto</button>}
          {draft && <button type="button" onClick={() => reset(null)}>Cancelar alteração da foto</button>}
        </>
      ) : <p>Alteração de foto indisponível para esta sessão.</p>}
    </div>
  )
}
