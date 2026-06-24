import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Building2 } from 'lucide-react'
import api, { type Bank } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899']

const PRESETS = [
  { name: 'BNP Paribas', color: '#009966' },
  { name: 'Société Générale', color: '#e30613' },
  { name: 'Crédit Agricole', color: '#008a3a' },
  { name: 'LCL', color: '#0055a5' },
  { name: 'La Banque Postale', color: '#ffcc00' },
  { name: 'Crédit Mutuel', color: '#e2001a' },
  { name: 'CIC', color: '#c8102e' },
  { name: 'Caisse d\'Épargne', color: '#7ab51d' },
  { name: 'Banque Populaire', color: '#005ba1' },
  { name: 'Boursorama', color: '#00aaff' },
  { name: 'Hello Bank', color: '#ff6600' },
  { name: 'Fortuneo', color: '#0090d9' },
  { name: 'N26', color: '#26a65b' },
  { name: 'Revolut', color: '#191c1f' },
  { name: 'Monabanq', color: '#e4007c' },
]

export default function BanksPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])

  const { data: banks = [] } = useQuery<Bank[]>({
    queryKey: ['banks'],
    queryFn: () => api.get('/banks/').then(r => r.data),
  })

  const create = useMutation({
    mutationFn: () => api.post('/banks/', { name, color }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banks'] })
      setOpen(false)
      setName('')
      setColor(COLORS[0])
    },
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/banks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banks'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Banques</h1>
          <p className="text-muted-foreground text-sm mt-1">Gérez vos établissements bancaires</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" />Ajouter une banque</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nouvelle banque</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sélection rapide</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {PRESETS.filter(p => !banks.some(b => b.name === p.name)).map(p => (
                    <button
                      key={p.name}
                      onClick={() => { setName(p.name); setColor(p.color) }}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs text-left transition-colors hover:bg-accent ${name === p.name ? 'border-primary bg-primary/5' : ''}`}
                    >
                      <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t pt-3 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Nom</label>
                  <Input
                    placeholder="Autre banque…"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Couleur</label>
                  <div className="flex gap-2">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                        style={{ backgroundColor: c, borderColor: color === c ? 'black' : 'transparent' }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <Button
                className="w-full"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Création…' : 'Créer'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {banks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-muted-foreground">
          <Building2 className="h-10 w-10 mb-3 opacity-40" />
          <p className="font-medium">Aucune banque</p>
          <p className="text-sm">Commencez par ajouter votre première banque</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {banks.map(bank => (
            <div key={bank.id} className="flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: bank.color }}>
                  {bank.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold">{bank.name}</p>
                  {bank.column_mapping ? (
                    <Badge variant="secondary" className="text-xs mt-0.5">Mapping configuré</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Pas encore importé</span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => remove.mutate(bank.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
