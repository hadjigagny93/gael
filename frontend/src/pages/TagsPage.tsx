import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

interface Tag {
  id: number
  name: string
  description?: string
  url?: string
  parent_id: number | null
  x: number
  y: number
  radius: number
  color: string
}

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']
const MIN_RADIUS = 48
const BORDER_HIT = 12

type DragMode = 'move' | 'resize' | 'pan'

interface DragState {
  tagId?: number
  mode: DragMode
  startX: number
  startY: number
  origX: number
  origY: number
  origR: number
  panStartTx?: number
  panStartTy?: number
}

interface ViewTransform {
  tx: number
  ty: number
  scale: number
}

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)
}

function isInside(ax: number, ay: number, ar: number, bx: number, by: number, br: number) {
  return dist(ax, ay, bx, by) + ar <= br - 4
}

function clampInParent(cx: number, cy: number, cr: number, px: number, py: number, pr: number) {
  const d = dist(cx, cy, px, py)
  const maxD = pr - cr - 4
  if (maxD <= 0) return { x: px, y: py }
  if (d > maxD) {
    const angle = Math.atan2(cy - py, cx - px)
    return { x: px + Math.cos(angle) * maxD, y: py + Math.sin(angle) * maxD }
  }
  return { x: cx, y: cy }
}

function minRadiusForChildren(tag: Tag, all: Tag[]) {
  const children = all.filter(t => t.parent_id === tag.id)
  if (!children.length) return MIN_RADIUS
  return Math.max(MIN_RADIUS, ...children.map(c => dist(tag.x, tag.y, c.x, c.y) + c.radius + 8))
}

function descendants(tagId: number, all: Tag[]): number[] {
  const children = all.filter(t => t.parent_id === tagId).map(t => t.id)
  return [...children, ...children.flatMap(id => descendants(id, all))]
}

