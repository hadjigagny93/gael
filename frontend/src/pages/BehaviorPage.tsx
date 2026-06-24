import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer, ScatterChart, Scatter, Cell } from 'recharts'
import CalendarHeatmap from '@/components/CalendarHeatmap'
import api from '@/lib/api'

interface Transaction {
  id: number; date: string; label: string
  debit: string | null; credit: string | null
  tags: { id: number; name: string; color?: string }[]
}

interface Solde {
  id: number; statement_id: number; date: string
  value: string; type: 'crediteur' | 'debiteur'; kind: 'ouverture' | 'cloture'
}

const fmtEur = (v: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)

const fmtEurDec = (v: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(v)

export default function BehaviorPage() {
  const [heatmapDay, setHeatmapDay] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(5)
  const [zoomDomain, setZoomDomain] = useState<[number, number] | null>(null)
  const [clickStart, setClickStart] = useState<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [selectedYears, setSelectedYears] = useState<Set<string>>(new Set())

  const { data: transactions = [] } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: () => api.get('/transactions/').then(r => r.data),
  })

  const { data: soldes = [] } = useQuery<Solde[]>({
    queryKey: ['soldes'],
    queryFn: () => api.get('/soldes/').then(r => r.data),
  })

  const availableYears = useMemo(() => {
    const ys = new Set(transactions.map(t => t.date.slice(0, 4)))
    return [...ys].sort()
  }, [transactions])

  // empty selectedYears = "toutes"
  const activeYears = selectedYears.size === 0 ? new Set(availableYears) : selectedYears

  const transactions$ = useMemo(() =>
    transactions.filter(t => activeYears.has(t.date.slice(0, 4)))
  , [transactions, activeYears])

  const soldes$ = useMemo(() =>
    soldes.filter(s => activeYears.has(s.date.slice(0, 4)))
  , [soldes, activeYears])

  const toggleYear = (y: string) => {
    setZoomDomain(null)
    setHeatmapDay(null)
    setSelectedYears(prev => {
      const next = new Set(prev)
      if (next.has(y)) next.delete(y)
      else next.add(y)
      return next
    })
  }

  const selectAll = () => { setZoomDomain(null); setHeatmapDay(null); setSelectedYears(new Set()) }

  // ── Heatmap ──
  const heatmapData = useMemo(() => {
    const map: Record<string, { count: number; amount: number }> = {}
    for (const tx of transactions$) {
      if (!tx.debit) continue
      if (!map[tx.date]) map[tx.date] = { count: 0, amount: 0 }
      map[tx.date].count += 1
      map[tx.date].amount += parseFloat(tx.debit)
    }
    return Object.entries(map).map(([date, v]) => ({ date, ...v }))
  }, [transactions$])

  const heatmapDayTxs = useMemo(() =>
    heatmapDay ? transactions$.filter(tx => tx.date === heatmapDay && tx.debit) : [],
    [transactions$, heatmapDay]
  )

  // ── Découverts ──
  const decouvertData = useMemo(() => {
    if (soldes$.length === 0) return { series: [], days: [], totalDays: 0, minBalance: 0 }

    const anchors = [...soldes$]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => ({ date: s.date, balance: s.type === 'debiteur' ? -parseFloat(s.value) : parseFloat(s.value) }))

    const flowByDate: Record<string, number> = {}
    for (const tx of transactions$) {
      const debit = tx.debit ? parseFloat(tx.debit) : 0
      const credit = tx.credit ? parseFloat(tx.credit) : 0
      flowByDate[tx.date] = (flowByDate[tx.date] ?? 0) + credit - debit
    }

    const anchorByDate: Record<string, number> = {}
    for (const s of soldes$) {
      anchorByDate[s.date] = s.type === 'debiteur' ? -parseFloat(s.value) : parseFloat(s.value)
    }

    const datesToPlot = [...new Set<string>([
      ...anchors.map(a => a.date),
      ...transactions$.map(t => t.date),
    ])].sort()

    const balanceByDate: Record<string, number> = {}
    let runningBalance = anchors[0]?.balance ?? 0
    let anchorIdx = 0

    for (const date of datesToPlot) {
      while (anchorIdx + 1 < anchors.length && anchors[anchorIdx + 1].date <= date) {
        anchorIdx++
        runningBalance = anchors[anchorIdx].balance
      }
      if (anchorByDate[date] !== undefined) {
        runningBalance = anchorByDate[date]
      } else {
        runningBalance += flowByDate[date] ?? 0
      }
      balanceByDate[date] = runningBalance
    }

    const series = datesToPlot.map(date => ({
      date,
      ts: new Date(date + 'T00:00:00').getTime(),
      balance: Math.round(balanceByDate[date] * 100) / 100,
      anchor: anchorByDate[date] !== undefined ? Math.round(anchorByDate[date] * 100) / 100 : null,
      label: new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }),
    }))

    const overdraftDays = series.filter(d => d.balance < 0)
    const minBalance = series.length ? Math.min(...series.map(d => d.balance)) : 0

    return { series, days: overdraftDays, totalDays: overdraftDays.length, minBalance }
  }, [soldes$, transactions$])

  // ── Dépenses fantômes ──
  const ghost = useMemo(() => {
    const ghosts = transactions$.filter(tx => tx.debit && parseFloat(tx.debit) < threshold)

    const total = ghosts.reduce((s, tx) => s + parseFloat(tx.debit!), 0)

    const dates = transactions$.filter(tx => tx.debit).map(tx => tx.date).sort()
    const rangeMonths = dates.length > 1
      ? Math.max(1, (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (1000 * 60 * 60 * 24 * 30))
      : 1
    const monthlyAvg = total / rangeMonths
    const yearlyProjection = monthlyAvg * 12

    const byTag: Record<string, { name: string; color: string; total: number; count: number }> = {}
    for (const tx of ghosts) {
      if (tx.tags.length === 0) {
        byTag['__none__'] = byTag['__none__'] ?? { name: 'Non catégorisé', color: '#94a3b8', total: 0, count: 0 }
        byTag['__none__'].total += parseFloat(tx.debit!)
        byTag['__none__'].count += 1
      }
      for (const t of tx.tags) {
        byTag[t.id] = byTag[t.id] ?? { name: t.name, color: t.color ?? '#6366f1', total: 0, count: 0 }
        byTag[t.id].total += parseFloat(tx.debit!)
        byTag[t.id].count += 1
      }
    }
    const tagList = Object.values(byTag).sort((a, b) => b.total - a.total)

    return { ghosts, total, monthlyAvg, yearlyProjection, tagList, count: ghosts.length }
  }, [transactions$, threshold])

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Comportement</h1>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-24 text-muted-foreground">
          <div className="text-4xl mb-3 opacity-30">🧠</div>
          <p className="font-medium">Importez des relevés pour analyser votre comportement</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Comportement</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Analyse de vos habitudes de dépense</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            onClick={selectAll}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${selectedYears.size === 0 ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground border-transparent hover:border-border'}`}
          >
            Toutes
          </button>
          {availableYears.map(y => (
            <button
              key={y}
              onClick={() => toggleYear(y)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${selectedYears.has(y) ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground border-transparent hover:border-border'}`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Heatmap des dépenses</h2>
        <CalendarHeatmap data={heatmapData} selectedDate={heatmapDay} onDayClick={setHeatmapDay} />
        {heatmapDay && heatmapDayTxs.length > 0 && (
          <div className="border-t pt-3 flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {new Date(heatmapDay).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' · '}{heatmapDayTxs.length} transaction{heatmapDayTxs.length > 1 ? 's' : ''}
              {' · '}<span className="text-red-500">{fmtEur(heatmapDayTxs.reduce((s, tx) => s + parseFloat(tx.debit!), 0))}</span>
            </p>
            {heatmapDayTxs.map(tx => (
              <div key={tx.id} className="flex items-center justify-between gap-4 text-sm">
                <span className="truncate">{tx.label}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {tx.tags.map(t => (
                    <span key={t.id} className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{t.name}</span>
                  ))}
                  <span className="font-mono text-red-500 font-medium">{fmtEurDec(parseFloat(tx.debit!))}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Solde au cours du temps */}
      {soldes.length > 0 && (
        <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Solde au cours du temps</h2>
              <p className="text-xs text-muted-foreground mt-1">Reconstitué à partir des soldes de relevés + transactions.</p>
            </div>
            <div className="flex gap-3 text-right">
              {decouvertData.totalDays > 0 && (
                <div>
                  <p className="text-xs text-red-500 font-semibold">{decouvertData.totalDays} jour{decouvertData.totalDays > 1 ? 's' : ''} dans le rouge</p>
                  <p className="text-xs text-muted-foreground">min : {fmtEurDec(decouvertData.minBalance)}</p>
                </div>
              )}
              {decouvertData.totalDays === 0 && decouvertData.series.length > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400 font-semibold">Aucun découvert ✓</p>
              )}
            </div>
          </div>

          {decouvertData.series.length > 0 && (
            <>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-0.5 bg-indigo-500 rounded" /> Solde théorique</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-amber-600" /> Solde PDF réel</span>
              </div>
              <div className="flex items-center justify-between mb-1 min-h-[22px]">
                {clickStart !== null ? (
                  <span className="text-xs text-indigo-400">Cliquez pour définir la fin de la sélection</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Cliquez deux fois pour zoomer sur une période</span>
                )}
                {zoomDomain && (
                  <button
                    onClick={() => { setZoomDomain(null); setClickStart(null); setHoverIdx(null) }}
                    className="text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-0.5 transition-colors"
                  >
                    Réinitialiser le zoom
                  </button>
                )}
              </div>
              <ResponsiveContainer width="100%" height={240}>
                {(() => {
                  const series = decouvertData.series
                  const allTs = series.map(d => d.ts)
                  const [tsMin, tsMax] = zoomDomain ?? [Math.min(...allTs), Math.max(...allTs)]
                  const visible = series.filter(d => d.ts >= tsMin && d.ts <= tsMax)

                  // Pick ~7 evenly spaced ticks across the time domain
                  const tickCount = 7
                  const ticks = Array.from({ length: tickCount }, (_, i) =>
                    Math.round(tsMin + i * (tsMax - tsMin) / (tickCount - 1))
                  )

                  return (
                    <ScatterChart
                      margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                      style={{ cursor: clickStart !== null ? 'crosshair' : 'default' }}
                      onClick={(e: any) => {
                        const ts = e?.activePayload?.[0]?.payload?.ts
                        if (ts === undefined) return
                        if (clickStart === null) {
                          setClickStart(ts)
                        } else {
                          const [a, b] = [clickStart, ts].sort((x, y) => x - y)
                          if (a !== b) setZoomDomain([a, b])
                          setClickStart(null)
                          setHoverIdx(null)
                        }
                      }}
                      onMouseMove={(e: any) => {
                        const ts = e?.activePayload?.[0]?.payload?.ts
                        if (ts !== undefined) setHoverIdx(ts)
                      }}
                      onMouseLeave={() => setHoverIdx(null)}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        scale="time"
                        domain={[tsMin, tsMax]}
                        ticks={ticks}
                        tickFormatter={ts => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}
                        tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                      />
                      <YAxis
                        dataKey="balance"
                        type="number"
                        tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.4 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={v => `${v}€`}
                        width={64}
                      />
                      <Tooltip
                        cursor={{ strokeDasharray: '4 4', stroke: 'currentColor', strokeOpacity: 0.15 }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          const neg = d.balance < 0
                          const drift = d.anchor !== null ? d.balance - d.anchor : null
                          return (
                            <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-lg space-y-0.5">
                              <p className="text-muted-foreground font-medium">{d.label}</p>
                              <p className={`font-mono ${neg ? 'text-red-500' : ''}`}>
                                Solde : <span className="font-semibold">{fmtEurDec(d.balance)}</span>
                              </p>
                              {d.anchor !== null && (
                                <>
                                  <p className="font-mono text-amber-500">
                                    PDF réel : <span className="font-semibold">{fmtEurDec(d.anchor)}</span>
                                  </p>
                                  {drift !== null && Math.abs(drift) > 0.01 && (
                                    <p className={`font-mono ${Math.abs(drift) > 10 ? 'text-red-400' : 'text-muted-foreground'}`}>
                                      Écart : {drift > 0 ? '+' : ''}{fmtEurDec(drift)}
                                    </p>
                                  )}
                                </>
                              )}
                              {neg && <p className="text-red-400">Découvert</p>}
                            </div>
                          )
                        }}
                      />
                      <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.6} />
                      <Scatter data={visible} isAnimationActive={false}>
                        {visible.map((d, i) => (
                          <Cell
                            key={i}
                            fill={d.anchor !== null ? '#f59e0b' : d.balance < 0 ? '#ef4444' : '#6366f1'}
                            opacity={d.anchor !== null ? 1 : 0.7}
                            r={d.anchor !== null ? 5 : 3}
                          />
                        ))}
                      </Scatter>
                      {clickStart !== null && hoverIdx !== null && (
                        <ReferenceArea
                          x1={Math.min(clickStart, hoverIdx)}
                          x2={Math.max(clickStart, hoverIdx)}
                          stroke="#6366f1"
                          strokeOpacity={0.4}
                          fill="#6366f1"
                          fillOpacity={0.08}
                        />
                      )}
                      {clickStart !== null && (
                        <ReferenceLine x={clickStart} stroke="#6366f1" strokeDasharray="3 3" strokeOpacity={0.7} />
                      )}
                    </ScatterChart>
                  )
                })()}
              </ResponsiveContainer>
            </>
          )}

          {decouvertData.totalDays > 0 && (
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1 select-none">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                Voir les {decouvertData.totalDays} jours de découvert
              </summary>
              <div className="mt-2 flex flex-col gap-1 max-h-40 overflow-y-auto">
                {decouvertData.days.map(d => (
                  <div key={d.date} className="flex items-center justify-between text-sm py-0.5">
                    <span className="text-xs text-muted-foreground">
                      {new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                    <span className="font-mono text-xs font-medium text-red-500">{fmtEurDec(d.balance)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Dépenses fantômes */}
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Dépenses fantômes</h2>
          <p className="text-xs text-muted-foreground mt-1">Les micro-paiements invisibles au quotidien qui s'accumulent sans qu'on s'en rende compte.</p>
        </div>

        {/* Slider */}
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground w-20 flex-shrink-0">Seuil : <span className="font-semibold text-foreground">{threshold} €</span></span>
          <input
            type="range" min={1} max={20} step={1} value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="text-xs text-muted-foreground w-8">20 €</span>
        </div>

        {/* KPIs */}
        {ghost.count === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Aucune dépense sous {threshold} €</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/40 p-4 flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">Transactions</p>
                <p className="text-2xl font-bold">{ghost.count}</p>
                <p className="text-xs text-muted-foreground">en dessous de {threshold} €</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-4 flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">Moy. mensuelle</p>
                <p className="text-2xl font-bold text-amber-500">{fmtEur(ghost.monthlyAvg)}</p>
                <p className="text-xs text-muted-foreground">de micro-paiements</p>
              </div>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 flex flex-col gap-1">
                <p className="text-xs text-amber-600 dark:text-amber-400">Projection annuelle</p>
                <p className="text-2xl font-bold text-amber-500">{fmtEur(ghost.yearlyProjection)}</p>
                <p className="text-xs text-amber-600 dark:text-amber-400">que vous ne voyez pas passer</p>
              </div>
            </div>

            {/* By tag */}
            {ghost.tagList.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Répartition par catégorie</p>
                {ghost.tagList.map(tag => {
                  const pct = ghost.total > 0 ? (tag.total / ghost.total) * 100 : 0
                  return (
                    <div key={tag.name} className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: tag.color }} />
                      <span className="text-sm w-32 truncate">{tag.name}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: tag.color }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-8 text-right">{Math.round(pct)}%</span>
                      <span className="text-sm font-medium w-16 text-right">{fmtEur(tag.total)}</span>
                      <span className="text-xs text-muted-foreground w-20 text-right">{tag.count} opération{tag.count > 1 ? 's' : ''}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Liste des transactions fantômes */}
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1 select-none">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                Voir les {ghost.count} transactions
              </summary>
              <div className="mt-2 flex flex-col gap-1 max-h-48 overflow-y-auto">
                {ghost.ghosts.sort((a, b) => parseFloat(b.debit!) - parseFloat(a.debit!)).map(tx => (
                  <div key={tx.id} className="flex items-center justify-between gap-4 text-sm py-0.5">
                    <span className="text-xs text-muted-foreground w-20 flex-shrink-0">
                      {new Date(tx.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                    </span>
                    <span className="truncate flex-1 text-xs">{tx.label}</span>
                    <span className="font-mono text-xs font-medium flex-shrink-0">{fmtEurDec(parseFloat(tx.debit!))}</span>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
