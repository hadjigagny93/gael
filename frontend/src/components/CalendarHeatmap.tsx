import { useState, useMemo } from 'react'

interface DayData {
  date: string // YYYY-MM-DD
  count: number
  amount: number
}

interface Props {
  data: DayData[]
  onDayClick?: (date: string | null) => void
  selectedDate?: string | null
}

const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

const HEATMAP_STOPS = [
  [0.00, [30,  80, 180]],
  [0.25, [0,  200, 200]],
  [0.50, [60, 220,  60]],
  [0.75, [255, 200,   0]],
  [1.00, [220,   0,   0]],
] as [number, [number, number, number]][]

function colorForValue(value: number, max: number): string {
  if (value === 0 || max === 0) return 'hsl(var(--muted))'
  const t = Math.pow(Math.min(value / max, 1), 0.6)
  let lo = HEATMAP_STOPS[0], hi = HEATMAP_STOPS[HEATMAP_STOPS.length - 1]
  for (let i = 0; i < HEATMAP_STOPS.length - 1; i++) {
    if (t >= HEATMAP_STOPS[i][0] && t <= HEATMAP_STOPS[i + 1][0]) {
      lo = HEATMAP_STOPS[i]; hi = HEATMAP_STOPS[i + 1]; break
    }
  }
  const range = hi[0] - lo[0]
  const tt = range === 0 ? 0 : (t - lo[0]) / range
  const [r, g, b] = lo[1].map((c, i) => Math.round(lerp(c, hi[1][i], tt)))
  return `rgb(${r},${g},${b})`
}

const fmtEur = (v: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)

function weekOfYear(date: Date): number {
  const jan1 = new Date(date.getFullYear(), 0, 1)
  const jan1Dow = (jan1.getDay() + 6) % 7
  const dayOfYear = Math.floor((date.getTime() - jan1.getTime()) / 86400000)
  return Math.floor((dayOfYear + jan1Dow) / 7)
}

function dayOfWeek(date: Date): number { return (date.getDay() + 6) % 7 }

const CELL = 12
const GAP = 2
const step = CELL + GAP
const LEFT_PAD = 22
const TOP_PAD = 16
const VB_W = LEFT_PAD + 53 * step   // ~736
const VB_H = TOP_PAD + 7 * step     // ~114

function YearSvg({
  year, grid, byDate, mode, max, selectedDate, onDayClick, onHover, onLeave,
}: {
  year: string
  grid: (string | null)[][]
  byDate: Record<string, DayData>
  mode: 'count' | 'amount'
  max: number
  selectedDate?: string | null
  onDayClick?: (date: string) => void
  onHover?: (e: React.MouseEvent, day: DayData) => void
  onLeave?: () => void
}) {
  const monthLabels: { weekIdx: number; label: string }[] = []
  let lastMonth = -1
  grid.forEach((week, wi) => {
    const first = week.find(d => d !== null)
    if (!first) return
    const m = new Date(first).getMonth()
    if (m !== lastMonth) { monthLabels.push({ weekIdx: wi, label: MONTHS[m] }); lastMonth = m }
  })

  return (
    <div className="rounded-xl border bg-card p-3 flex flex-col gap-1">
      <p className="text-sm font-semibold">{year}</p>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        style={{ display: 'block' }}
      >
        {/* month labels */}
        {monthLabels.map(({ weekIdx, label }) => (
          <text key={label} x={LEFT_PAD + weekIdx * step} y={10}
            fontSize={8} fill="currentColor" opacity={0.5}>{label}</text>
        ))}
        {/* day labels */}
        {DAYS.map((d, di) => di % 2 === 0 ? (
          <text key={di} x={LEFT_PAD - 4} y={TOP_PAD + di * step + CELL * 0.8}
            fontSize={8} fill="currentColor" opacity={0.5} textAnchor="end">{d}</text>
        ) : null)}
        {/* cells */}
        {grid.map((week, wi) =>
          week.map((date, di) => {
            if (!date) return null
            const day = byDate[date]
            const val = day ? (mode === 'count' ? day.count : day.amount) : 0
            const color = colorForValue(val, max)
            const isSelected = selectedDate === date
            return (
              <rect
                key={`${wi}-${di}`}
                x={LEFT_PAD + wi * step}
                y={TOP_PAD + di * step}
                width={CELL}
                height={CELL}
                rx={2}
                fill={color}
                stroke={isSelected ? 'hsl(var(--primary))' : 'transparent'}
                strokeWidth={1.5}
                style={{ cursor: day ? 'pointer' : 'default' }}
                onClick={() => day && onDayClick?.(isSelected ? '' : date)}
                onMouseEnter={e => day && onHover?.(e, day)}
                onMouseLeave={() => onLeave?.()}
              />
            )
          })
        )}
      </svg>
    </div>
  )
}

export default function CalendarHeatmap({ data, onDayClick, selectedDate }: Props) {
  const [mode, setMode] = useState<'count' | 'amount'>('amount')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; day: DayData } | null>(null)

  const byDate = useMemo(() => {
    const m: Record<string, DayData> = {}
    for (const d of data) m[d.date] = d
    return m
  }, [data])

  const years = useMemo(() => {
    const ys = new Set(data.map(d => d.date.slice(0, 4)))
    return [...ys].sort()
  }, [data])

  const max = useMemo(() =>
    Math.max(1, ...data.map(d => mode === 'count' ? d.count : d.amount))
  , [data, mode])

  const yearGrids = useMemo(() => {
    return years.map(y => {
      const grid: (string | null)[][] = Array.from({ length: 53 }, () => Array(7).fill(null))
      const end = new Date(`${y}-12-31`)
      let cur = new Date(`${y}-01-01`)
      while (cur <= end) {
        const iso = cur.toISOString().slice(0, 10)
        const wi = weekOfYear(cur)
        const di = dayOfWeek(cur)
        if (wi < 53) grid[wi][di] = iso
        cur.setDate(cur.getDate() + 1)
      }
      return { year: y, grid }
    })
  }, [years])

  return (
    <div className="flex flex-col gap-3">
      {/* controls */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 rounded-lg border p-0.5 text-xs">
          {[['amount', 'Montant'], ['count', 'Nb transactions']].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v as any)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${mode === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {l}
            </button>
          ))}
        </div>
        {selectedDate && (
          <button onClick={() => onDayClick?.(null)} className="text-xs text-muted-foreground hover:text-foreground underline ml-auto">
            Effacer sélection
          </button>
        )}
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-2 gap-4">
        {yearGrids.map(({ year, grid }) => (
          <YearSvg
            key={year}
            year={year}
            grid={grid}
            byDate={byDate}
            mode={mode}
            max={max}
            selectedDate={selectedDate}
            onDayClick={d => onDayClick?.(d || null)}
            onHover={(e, day) => {
              setTooltip({ x: e.clientX + 12, y: e.clientY - 40, day })
            }}
            onLeave={() => setTooltip(null)}
          />
        ))}
      </div>

      {/* legend */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Moins</span>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <div key={t} style={{ width: 12, height: 12, borderRadius: 2, background: colorForValue(t * max, max) }} />
        ))}
        <span>Plus</span>
      </div>

      {/* tooltip */}
      {tooltip && (
        <div className="fixed z-50 bg-card border rounded-lg shadow-xl px-3 py-2 text-sm pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}>
          <p className="font-medium">{new Date(tooltip.day.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p className="text-muted-foreground">{tooltip.day.count} transaction{tooltip.day.count > 1 ? 's' : ''}</p>
          <p className="text-red-500 font-mono">{fmtEur(tooltip.day.amount)}</p>
        </div>
      )}
    </div>
  )
}
