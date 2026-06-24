import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { TrendingUp, TrendingDown, X } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

interface Solde {
  id: number
  statement_id: number
  date: string
  value: number
  type: 'crediteur' | 'debiteur'
  kind: 'ouverture' | 'cloture'
  bank_name: string
  bank_color: string
}

export default function SoldesPage() {
  const [selected, setSelected] = useState<Solde | null>(null)

  const { data: soldes = [], isLoading } = useQuery<Solde[]>({
    queryKey: ['soldes'],
    queryFn: () => api.get('/soldes/').then(r => r.data),
  })

  const fmt = (v: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v)

  const grouped = soldes.reduce<Record<string, Solde[]>>((acc, s) => {
    const key = s.bank_name
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})

  if (isLoading) return <div className="text-muted-foreground text-sm">Chargement…</div>

  if (soldes.length === 0)
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2 text-muted-foreground">
        <p className="text-sm">Aucun solde enregistré.</p>
        <p className="text-xs">Les soldes sont extraits automatiquement lors de l'import des relevés PDF.</p>
      </div>
    )

  return (
    <div className="flex h-[calc(100vh-7.5rem)] gap-4 overflow-hidden">
      {/* Left: list */}
      <div className={`flex flex-col gap-6 overflow-y-auto min-h-0 ${selected ? 'w-1/2' : 'w-full max-w-3xl mx-auto'}`}>
        <div>
          <h1 className="text-2xl font-bold">Soldes</h1>
          <p className="text-muted-foreground text-sm mt-1">Double-cliquez sur une ligne pour voir le relevé PDF.</p>
        </div>

        {Object.entries(grouped).map(([bankName, entries]) => {
          const color = entries[0]?.bank_color ?? '#6366f1'
          const latest = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0]
          const sorted = [...entries].sort(
            (a, b) => a.date.localeCompare(b.date) || (a.kind === 'ouverture' ? -1 : 1)
          )

          return (
            <div key={bankName} className="rounded-xl border bg-card overflow-hidden flex-shrink-0">
              <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="font-semibold">{bankName}</span>
                </div>
                {latest && (
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="text-muted-foreground text-xs">dernier solde</span>
                    <span className={`font-mono font-semibold ${latest.type === 'crediteur' ? 'text-green-600' : 'text-red-500'}`}>
                      {fmt(latest.value)}
                    </span>
                  </div>
                )}
              </div>

              <div className="divide-y">
                {sorted.map(s => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between px-5 py-3 transition-colors cursor-pointer select-none ${
                      selected?.id === s.id ? 'bg-primary/10' : 'hover:bg-muted/30'
                    }`}
                    onDoubleClick={() => setSelected(prev => prev?.id === s.id ? null : s)}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                        s.kind === 'ouverture'
                          ? 'bg-blue-500/10 text-blue-600'
                          : 'bg-violet-500/10 text-violet-600'
                      }`}>
                        {s.kind === 'ouverture' ? 'Ouverture' : 'Clôture'}
                      </span>
                      <span className="text-sm text-muted-foreground font-mono">
                        {new Date(s.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.type === 'crediteur'
                        ? <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                        : <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                      }
                      <span className={`font-mono font-semibold text-sm ${s.type === 'crediteur' ? 'text-green-600' : 'text-red-500'}`}>
                        {fmt(s.value)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Right: PDF panel */}
      {selected && (
        <div className="w-1/2 flex flex-col gap-4 overflow-hidden border-l pl-4">
          <div className="flex items-start justify-between flex-shrink-0">
            <div>
              <p className="text-xs text-muted-foreground">
                {new Date(selected.date).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
              <h2 className="font-semibold mt-0.5">{selected.bank_name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                  selected.kind === 'ouverture' ? 'bg-blue-500/10 text-blue-600' : 'bg-violet-500/10 text-violet-600'
                }`}>
                  {selected.kind === 'ouverture' ? 'Ouverture' : 'Clôture'}
                </span>
                <span className={`font-mono font-semibold ${selected.type === 'crediteur' ? 'text-green-600' : 'text-red-500'}`}>
                  {fmt(selected.value)}
                </span>
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground p-1">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0">
            <p className="text-xs font-medium text-muted-foreground mb-2">PDF source</p>
            <iframe
              src={`${API_URL}/statements/${selected.statement_id}/pdf`}
              className="w-full h-full rounded-xl border"
              title="Relevé bancaire"
            />
          </div>
        </div>
      )}
    </div>
  )
}
