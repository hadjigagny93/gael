import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Map from 'react-map-gl/maplibre'
import DeckGL from '@deck.gl/react'
import { ScatterplotLayer } from '@deck.gl/layers'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import 'maplibre-gl/dist/maplibre-gl.css'
import api from '@/lib/api'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

interface MappedTx {
  id: number
  label: string
  date: string
  debit: string | null
  credit: string | null
  location: string
  lat: number
  lng: number
  tags: { id: number; name: string; color: string }[]
}

function hexToRgb(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b, 180]
}

function groupByLocation(txs: MappedTx[]) {
  const acc: Record<string, { location: string; lat: number; lng: number; total: number; count: number; tags: MappedTx['tags'] }> = {}
  for (const tx of txs) {
    const key = tx.location
    if (!acc[key]) acc[key] = { location: tx.location, lat: tx.lat, lng: tx.lng, total: 0, count: 0, tags: tx.tags }
    acc[key].total += tx.debit ? parseFloat(tx.debit) : 0
    acc[key].count += 1
    if (tx.tags.length && !acc[key].tags.length) acc[key].tags = tx.tags
  }
  return Object.values(acc)
}

const fmtEur = (v: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)

export default function MapsPage() {
  const [mode, setMode] = useState<'points' | 'heatmap'>('points')
  const [hovered, setHovered] = useState<{ object: any; x: number; y: number } | null>(null)

  const { data: txs = [] } = useQuery<MappedTx[]>({
    queryKey: ['mapped-transactions'],
    queryFn: () => api.get('/transactions/mapped').then(r => r.data),
  })

  const groups = useMemo(() => groupByLocation(txs), [txs])
  const maxTotal = useMemo(() => Math.max(1, ...groups.map(g => g.total)), [groups])

  const initialViewState = useMemo(() => {
    if (!groups.length) return { longitude: 2.3522, latitude: 48.8566, zoom: 11, pitch: 40 }
    const lng = groups.reduce((s, g) => s + g.lng, 0) / groups.length
    const lat = groups.reduce((s, g) => s + g.lat, 0) / groups.length
    return { longitude: lng, latitude: lat, zoom: 12, pitch: 40, bearing: 0 }
  }, [groups])

  const layers = mode === 'heatmap'
    ? [
        new HeatmapLayer({
          id: 'heatmap',
          data: groups,
          getPosition: (d: any) => [d.lng, d.lat],
          getWeight: (d: any) => d.total,
          radiusPixels: 60,
          intensity: 1,
          threshold: 0.05,
          colorRange: [
            [0, 0, 128, 0],
            [0, 0, 255, 80],
            [0, 200, 200, 140],
            [60, 220, 60, 180],
            [255, 200, 0, 220],
            [220, 0, 0, 255],
          ],
        }),
      ]
    : [
        new ScatterplotLayer({
          id: 'scatter',
          data: groups,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: (d: any) => 20 + (d.total / maxTotal) * 180,
          getFillColor: (d: any) => hexToRgb(d.tags[0]?.color ?? '#6366f1'),
          getLineColor: (d: any) => { const c = hexToRgb(d.tags[0]?.color ?? '#6366f1'); c[3] = 255; return c },
          lineWidthMinPixels: 1,
          stroked: true,
          pickable: true,
          radiusUnits: 'meters',
          onHover: (info: any) => setHovered(info.object ? { object: info.object, x: info.x, y: info.y } : null),
        }),
      ]

  if (txs.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Maps</h1>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-24 text-muted-foreground">
          <p className="font-medium">Aucune transaction localisée</p>
          <p className="text-sm mt-1">Ajoutez un lieu depuis le panneau de détail d'une transaction.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Maps</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{groups.length} lieu{groups.length > 1 ? 'x' : ''} · {txs.length} transaction{txs.length > 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-1 rounded-lg border p-1 text-sm">
          {(['points', 'heatmap'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {m === 'points' ? 'Points' : 'Heatmap'}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden border relative" style={{ height: 540 }}>
        <DeckGL
          initialViewState={initialViewState}
          controller={true}
          layers={layers}
          style={{ position: 'absolute', inset: '0' }}
        >
          <Map mapStyle={MAP_STYLE} />
        </DeckGL>

        {hovered && (
          <div
            className="absolute z-10 bg-card border rounded-lg shadow-xl px-3 py-2 text-xs pointer-events-none"
            style={{ left: `${hovered.x + 12}px`, top: `${hovered.y - 12}px` }}
          >
            <p className="font-medium text-sm">{hovered.object.location}</p>
            <p className="text-red-500 font-mono mt-0.5">{fmtEur(hovered.object.total)}</p>
            <p className="text-muted-foreground">{hovered.object.count} transaction{hovered.object.count > 1 ? 's' : ''}</p>
            {hovered.object.tags.length > 0 && (
              <div className="flex gap-1 mt-1 flex-wrap">
                {hovered.object.tags.map((t: any) => (
                  <span key={t.id} className="px-1.5 py-0.5 rounded-full text-xs" style={{ background: t.color + '33', color: t.color }}>
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
