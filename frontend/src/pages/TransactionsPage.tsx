import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Circle, Tag as TagIcon, X, Pencil, Check, Plus, Search } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

interface TagFlat { id: number; name: string; parent_id: number | null }
interface Transaction {
  id: number
  statement_id: number
  date: string
  label: string
  debit: string | null
  credit: string | null
  currency: string
  verified: boolean
  tags: { id: number; name: string }[]
}

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const AVATAR_COLORS = [
  '#7c3aed','#2563eb','#059669','#d97706','#dc2626',
  '#0891b2','#7c3aed','#db2777','#16a34a','#ea580c',
]
function avatarColor(label: string) {
  let h = 0; for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const diff = today.getTime() - d.getTime()
  if (diff < 86400000) return 'Aujourd\'hui'
  if (diff < 172800000) return 'Hier'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }).toUpperCase()
}

function buildPath(tags: TagFlat[], id: number): string {
  const tag = tags.find(t => t.id === id)
  if (!tag) return ''
  if (!tag.parent_id) return tag.name
  return `${buildPath(tags, tag.parent_id)} › ${tag.name}`
}

function getAncestors(tags: TagFlat[], id: number): number[] {
  const tag = tags.find(t => t.id === id)
  if (!tag || !tag.parent_id) return []
  return [...getAncestors(tags, tag.parent_id), tag.parent_id]
}

