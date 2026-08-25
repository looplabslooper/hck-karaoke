import { useRef, useState, type DragEvent } from 'react'
import type { Singer, Template, TemplateRenderStatus } from '@kiosco/shared'
import { Icon } from './icons'

interface Props {
  templates: Template[]
  faceswapStatus: Record<string, Record<string, TemplateRenderStatus>>
  faceSwapEnabled: boolean
  onEnableFaceSwap: () => void
  singersWithPhoto: (Singer & { photoUrl: string })[]
  testSingerId: string | null
  onSetTestSingerId: (id: string) => void
  uploading: boolean
  error: string | null
  onUpload: (file: File, kind: 'sticker' | 'faceswap', name: string) => void
  onTest: (template: Template) => void
  onRename: (id: string, name: string) => void
  onSetHotkey: (id: string, hotkey: number | null) => void
  onDelete: (id: string) => void
}

const HOTKEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

/**
 * Studio → Fun Box: carga de templates nuevos + galería/manager de los que
 * ya existen. Cada tarjeta de la grilla hace las dos cosas a la vez (preview
 * en video + nombre editable + hotkey + borrar) — separar "galería" y
 * "manager" en dos pantallas hubiera duplicado la misma lista sin necesidad.
 */
export function FunBox({
  templates,
  faceswapStatus,
  faceSwapEnabled,
  onEnableFaceSwap,
  singersWithPhoto,
  testSingerId,
  onSetTestSingerId,
  uploading,
  error,
  onUpload,
  onTest,
  onRename,
  onSetHotkey,
  onDelete,
}: Props) {
  const [kind, setKind] = useState<'sticker' | 'faceswap'>('sticker')
  const [name, setName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function submitFile(file: File) {
    onUpload(file, kind, name)
    setName('')
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) submitFile(file)
  }

  return (
    <>
      <div className="hck-card" style={{ maxWidth: '640px', gap: '16px' }}>
        <div className="hck-field">
          <label>Tipo de template</label>
          <div className="hck-chips">
            <button type="button" className={`hck-chip${kind === 'sticker' ? ' hck-chip-on' : ''}`} onClick={() => setKind('sticker')}>
              Sticker por color
            </button>
            <button
              type="button"
              className={`hck-chip${kind === 'faceswap' ? ' hck-chip-on' : ''}`}
              disabled={!faceSwapEnabled}
              title={faceSwapEnabled ? undefined : 'Deshabilitado en esta instalación (sin GPU NVIDIA)'}
              onClick={() => setKind('faceswap')}
            >
              Face swap con IA
            </button>
          </div>
        </div>

        {!faceSwapEnabled && (
          <div className="hck-card" style={{ background: 'var(--hck-surface-2)', gap: '8px', padding: '14px 16px' }}>
            <p className="hck-muted" style={{ fontSize: '13.5px' }}>
              Face swap deshabilitado en esta instalación — no se detectó una placa NVIDIA al
              instalar. Sin GPU, cada video tarda 13+ minutos en procesarse (probado), así que no
              es usable en vivo. El sticker por color sigue andando normal, no necesita GPU.
            </p>
            <button type="button" className="hck-btn hck-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={onEnableFaceSwap}>
              Habilitar igual
            </button>
          </div>
        )}

        <div className="hck-field">
          <label>Nombre (opcional)</label>
          <input
            className="hck-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Escena ${templates.length + 1}`}
          />
        </div>

        <div
          className="hck-dropzone"
          style={dragOver ? { borderColor: 'var(--hck-accent)' } : undefined}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="hck-ico"><Icon name="upload" size={40} w={2.2} /></span>
          <div style={{ fontSize: '19px', fontWeight: 700, letterSpacing: '-.02em' }}>Arrastrá el video acá</div>
          <div className="hck-muted">o hacé clic para buscarlo en tu equipo</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.webm,.mov"
            hidden
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) submitFile(file)
              e.target.value = ''
            }}
          />
        </div>

        <p className="hck-faint" style={{ fontSize: '13.5px' }}>
          {kind === 'sticker'
            ? 'Corre el tracking por color automáticamente (unos segundos) — el video tiene que tener la máscara/capucha de color saturado que pide el director de escenas.'
            : 'Corre el análisis de cara real automáticamente (puede tardar uno o dos minutos, no bloquea nada mientras tanto) — el video tiene que mostrar la cara del protagonista bien visible, de frente o 3/4, con buena luz.'}
        </p>
        {uploading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="hck-spinner" />
            <span className="hck-muted" style={{ fontSize: '14.5px' }}>{kind === 'sticker' ? 'Mapeando…' : 'Analizando la cara…'}</span>
          </div>
        )}
        {error && <p style={{ color: '#F87171', fontSize: '14px' }}>{error}</p>}
      </div>

      {/* Probar el mapeo con una cara real, sin depender de estar en pantalla
          completa en medio de un show — para distinguir "no mapea bien" de
          "no se ve nada" de "se queda en el primer frame". */}
      {singersWithPhoto.length === 0 ? (
        <p className="hck-muted">
          Para probar cómo queda mapeada la cara necesitás al menos un cantante con foto — registrá uno desde Sesión.
        </p>
      ) : (
        <div className="hck-field" style={{ maxWidth: '280px' }}>
          <label>Probar con</label>
          <select className="hck-input" value={testSingerId ?? singersWithPhoto[0].id} onChange={(e) => onSetTestSingerId(e.target.value)}>
            {singersWithPhoto.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(clamp(240px,20vw,300px),1fr))', gap: 'clamp(16px,1.5vw,24px)' }}>
        {templates.map((t) => {
          const testSinger = singersWithPhoto.find((s) => s.id === testSingerId) ?? singersWithPhoto[0]
          const testStatus = t.kind === 'faceswap' && testSinger ? faceswapStatus[testSinger.id]?.[t.id] : undefined
          const testNotReady = t.kind === 'faceswap' && testStatus !== 'ready'
          const testDisabled = singersWithPhoto.length === 0 || testNotReady
          const testTitle =
            singersWithPhoto.length === 0
              ? 'Necesitás un cantante con foto para probar'
              : testNotReady
                ? testStatus === 'disabled'
                  ? 'Face swap deshabilitado en esta instalación (sin GPU NVIDIA)'
                  : testStatus === 'failed'
                    ? 'No se pudo generar el swap para este cantante'
                    : 'Preparando el swap para este cantante…'
                : undefined
          return (
            <TemplateCard
              key={t.id}
              template={t}
              testDisabled={testDisabled}
              testTitle={testTitle}
              onTest={() => onTest(t)}
              onRename={(newName) => onRename(t.id, newName)}
              onSetHotkey={(hotkey) => onSetHotkey(t.id, hotkey)}
              onDelete={() => onDelete(t.id)}
            />
          )
        })}
        {templates.length === 0 && <p className="hck-muted">Todavía no hay ningún template — subí el primero arriba.</p>}
      </div>
    </>
  )
}

