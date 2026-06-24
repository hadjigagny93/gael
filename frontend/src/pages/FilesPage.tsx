import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'

interface StatementInfo {
  id: number
  filename: string
  imported_at: string
  bank_id: number
  bank_name: string
  bank_color: string
  tx_count: number
}

export default function FilesPage() {
  const qc = useQueryClient()

  const { data: statements = [] } = useQuery<StatementInfo[]>({
    queryKey: ['statements'],
    queryFn: () => api.get('/statements/').then(r => r.data),
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/statements/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['statements'] }),
  })

  const byBank = statements.reduce<Record<number, { name: string; color: string; files: StatementInfo[] }>>((acc, s) => {
    if (!acc[s.bank_id]) acc[s.bank_id] = { name: s.bank_name, color: s.bank_color, files: [] }
    acc[s.bank_id].files.push(s)
    return acc
  }, {})

  if (statements.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Fichiers importés</h1>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-24 text-muted-foreground">
          <FileText className="h-10 w-10 mb-3 opacity-30" />
          <p className="font-medium">Aucun relevé importé</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Fichiers importés</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{statements.length} relevé{statements.length > 1 ? 's' : ''} au total</p>
      </div>

      {Object.entries(byBank).map(([bankId, bank]) => (
        <div key={bankId} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: bank.color }} />
            <h2 className="text-sm font-semibold">{bank.name}</h2>
            <span className="text-xs text-muted-foreground">{bank.files.length} fichier{bank.files.length > 1 ? 's' : ''}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            {bank.files.map(f => (
              <div key={f.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm truncate flex-1">{f.filename}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {f.tx_count} transaction{f.tx_count > 1 ? 's' : ''}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {new Date(f.imported_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive flex-shrink-0"
                  onClick={() => remove.mutate(f.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