function TagPicker({ allTags, selectedIds, onChange, label = 'Ajouter un tag' }: {
  allTags: TagFlat[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = allTags.filter(t => buildPath(allTags, t.id).toLowerCase().includes(search.toLowerCase()))

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(x => x !== id))
    } else {
      const ancestors = getAncestors(allTags, id).filter(x => !selectedIds.includes(x))
      onChange([...selectedIds, ...ancestors, id])
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border rounded-md px-2 py-1"
      >
        <Plus className="h-3 w-3" /> {label}
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-64 rounded-xl border bg-card shadow-lg overflow-hidden">
          <div className="p-2 border-b">
            <Input autoFocus placeholder="Rechercher…" value={search}
              onChange={e => setSearch(e.target.value)} className="h-7 text-sm" />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0
              ? <p className="text-xs text-muted-foreground text-center py-4">Aucun résultat</p>
              : filtered.map(tag => {
                  const path = buildPath(allTags, tag.id)
                  const checked = selectedIds.includes(tag.id)
                  return (
                    <button key={tag.id} onClick={() => toggle(tag.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors ${checked ? 'bg-primary/10' : ''}`}
                    >
                      <div className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}>
                        {checked && <Check className="h-2.5 w-2.5 text-white" />}
                      </div>
                      <span className="truncate">{path}</span>
                    </button>
                  )
                })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function TransactionsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Transaction | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [tagFilter, setTagFilter] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [editDebit, setEditDebit] = useState('')
  const [editCredit, setEditCredit] = useState('')
  useEffect(() => {
    if (selected) {
      setEditDebit(selected.debit ?? '')
      setEditCredit(selected.credit ?? '')
      setEditing(false)
    }
  }, [selected?.id])

  const { data: allTags = [] } = useQuery<TagFlat[]>({
    queryKey: ['tags'],
    queryFn: () => api.get('/tags/').then(r => r.data),
  })

  const { data: transactions = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: () => api.get('/transactions/').then(r => r.data),
  })

  const visible = transactions.filter(tx => {
    if (search && !tx.label.toLowerCase().includes(search.toLowerCase()) && !new Date(tx.date).toLocaleDateString('fr-FR').includes(search)) return false
    if (tagFilter && !tx.tags?.some(t => t.id === tagFilter)) return false
    return true
  })

  const verify = useMutation({
    mutationFn: (id: number) => api.patch(`/transactions/${id}/verify`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  })

  const setTags = useMutation({
    mutationFn: ({ id, tag_ids }: { id: number; tag_ids: number[] }) =>
      api.patch(`/transactions/${id}/tags`, tag_ids).then(r => r.data),
    onSuccess: (updated: Transaction) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      setSelected(updated)
    },
  })

  const bulkSetTags = useMutation({
    mutationFn: async (tag_ids: number[]) => {
      await Promise.all([...checkedIds].map(id => api.patch(`/transactions/${id}/tags`, tag_ids)))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      setCheckedIds(new Set())
    },
  })

  const update = useMutation({
    mutationFn: ({ id, debit, credit }: { id: number; debit: string; credit: string }) =>
      api.patch(`/transactions/${id}`, {
        debit: debit ? parseFloat(debit) : null,
        credit: credit ? parseFloat(credit) : null,
      }).then(r => r.data),
    onSuccess: (updated: Transaction) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      setSelected(updated)
      setEditing(false)
    },
  })

  const fmt = (v: string | null) =>
    v == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(parseFloat(v))

  const toggleCheck = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allChecked = visible.length > 0 && visible.every(tx => checkedIds.has(tx.id))
  const toggleAll = () => {
    if (allChecked) setCheckedIds(new Set())
    else setCheckedIds(new Set(visible.map(tx => tx.id)))
  }

  // compute union of tags for bulk selection
  const bulkTagIds = checkedIds.size > 0
    ? [...checkedIds].reduce<number[]>((acc, id) => {
        const tx = transactions.find(t => t.id === id)
        return tx ? [...new Set([...acc, ...tx.tags.map(t => t.id)])] : acc
      }, [])
    : []

  return (
    <div className="flex h-[calc(100vh-7.5rem)] gap-4 overflow-hidden">
      {/* Table */}
      <div className={`flex flex-col gap-3 min-h-0 transition-all ${selected ? 'w-1/2' : 'w-full'}`}>

        {/* Header */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-2xl font-bold">Transactions</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{visible.length} transaction{visible.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Tag chips */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 flex-shrink-0">
            {[...allTags].sort((a, b) => a.name.localeCompare(b.name)).map(tag => {
              const isActiveFilter = tagFilter === tag.id
              const willTag = checkedIds.size > 0
              return (
                <button
                  key={tag.id}
                  onClick={() => {
                    if (willTag) {
                      // apply tag to all checked transactions
                      const ids = [...checkedIds]
                      Promise.all(ids.map(txId => {
                        const tx = transactions.find(t => t.id === txId)
                        if (!tx) return
                        const existing = tx.tags.map(t => t.id)
                        if (existing.includes(tag.id)) return
                        const ancestors = getAncestors(allTags, tag.id).filter(x => !existing.includes(x))
                        return api.patch(`/transactions/${txId}/tags`, [...existing, ...ancestors, tag.id])
                      })).then(() => { qc.invalidateQueries({ queryKey: ['transactions'] }); setCheckedIds(new Set()) })
                    } else {
                      setTagFilter(isActiveFilter ? null : tag.id)
                    }
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-all ${
                    isActiveFilter
                      ? 'opacity-100 shadow-sm scale-105'
                      : willTag
                      ? 'opacity-90 hover:scale-105 hover:shadow-sm'
                      : 'opacity-60 hover:opacity-100'
                  }`}
                  style={{
                    borderColor: 'hsl(var(--border))',
                    color: isActiveFilter ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                    background: isActiveFilter ? 'hsl(var(--foreground) / 0.08)' : 'transparent',
                  }}
                  title={willTag ? `Taguer la sélection avec "${tag.name}"` : `Filtrer par "${tag.name}"`}
                >
                  {tag.parent_id && <span className="opacity-50">{allTags.find(t => t.id === tag.parent_id)?.name} / </span>}
                  {tag.name}
                </button>
              )
            })}
            {tagFilter && (
              <button onClick={() => setTagFilter(null)} className="rounded-full px-2 py-0.5 text-xs text-muted-foreground border hover:bg-muted flex items-center gap-1">
                <X className="h-3 w-3" /> Effacer filtre
              </button>
            )}
          </div>
        )}

        {/* Search + bulk bar */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par libellé ou date…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {checkedIds.size > 0 && (
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-3 py-1.5 flex-shrink-0">
              <span className="text-sm font-medium text-primary">{checkedIds.size} sélectionnée{checkedIds.size > 1 ? 's' : ''}</span>
              <button onClick={() => setCheckedIds(new Set())} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-muted-foreground">
            <TagIcon className="h-10 w-10 mb-3 opacity-40" />
            <p className="font-medium">{search ? 'Aucun résultat' : 'Aucune transaction'}</p>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <div className="bg-card rounded-2xl overflow-hidden shadow-sm border border-border/50">
              {visible.map((tx, idx) => {
                const checked = checkedIds.has(tx.id)
                const isSelected = selected?.id === tx.id
                const isDebit = tx.debit != null
                const amount = isDebit ? tx.debit : tx.credit
                const amountColor = isDebit ? 'text-red-500' : 'text-blue-500'
                const fmtAmt = amount == null ? '—'
                  : `${isDebit ? '−' : '+'}${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(parseFloat(amount))} €`
                const color = avatarColor(tx.label)
                const initial = tx.label.trim()[0]?.toUpperCase() ?? '?'
                const topTag = tx.tags?.[0]?.name ?? null
                return (
                  <div key={tx.id}
                    onDoubleClick={() => setSelected(isSelected ? null : tx)}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${idx < visible.length - 1 ? 'border-b border-border/40' : ''} ${isSelected ? 'bg-primary/10' : checked ? 'bg-muted/60' : 'hover:bg-muted/40'}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => {}} onClick={e => toggleCheck(tx.id, e as unknown as React.MouseEvent)} className="accent-primary flex-shrink-0 opacity-40 hover:opacity-100 transition-opacity" />
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-xs font-bold select-none" style={{ background: color }}>
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate leading-tight text-foreground">{tx.label}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-muted-foreground">{new Date(tx.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
                        {topTag && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{topTag}</span>}
                      </div>
                    </div>
                    <p className={`font-semibold text-sm tabular-nums flex-shrink-0 ${amountColor}`}>{fmtAmt}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-1/2 flex flex-col gap-4 overflow-hidden border-l pl-4">
          <div className="flex items-start justify-between flex-shrink-0">
            <div>
              <p className="text-xs text-muted-foreground">{new Date(selected.date).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <h2 className="font-semibold mt-0.5 leading-tight">{selected.label}</h2>
              <div className="flex items-center gap-2 mt-2">
                {editing ? (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Débit</span>
                      <Input value={editDebit} onChange={e => setEditDebit(e.target.value)} className="w-24 h-7 text-sm" placeholder="0.00" />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Crédit</span>
                      <Input value={editCredit} onChange={e => setEditCredit(e.target.value)} className="w-24 h-7 text-sm" placeholder="0.00" />
                    </div>
                    <button onClick={() => update.mutate({ id: selected.id, debit: editDebit, credit: editCredit })} className="text-green-600 hover:text-green-700 p-1">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    {selected.debit && <span className="text-red-500 font-mono font-semibold">{fmt(selected.debit)}</span>}
                    {selected.credit && <span className="text-green-600 font-mono font-semibold">{fmt(selected.credit)}</span>}
                    <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground p-1 ml-1">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground p-1">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex gap-2 flex-wrap items-center flex-shrink-0">
            {selected.tags.map(tag => (
              <Badge key={tag.id} className="flex items-center gap-1 pr-1">
                {tag.name}
                <button onClick={() => setTags.mutate({ id: selected.id, tag_ids: selected.tags.filter(t => t.id !== tag.id).map(t => t.id) })} className="ml-0.5 hover:text-white/70">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <TagPicker
              allTags={allTags}
              selectedIds={selected.tags.map(t => t.id)}
              onChange={ids => setTags.mutate({ id: selected.id, tag_ids: ids })}
            />
          </div>

          {!selected.verified && (
            <Button size="sm" variant="outline" className="w-fit flex-shrink-0"
              onClick={() => verify.mutate(selected.id)} disabled={verify.isPending}>
              Marquer comme catégorisée
            </Button>
          )}

          <div className="flex-1 min-h-0">
            <p className="text-xs font-medium text-muted-foreground mb-2">PDF source</p>
            <iframe src={`${API}/statements/${selected.statement_id}/pdf`} className="w-full h-full rounded-xl border" title="PDF source" />
          </div>
        </div>
      )}
    </div>
  )
}