export default function TagsPage() {
  const qc = useQueryClient()
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [creating, setCreating] = useState<{ x: number; y: number } | null>(null)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editingTagId, setEditingTagId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ name: '', description: '', url: '' })
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [view, setView] = useState<ViewTransform>({ tx: 0, ty: 0, scale: 1 })
  const [spaceDown, setSpaceDown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: remoteTags = [] } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn: () => api.get('/tags/').then(r => r.data),
    onSuccess: (data) => setTags(data.map(t => ({ ...t, x: Number(t.x), y: Number(t.y), radius: Number(t.radius) }))),
  })

  useEffect(() => {
    if (remoteTags.length) {
      setTags(remoteTags.map(t => ({ ...t, x: Number(t.x), y: Number(t.y), radius: Number(t.radius) })))
    }
  }, [remoteTags])

  const createTag = useMutation({
    mutationFn: (payload: Partial<Tag> & { name: string }) => api.post('/tags/', payload).then(r => r.data),
    onSuccess: (tag: Tag) => {
      setTags(prev => [...prev, { ...tag, x: Number(tag.x), y: Number(tag.y), radius: Number(tag.radius) }])
      qc.invalidateQueries({ queryKey: ['tags'] })
    },
  })

  const updateTag = useMutation({
    mutationFn: ({ id, ...rest }: Partial<Tag> & { id: number }) => api.patch(`/tags/${id}`, rest).then(r => r.data),
    onSuccess: (tag: Tag) => {
      setTags(prev => prev.map(t => t.id === tag.id ? { ...tag, x: Number(tag.x), y: Number(tag.y), radius: Number(tag.radius) } : t))
      qc.invalidateQueries({ queryKey: ['tags'] })
    },
  })

  const deleteTag = useMutation({
    mutationFn: (id: number) => api.delete(`/tags/${id}`),
    onSuccess: (_: unknown, id: number) => {
      setTags(prev => prev.filter(t => t.id !== id))
      qc.invalidateQueries({ queryKey: ['tags'] })
    },
  })

  // Convert screen coords to SVG world coords (accounting for view transform)
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    const sx = (clientX - rect.left - view.tx) / view.scale
    const sy = (clientY - rect.top - view.ty) / view.scale
    return { x: sx, y: sy }
  }, [view])

  // Zoom on wheel
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setView(v => {
      const newScale = Math.max(0.1, Math.min(5, v.scale * delta))
      // zoom centered on cursor
      const tx = mouseX - (mouseX - v.tx) * (newScale / v.scale)
      const ty = mouseY - (mouseY - v.ty) * (newScale / v.scale)
      return { tx, ty, scale: newScale }
    })
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [onWheel])

  // Space key for pan mode
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); setSpaceDown(true) } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // Click on canvas → create (only when not panning)
  const onSvgMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target !== svgRef.current) return
    if (e.button === 1 || spaceDown) {
      // middle button or space = pan
      e.preventDefault()
      dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, origX: 0, origY: 0, origR: 0, panStartTx: view.tx, panStartTy: view.ty }
      return
    }
  }, [spaceDown, view])

  const onSvgClick = useCallback((e: React.MouseEvent) => {
    if (e.target !== svgRef.current) return
    if (spaceDown) return
    const { x, y } = screenToWorld(e.clientX, e.clientY)
    setCreating({ x, y })
    setNewName('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [spaceDown, screenToWorld])

  const confirmCreate = useCallback(() => {
    if (!newName.trim() || !creating) { setCreating(null); setNewName(''); setNewDesc(''); setNewUrl(''); return }
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]
    createTag.mutate({
      name: newName.trim(),
      description: newDesc.trim() || undefined,
      url: newUrl.trim() || undefined,
      x: creating.x, y: creating.y, radius: 80, color, parent_id: null,
    })
    setCreating(null)
    setNewName(''); setNewDesc(''); setNewUrl('')
  }, [newName, newDesc, newUrl, creating, createTag])

  // Mouse down on bubble
  const onBubbleMouseDown = useCallback((e: React.MouseEvent, tag: Tag) => {
    e.stopPropagation()
    if (spaceDown || e.button === 1) {
      // pan mode
      dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, origX: 0, origY: 0, origR: 0, panStartTx: view.tx, panStartTy: view.ty }
      return
    }
    if (e.detail === 2) {
      setEditingId(tag.id)
      setEditName(tag.name)
      return
    }
    const { x, y } = screenToWorld(e.clientX, e.clientY)
    const d = dist(x, y, tag.x, tag.y)
    const mode: DragMode = d > tag.radius - BORDER_HIT ? 'resize' : 'move'
    dragRef.current = { tagId: tag.id, mode, startX: x, startY: y, origX: tag.x, origY: tag.y, origR: tag.radius }
  }, [spaceDown, view, screenToWorld])

  const onMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current
    if (!drag) return

    if (drag.mode === 'pan') {
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      setView(v => ({ ...v, tx: (drag.panStartTx ?? 0) + dx, ty: (drag.panStartTy ?? 0) + dy }))
      return
    }

    const { x, y } = screenToWorld(e.clientX, e.clientY)
    const dx = x - drag.startX
    const dy = y - drag.startY

    setTags(prev => {
      const tag = prev.find(t => t.id === drag.tagId)
      if (!tag) return prev
      const parent = tag.parent_id ? prev.find(t => t.id === tag.parent_id) : null

      if (drag.mode === 'move') {
        let nx = drag.origX + dx
        let ny = drag.origY + dy
        if (parent) {
          const clamped = clampInParent(nx, ny, tag.radius, parent.x, parent.y, parent.radius)
          nx = clamped.x; ny = clamped.y
        }
        const delta = { dx: nx - tag.x, dy: ny - tag.y }
        const desc = descendants(tag.id, prev)
        return prev.map(t => {
          if (t.id === drag.tagId) return { ...t, x: nx, y: ny }
          if (desc.includes(t.id)) return { ...t, x: t.x + delta.dx, y: t.y + delta.dy }
          return t
        })
      } else {
        const d = dist(x, y, tag.x, tag.y)
        const minR = minRadiusForChildren(tag, prev)
        let nr = Math.max(minR, d + 4)
        if (parent) nr = Math.min(nr, parent.radius - dist(tag.x, tag.y, parent.x, parent.y) - 4)
        return prev.map(t => t.id === drag.tagId ? { ...t, radius: nr } : t)
      }
    })
  }, [screenToWorld])

  const onMouseUp = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.mode === 'pan') return

    setTags(prev => {
      const tag = prev.find(t => t.id === drag.tagId)
      if (!tag) return prev

      let newParentId: number | null = null

      if (drag.mode === 'move') {
        const desc = new Set(descendants(tag.id, prev))
        const candidates = prev.filter(t => t.id !== tag.id && !desc.has(t.id) && isInside(tag.x, tag.y, tag.radius, t.x, t.y, t.radius))
        if (candidates.length) {
          candidates.sort((a, b) => a.radius - b.radius)
          newParentId = candidates[0].id
        }
        updateTag.mutate({ id: tag.id, x: tag.x, y: tag.y, parent_id: newParentId })
        return prev.map(t => t.id === tag.id ? { ...t, parent_id: newParentId } : t)
      } else {
        updateTag.mutate({ id: tag.id, radius: tag.radius })
        return prev
      }
    })
  }, [updateTag])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [onMouseMove, onMouseUp])

  const renderOrder = useCallback((list: Tag[]): Tag[] => {
    const roots = list.filter(t => !t.parent_id)
    const result: Tag[] = []
    const visit = (tag: Tag) => {
      result.push(tag)
      list.filter(t => t.parent_id === tag.id).forEach(visit)
    }
    roots.forEach(visit)
    list.filter(t => !result.find(r => r.id === t.id)).forEach(t => result.push(t))
    return result
  }, [])

  const saveEditName = () => {
    if (!editName.trim() || !editingId) { setEditingId(null); return }
    updateTag.mutate({ id: editingId, name: editName.trim() })
    setEditingId(null)
  }

  const ordered = renderOrder(tags)

  const cursor = spaceDown ? 'grab' : 'crosshair'

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Tags</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Clic pour créer · Glisser pour déplacer · Bord pour redimensionner · Emboîter pour hiérarchie · <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Espace</kbd>+glisser ou molette pour naviguer
          </p>
        </div>
        <button
          onClick={() => setView({ tx: 0, ty: 0, scale: 1 })}
          className="text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1 transition-colors"
        >
          Réinitialiser la vue
        </button>
      </div>

      {/* Tag list */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 flex-shrink-0">
          {[...tags].sort((a, b) => a.name.localeCompare(b.name)).map(tag => (
            <div
              key={tag.id}
              className="flex items-center gap-1 rounded-full pl-3 pr-1 py-1 text-sm font-medium border cursor-pointer transition-all hover:shadow-sm"
              style={{ borderColor: tag.color, color: tag.color, background: tag.color + '18' }}
              onClick={() => {
                const svg = svgRef.current!
                const rect = svg.getBoundingClientRect()
                const cx = rect.width / 2
                const cy = rect.height / 2
                setView({ tx: cx - tag.x, ty: cy - tag.y, scale: 1 })
                setHoveredId(tag.id)
              }}
            >
              {tag.parent_id && (
                <span className="opacity-50 text-xs">{tags.find(t => t.id === tag.parent_id)?.name} /</span>
              )}
              {tag.name}
              <button
                className="ml-1 w-5 h-5 rounded-full flex items-center justify-center hover:bg-red-100 hover:text-red-500 transition-colors"
                style={{ color: tag.color }}
                onClick={e => { e.stopPropagation(); deleteTag.mutate(tag.id) }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 rounded-xl border bg-muted/20 overflow-hidden relative">
        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{ cursor }}
          onMouseDown={onSvgMouseDown}
          onClick={onSvgClick}
        >
          <g transform={`translate(${view.tx}, ${view.ty}) scale(${view.scale})`}>
            {/* clipPath definitions */}
            <defs>
              {ordered.filter(t => t.url).map(tag => (
                <clipPath key={`clip-${tag.id}`} id={`clip-${tag.id}`}>
                  <circle cx={tag.x} cy={tag.y} r={tag.radius - 2} />
                </clipPath>
              ))}
            </defs>

            {ordered.map(tag => {
              const isEditing = editingId === tag.id
              const domain = tag.url ? tag.url.replace(/^https?:\/\//, '').split('/')[0] : null
              const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null
              const hasLogo = !!faviconUrl

              return (
                <g
                  key={tag.id}
                  onMouseDown={e => onBubbleMouseDown(e, tag)}
                  onMouseEnter={() => setHoveredId(tag.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{ cursor: 'grab' }}
                >
                  <circle cx={tag.x} cy={tag.y} r={tag.radius} fill="white" stroke={tag.color} strokeWidth={tag.parent_id ? 1.5 : 2.5} />

                  {hasLogo ? (
                    <image
                      href={faviconUrl!}
                      x={tag.x - tag.radius + 2}
                      y={tag.y - tag.radius + 2}
                      width={(tag.radius - 2) * 2}
                      height={(tag.radius - 2) * 2}
                      clipPath={`url(#clip-${tag.id})`}
                      preserveAspectRatio="xMidYMid slice"
                      style={{ pointerEvents: 'none' }}
                    />
                  ) : (
                    <circle cx={tag.x} cy={tag.y} r={tag.radius} fill={tag.color + '22'} style={{ pointerEvents: 'none' }} />
                  )}

                  {/* colored stroke overlay */}
                  <circle cx={tag.x} cy={tag.y} r={tag.radius} fill="none" stroke={tag.color} strokeWidth={tag.parent_id ? 1.5 : 2.5} />

                  {/* resize hit area */}
                  <circle cx={tag.x} cy={tag.y} r={tag.radius} fill="none" stroke="transparent" strokeWidth={BORDER_HIT * 2} style={{ cursor: 'ew-resize' }} />

                  {/* name label — only when no logo */}
                  {!isEditing && !hasLogo && (
                    <text
                      x={tag.x} y={tag.y}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={Math.min(14, tag.radius * 0.35)}
                      fontWeight="600"
                      fill={tag.color}
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {tag.name}
                    </text>
                  )}

                  {isEditing && (
                    <foreignObject x={tag.x - 70} y={tag.y - 16} width={140} height={32}>
                      <input
                        // @ts-ignore
                        xmlns="http://www.w3.org/1999/xhtml"
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEditName(); if (e.key === 'Escape') setEditingId(null) }}
                        onBlur={saveEditName}
                        className="w-full text-center text-sm font-medium bg-background border border-primary rounded px-2 py-1 outline-none"
                      />
                    </foreignObject>
                  )}
                </g>
              )
            })}

            {/* Action buttons above all bubbles */}
            {ordered.map(tag => (
              <g key={`actions-${tag.id}`} style={{ opacity: hoveredId === tag.id ? 1 : 0, pointerEvents: hoveredId === tag.id ? 'all' : 'none', transition: 'opacity 0.1s' }}>
                {/* Delete */}
                <g
                  transform={`translate(${tag.x + tag.radius * 0.7}, ${tag.y - tag.radius * 0.7})`}
                  onMouseEnter={() => setHoveredId(tag.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onMouseDown={e => { e.stopPropagation(); e.preventDefault(); deleteTag.mutate(tag.id) }}
                  style={{ cursor: 'pointer' }}
                >
                  <circle r={14} fill="white" stroke="#ef4444" strokeWidth={1.5} />
                  <text textAnchor="middle" dominantBaseline="middle" fontSize={13} fill="#ef4444" fontWeight="bold">✕</text>
                </g>
                {/* Edit */}
                <g
                  transform={`translate(${tag.x + tag.radius * 0.7}, ${tag.y - tag.radius * 0.7 + 34})`}
                  onMouseEnter={() => setHoveredId(tag.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onMouseDown={e => {
                    e.stopPropagation(); e.preventDefault()
                    setEditingTagId(tag.id)
                    setEditForm({ name: tag.name, description: tag.description ?? '', url: tag.url ?? '' })
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <circle r={14} fill="white" stroke="#6366f1" strokeWidth={1.5} />
                  <text textAnchor="middle" dominantBaseline="middle" fontSize={14} fill="#6366f1">✎</text>
                </g>
              </g>
            ))}

          </g>
        </svg>

        {/* Création flottante */}
        {creating && (() => {
          const svg = svgRef.current
          const rect = svg?.getBoundingClientRect()
          const sx = rect ? (creating.x * view.scale + view.tx + rect.left) : 0
          const sy = rect ? (creating.y * view.scale + view.ty + rect.top) : 0
          const panelW = 240
          const panelH = 148
          // position relative to the canvas div (not window)
          const canvasRect = svg?.parentElement?.getBoundingClientRect()
          const px = rect && canvasRect ? (creating.x * view.scale + view.tx) : 0
          const py = rect && canvasRect ? (creating.y * view.scale + view.ty) : 0
          return (
            <div
              className="absolute z-50 bg-background border rounded-xl shadow-xl p-3 flex flex-col gap-2"
              style={{ left: Math.min(px, (canvasRect?.width ?? 0) - panelW - 8), top: Math.min(py, (canvasRect?.height ?? 0) - panelH - 8), width: panelW }}
              onMouseDown={e => e.stopPropagation()}
            >
              <input
                ref={inputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') { setCreating(null); setNewName(''); setNewDesc(''); setNewUrl('') } }}
                placeholder="Nom du tag…"
                className="w-full text-sm bg-muted/40 border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') { setCreating(null); setNewName(''); setNewDesc(''); setNewUrl('') } }}
                placeholder="Description (optionnel)"
                className="w-full text-sm bg-muted/40 border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') { setCreating(null); setNewName(''); setNewDesc(''); setNewUrl('') } }}
                placeholder="URL (ex: uber.com)"
                className="w-full text-sm bg-muted/40 border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-2">
                <button onClick={confirmCreate} className="flex-1 text-sm bg-primary text-primary-foreground rounded px-3 py-1.5 font-medium hover:opacity-90">Créer</button>
                <button onClick={() => { setCreating(null); setNewName(''); setNewDesc(''); setNewUrl('') }} className="text-sm border rounded px-3 py-1.5 hover:bg-muted">Annuler</button>
              </div>
            </div>
          )
        })()}

        {/* Edit panel */}
        {editingTagId && (() => {
          const tag = tags.find(t => t.id === editingTagId)
          if (!tag) return null
          const svg = svgRef.current
          const canvasRect = svg?.parentElement?.getBoundingClientRect()
          const panelW = 240
          const panelH = 168
          const px = tag.x * view.scale + view.tx
          const py = tag.y * view.scale + view.ty
          const confirmEdit = () => {
            if (!editForm.name.trim()) return
            updateTag.mutate({ id: editingTagId, name: editForm.name.trim(), description: editForm.description || undefined, url: editForm.url || undefined })
            setEditingTagId(null)
          }
          return (
            <div
              className="absolute z-50 bg-background border rounded-xl shadow-xl p-3 flex flex-col gap-2"
              style={{ left: Math.min(px, (canvasRect?.width ?? 0) - panelW - 8), top: Math.min(py, (canvasRect?.height ?? 0) - panelH - 8), width: panelW }}
              onMouseDown={e => e.stopPropagation()}
            >
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Modifier le tag</p>
              <input
                autoFocus
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditingTagId(null) }}
                placeholder="Nom du tag…"
                className="w-full text-sm bg-muted/40 border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                value={editForm.description}
                onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditingTagId(null) }}
                placeholder="Description (optionnel)"
                className="w-full text-sm bg-muted/40 border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                value={editForm.url}
                onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditingTagId(null) }}
                placeholder="URL (ex: uber.com)"
                className="w-full text-sm bg-muted/40 border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-2">
                <button onClick={confirmEdit} className="flex-1 text-sm bg-primary text-primary-foreground rounded px-3 py-1.5 font-medium hover:opacity-90">Enregistrer</button>
                <button onClick={() => setEditingTagId(null)} className="text-sm border rounded px-3 py-1.5 hover:bg-muted">Annuler</button>
              </div>
            </div>
          )
        })()}

        {/* Tooltip sur hover */}
        {hoveredId && (() => {
          const tag = tags.find(t => t.id === hoveredId)
          if (!tag || (!tag.description && !tag.url)) return null
          const svg = svgRef.current
          const canvasRect = svg?.parentElement?.getBoundingClientRect()
          const px = (tag.x * view.scale + view.tx)
          const py = (tag.y * view.scale + view.ty) + tag.radius * view.scale + 8
          return (
            <div
              className="absolute z-40 bg-background border rounded-lg shadow-lg px-3 py-2 text-sm pointer-events-none max-w-[200px]"
              style={{ left: px, top: py, transform: 'translateX(-50%)' }}
            >
              {tag.description && <p className="text-muted-foreground">{tag.description}</p>}
              {tag.url && <a className="text-primary text-xs pointer-events-auto" href={tag.url.startsWith('http') ? tag.url : `https://${tag.url}`} target="_blank" rel="noreferrer">{tag.url}</a>}
            </div>
          )
        })()}

        {/* Zoom level indicator */}
        <div className="absolute bottom-3 right-3 text-xs text-muted-foreground bg-background/80 border rounded px-2 py-1 pointer-events-none">
          {Math.round(view.scale * 100)}%
        </div>

        {tags.length === 0 && !creating && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-muted-foreground">
              <div className="text-4xl mb-2 opacity-30">◎</div>
              <p className="font-medium">Cliquez n'importe où pour créer un tag</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