interface CardProps {
  template: Template
  testDisabled: boolean
  testTitle: string | undefined
  onTest: () => void
  onRename: (name: string) => void
  onSetHotkey: (hotkey: number | null) => void
  onDelete: () => void
}

function TemplateCard({ template: t, testDisabled, testTitle, onTest, onRename, onSetHotkey, onDelete }: CardProps) {
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(t.name)

  function commitName() {
    setEditingName(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== t.name) onRename(trimmed)
    else setDraftName(t.name)
  }

  return (
    <div className="hck-card" style={{ gap: '14px' }}>
      <span className="hck-tag hck-tag-outline" style={{ alignSelf: 'flex-start' }}>
        {t.kind === 'faceswap' ? 'Face swap IA' : 'Sticker'}
      </span>

      {editingName ? (
        <input
          className="hck-input"
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') {
              setDraftName(t.name)
              setEditingName(false)
            }
          }}
          style={{ fontSize: '15.5px', fontWeight: 700 }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingName(true)}
          title="Click para renombrar"
          style={{ all: 'unset', cursor: 'text', fontSize: '15.5px', fontWeight: 700, textAlign: 'left' }}
        >
          {t.name}
        </button>
      )}

      <video src={t.videoUrl} muted controls style={{ width: '100%', aspectRatio: '16/10', borderRadius: 'var(--hck-r-md)', background: 'var(--hck-bg-deep)' }} />

      <div className="hck-field">
        <label style={{ fontSize: '13px' }}>Hotkey en vivo</label>
        <div className="hck-chips">
          {HOTKEYS.map((n) => (
            <button
              key={n}
              type="button"
              className={`hck-chip${t.hotkey === n ? ' hck-chip-on' : ''}`}
              style={{ minWidth: '34px', padding: '6px 0', textAlign: 'center' }}
              title={t.hotkey === n ? 'Tocá de nuevo para desasignar' : `Asignar tecla ${n}`}
              onClick={() => onSetHotkey(t.hotkey === n ? null : n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <button className="hck-btn hck-btn-secondary" style={{ flex: 1 }} disabled={testDisabled} title={testTitle} onClick={onTest}>
          <Icon name="wand" size={14} /> Probar
        </button>
        <button className="hck-btn hck-btn-icon hck-btn-ghost" onClick={onDelete} title="Eliminar">
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  )
}
