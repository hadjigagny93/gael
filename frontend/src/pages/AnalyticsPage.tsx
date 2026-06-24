import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Brush,
  PieChart, Pie, Cell, Sankey, Rectangle,
} from 'recharts'
import api from '@/lib/api'

interface Tag { id: number; name: string; color: string; parent_id: number | null }
interface Transaction {
  id: number; date: string
  debit: string | null; credit: string | null
  tags: { id: number; name: string }[]
}

const fmtEur = (v: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)

const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M€`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k€`
  return `${v.toFixed(0)}€`
}

const PERIODS = [{ label: 'Tout', value: 'all' }] as const

const METRICS = [
  { label: 'Revenus', value: 'credit' as const, color: '#3b82f6' },
  { label: 'Dépenses', value: 'debit' as const, color: '#ef4444' },
]

type Metric = 'credit' | 'debit'
type Period = typeof PERIODS[number]['value']

const TOOLTIP_STYLE = {
  background: '#fff',
  border: '1px solid #e4e4e7',
  borderRadius: 10,
  fontSize: 12,
  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
}

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<Set<Metric>>(new Set(['credit']))

  const toggleMetric = (m: Metric) => setMetrics(prev => {
    const next = new Set(prev)
    if (next.has(m)) { if (next.size > 1) next.delete(m) } else next.add(m)
    return next
  })
  const [period, setPeriod] = useState<Period>('all')
  const [cumul, setCumul] = useState(true)

  const { data: transactions = [] } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: () => api.get('/transactions/').then(r => r.data),
  })
  const { data: allTags = [] } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn: () => api.get('/tags/').then(r => r.data),
  })

  const rootTags = allTags.filter(t => !t.parent_id)

  const filtered = useMemo(() => {
    const now = new Date()
    let from: Date | null = null
    if (period === '1m') from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
    return transactions.filter(tx => !from || new Date(tx.date) >= from)
  }, [transactions, period])

  // ── Totaux ──
  const totals = useMemo(() => {
    let credit = 0, debit = 0
    for (const tx of filtered) {
      if (tx.credit) credit += parseFloat(tx.credit)
      if (tx.debit) debit += parseFloat(tx.debit)
    }
    return { credit, debit, net: credit - debit }
  }, [filtered])

  // big number: if both selected show credit, else the selected one
  const primaryMetric: Metric = metrics.has('credit') ? 'credit' : 'debit'
  const bigNumber = totals[primaryMetric]

  // ── Grouper par mois ou par jour selon la période ──
  const chartData = useMemo(() => {
    const map: Record<string, { date: string; credit: number; debit: number; trendCredit: number; trendDebit: number }> = {}

    for (const tx of filtered) {
      const key = tx.date // YYYY-MM-DD
      if (!map[key]) map[key] = { date: key, credit: 0, debit: 0, trendCredit: 0, trendDebit: 0 }
      if (tx.credit) map[key].credit += parseFloat(tx.credit)
      if (tx.debit) map[key].debit += parseFloat(tx.debit)
    }

    const rows = Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)

    if (cumul) {
      let cc = 0, cd = 0
      rows.forEach(r => { cc += r.credit; cd += r.debit; r.credit = cc; r.debit = cd })
    }

    const valsC = rows.map(r => r.credit)
    const valsD = rows.map(r => r.debit)
    return rows.map((r, i) => {
      const sliceC = valsC.slice(Math.max(0, i - 2), i + 3)
      const sliceD = valsD.slice(Math.max(0, i - 2), i + 3)
      r.trendCredit = sliceC.reduce((a, b) => a + b, 0) / sliceC.length
      r.trendDebit = sliceD.reduce((a, b) => a + b, 0) / sliceD.length
      return r
    })
  }, [filtered, period, cumul])

  // ── Line chart par tag (dépenses) ──
  const tagChartData = useMemo(() => {
    const map: Record<string, Record<string, number> & { date: string }> = {}
    for (const tx of filtered) {
      if (!tx.debit) continue
      const key = tx.date
      if (!map[key]) map[key] = { date: key }
      for (const tag of tx.tags) {
        const t = allTags.find(t => t.id === tag.id)
        if (!t || t.parent_id) continue
        map[key][String(t.id)] = (map[key][String(t.id)] ?? 0) + parseFloat(tx.debit)
      }
    }
    const rows = Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
    if (cumul) {
      const acc: Record<string, number> = {}
      rows.forEach(r => {
        for (const tag of rootTags) {
          const k = String(tag.id)
          acc[k] = (acc[k] ?? 0) + (r[k] as number ?? 0)
          r[k] = acc[k]
        }
      })
    }
    return rows
  }, [filtered, allTags, rootTags, cumul])

  // ── Pie par tag (toujours sur les dépenses si sélectionnées, sinon revenus) ──
  const pieMetric: Metric = metrics.has('debit') ? 'debit' : 'credit'
  const pieData = useMemo(() => {
    const map: Record<number, { name: string; color: string; value: number }> = {}
    for (const tx of filtered) {
      const val = pieMetric === 'credit' ? (tx.credit ? parseFloat(tx.credit) : 0) : (tx.debit ? parseFloat(tx.debit) : 0)
      if (!val) continue
      for (const tag of tx.tags) {
        const t = allTags.find(t => t.id === tag.id)
        if (!t || t.parent_id) continue
        if (!map[t.id]) map[t.id] = { name: t.name, color: t.color ?? '#6366f1', value: 0 }
        map[t.id].value += val
      }
    }
    return Object.values(map).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [filtered, allTags, pieMetric])

  // ── Sankey: Revenus → tags racine → sous-tags ──
  const sankeyData = useMemo(() => {
    const rootTotals: Record<number, number> = {}
    const childTotals: Record<number, number> = {}
    let totalDebit = 0

    for (const tx of filtered) {
      if (!tx.debit) continue
      const amount = parseFloat(tx.debit)
      totalDebit += amount
      for (const tag of tx.tags) {
        const t = allTags.find(t => t.id === tag.id)
        if (!t) continue
        if (!t.parent_id) rootTotals[t.id] = (rootTotals[t.id] ?? 0) + amount
        else childTotals[t.id] = (childTotals[t.id] ?? 0) + amount
      }
    }

    const untagged = Math.max(0, totalDebit - Object.values(rootTotals).reduce((s, v) => s + v, 0))
    const activeRoots = rootTags.filter(t => rootTotals[t.id] > 0)
    const activeChildren = allTags.filter(t => t.parent_id && childTotals[t.id] > 0)

    const nodes: { name: string; color?: string }[] = []
    const nodeIndex: Record<string, number> = {}
    const addNode = (key: string, name: string, color?: string) => { nodeIndex[key] = nodes.length; nodes.push({ name, color }) }

    addNode('total', 'Dépenses', '#ef4444')
    for (const t of activeRoots) addNode(`r${t.id}`, t.name, t.color)
    if (untagged > 1) addNode('untagged', 'Non catégorisé', '#a1a1aa')
    for (const t of activeChildren) addNode(`c${t.id}`, t.name, allTags.find(p => p.id === t.parent_id)?.color)

    const links: { source: number; target: number; value: number }[] = []
    for (const t of activeRoots)
      links.push({ source: nodeIndex['total'], target: nodeIndex[`r${t.id}`], value: Math.round(rootTotals[t.id]) })
    if (untagged > 1)
      links.push({ source: nodeIndex['total'], target: nodeIndex['untagged'], value: Math.round(untagged) })
    for (const t of activeChildren)
      if (nodeIndex[`r${t.parent_id}`] !== undefined)
        links.push({ source: nodeIndex[`r${t.parent_id}`], target: nodeIndex[`c${t.id}`], value: Math.round(childTotals[t.id]) })

    return { nodes, links }
  }, [filtered, allTags, rootTags])

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-muted-foreground">
        <div className="text-5xl mb-4 opacity-20">📊</div>
        <p className="font-medium">Importez des relevés pour voir vos analytics</p>
      </div>
    )
  }

  const metricLabel = [...metrics].map(m => METRICS.find(x => x.value === m)?.label).join(' & ')

  return (
    <div className="flex flex-col gap-0 -m-8">

      {/* ── Hero section ── */}
      <div className="px-10 pt-10 pb-6">
        <div className="flex items-start justify-between mb-1">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Relevé de compte · {filtered.length} transactions
          </p>
        </div>

        {/* Big number + metric selector + period */}
        <div className="flex items-end justify-between">
          {/* Metric selector (left) — circular checkboxes horizontal */}
          <div className="flex items-center gap-5 pt-2">
            {METRICS.map(m => {
              const active = metrics.has(m.value)
              return (
                <label key={m.value} className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleMetric(m.value)}>
                  <div
                    className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0"
                    style={{ borderColor: m.color, background: active ? m.color : 'transparent' }}
                  >
                    {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <span className={`text-sm ${active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{m.label}</span>
                </label>
              )
            })}
          </div>

          {/* Big number (center) */}
          <div className="text-center flex-1 mx-8">
            <p className="text-[clamp(2.5rem,6vw,5rem)] font-bold tracking-tight leading-none tabular-nums">
              {fmtEur(Math.abs(bigNumber))}
            </p>
            <p className="text-sm text-muted-foreground mt-2">{metricLabel}</p>
          </div>

          {/* Period + cumul (right) */}
          <div className="flex items-center gap-4 text-sm">
            <button
              onClick={() => setCumul(c => !c)}
              className={`px-3 py-1 rounded transition-colors ${cumul ? 'font-semibold text-foreground border-b-2 border-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Cumulé
            </button>
          </div>
        </div>
      </div>

      {/* ── Main chart ── */}
      <div className="px-2 pb-0">
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              ticks={chartData.filter((d, i) => i === 0 || d.date.slice(0, 7) !== chartData[i - 1].date.slice(0, 7)).map(d => d.date)}
              tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={fmtShort}
              width={52}
            />
            <Tooltip
              formatter={(v: number) => [fmtEur(v), metricLabel]}
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
            />
            {metrics.has('credit') && (
              <Line type="monotone" dataKey="trendCredit" name="Tendance revenus" stroke="#3b82f6" strokeWidth={2} dot={false} />
            )}
            {metrics.has('debit') && (
              <Line type="monotone" dataKey="trendDebit" name="Tendance dépenses" stroke="#ef4444" strokeWidth={2} dot={false} />
            )}
            <Brush
              dataKey="date"
              height={40}
              travellerWidth={8}
              stroke="hsl(var(--border))"
              fill="hsl(var(--background))"
              tickFormatter={() => ''}
              traveller={({ x, y, width, height }: any) => (
                <rect x={x} y={y} width={width} height={height} rx={4} fill="hsl(var(--foreground))" />
              )}
            >
              <ComposedChart>
                {metrics.has('credit') && <Line dataKey="trendCredit" stroke="#3b82f6" dot={false} />}
                {metrics.has('debit') && <Line dataKey="trendDebit" stroke="#ef4444" dot={false} />}
              </ComposedChart>
            </Brush>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Separator ── */}
      <div className="border-t mx-10 mt-4" />

      {/* ── Tag chart ── */}
      {rootTags.length > 0 && tagChartData.length > 0 && (
        <div className="px-10 py-8">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-5">Dépenses par catégorie</p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={tagChartData} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                ticks={tagChartData.filter((d, i) => i === 0 || d.date.slice(0, 7) !== tagChartData[i - 1].date.slice(0, 7)).map(d => d.date)}
                tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={fmtShort} width={52} />
              <Tooltip formatter={(v: number, name: string) => [fmtEur(v), name]} contentStyle={TOOLTIP_STYLE} />
              {rootTags.map(tag => (
                <Line key={tag.id} type="monotone" dataKey={String(tag.id)} name={tag.name} stroke={tag.color ?? '#6366f1'} strokeWidth={2} dot={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Pie chart ── */}
      {pieData.length > 0 && (
        <>
          <div className="border-t mx-10" />
          <div className="px-10 py-8">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-5">Répartition des dépenses</p>
            <div className="flex items-center gap-12">
              <PieChart width={180} height={180}>
                <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={44}>
                  {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtEur(v)} contentStyle={TOOLTIP_STYLE} />
              </PieChart>
              <div className="flex flex-col gap-2.5 flex-1">
                {pieData.map(e => {
                  const total = pieData.reduce((s, x) => s + x.value, 0)
                  const pct = total ? ((e.value / total) * 100).toFixed(1) : '0'
                  return (
                    <div key={e.name} className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: e.color }} />
                      <span className="text-sm flex-1 truncate text-muted-foreground">{e.name}</span>
                      <span className="text-sm text-muted-foreground">{pct}%</span>
                      <span className="text-sm font-semibold w-24 text-right tabular-nums">{fmtEur(e.value)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Sankey ── */}
      {sankeyData.links.length > 0 && (
        <>
          <div className="border-t mx-10" />
          <div className="px-10 py-8">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-5">Flux de dépenses</p>
            <ResponsiveContainer width="100%" height={Math.max(260, sankeyData.nodes.length * 28)}>
              <Sankey
                data={sankeyData}
                nodePadding={16}
                nodeWidth={14}
                margin={{ top: 8, right: 140, bottom: 8, left: 8 }}
                node={({ x, y, width, height, index }: any) => {
                  const node = sankeyData.nodes[index]
                  return (
                    <g>
                      <Rectangle x={x} y={y} width={width} height={height} fill={node.color ?? '#6366f1'} fillOpacity={0.9} radius={3} />
                      <text x={x + width + 8} y={y + height / 2} dominantBaseline="middle" fontSize={12} fill="hsl(var(--foreground))">
                        {node.name}
                      </text>
                    </g>
                  )
                }}
                link={({ sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth, index }: any) => {
                  const node = sankeyData.nodes[sankeyData.links[index]?.source]
                  return (
                    <path
                      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                      fill="none"
                      stroke={node?.color ?? '#6366f1'}
                      strokeWidth={linkWidth}
                      strokeOpacity={0.2}
                    />
                  )
                }}
              >
                <Tooltip formatter={(v: number) => fmtEur(v)} contentStyle={TOOLTIP_STYLE} />
              </Sankey>
            </ResponsiveContainer>
          </div>
        </>
      )}

    </div>
  )
}
