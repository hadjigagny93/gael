import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Upload, FileText, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react'
import api, { type Bank } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Step = 'select' | 'parsing' | 'review' | 'done'
type FileProgress = { name: string; status: 'waiting' | 'uploading' | 'parsing' | 'done' | 'error' | 'duplicate'; progress: number; jobId?: string }

interface CsvFile {
  filename: string
  columns: string[]
  rows: Record<string, string>[]
  total_rows: number
}

interface JobResult {
  status: 'processing' | 'done' | 'error'
  result: { csv_files: CsvFile[]; existing_mapping: Record<string, string> | null } | null
  error: string | null
}

const SOLDE_RE = /SOLDE\s+(CREDIT(?:EUR)?|DEBIT(?:EUR)?)/i
const DATE_IN_LABEL_RE = /(\d{2})[./](\d{2})[./](\d{4})/

function parseSoldes(
  tableRows: Record<number, Record<string, string>[]>,
  selectedTables: number[],
  mapping: { date: string; label: string; debit: string; credit: string },
  year: number
) {
  const results: { label: string; date: string; value: string; type: string; kind: string }[] = []
  const parseAmt = (v: string) => {
    const cleaned = v.replace(/\s| /g, '').replace(',', '.').replace(/[^\d.\-]/g, '')
    return cleaned ? parseFloat(cleaned) : null
  }
  const lastDates: string[] = []
  for (const ti of selectedTables) {
    for (const row of (tableRows[ti] ?? [])) {
      const raw = (row[mapping.date] ?? '').trim()
      if (raw) lastDates.push(raw)
    }
  }
  const lastRaw = lastDates[lastDates.length - 1] ?? ''

  for (const ti of selectedTables) {
    for (const row of (tableRows[ti] ?? [])) {
      // check mapped label column first, then scan all values as fallback
      const mappedLabel = (row[mapping.label] ?? '').trim()
      const allValues = Object.values(row).map(v => (v ?? '').trim())
      const labelCandidate = mappedLabel || allValues.find(v => SOLDE_RE.test(v)) || ''
      const label = labelCandidate
      const m = SOLDE_RE.exec(label)
      if (!m) continue
      const rawType = m[1].toUpperCase()
      const solType = rawType.startsWith('CREDIT') ? 'créditeur' : 'débiteur'
      const amt = solType === 'créditeur'
        ? (parseAmt(row[mapping.credit] ?? '') ?? parseAmt(row[mapping.debit] ?? ''))
        : (parseAmt(row[mapping.debit] ?? '') ?? parseAmt(row[mapping.credit] ?? ''))
      if (amt === null) continue
      const dm = DATE_IN_LABEL_RE.exec(label.toUpperCase())
      const kind = dm ? 'ouverture' : 'clôture'
      const dateStr = dm
        ? `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`
        : lastRaw || `${year}-12-31`
      results.push({ label, date: dateStr, value: amt.toFixed(2), type: solType, kind })
    }
  }
  return results
}

function SoldePreview({
  tableRows, selectedTables, mapping, year,
}: {
  tableRows: Record<number, Record<string, string>[]>
  selectedTables: number[]
  mapping: { date: string; label: string; debit: string; credit: string }
  year: number
}) {
  const detected = useMemo(
    () => parseSoldes(tableRows, selectedTables, mapping, year),
    [tableRows, selectedTables, mapping, year]
  )
  if (detected.length === 0) return (
    <div className="rounded-lg border border-dashed p-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span>⚠️</span> Aucun solde détecté — vérifiez que la colonne Libellé contient bien les lignes SOLDE CREDITEUR / SOLDE CREDIT.
    </div>
  )
  return (
    <div className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Soldes détectés ({detected.length})</p>
      {detected.map((s, i) => (
        <div key={i} className="flex items-center gap-3 text-xs">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.kind === 'ouverture' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'bg-green-500/15 text-green-600 dark:text-green-400'}`}>
            {s.kind}
          </span>
          <span className="text-muted-foreground w-24 flex-shrink-0">{s.date}</span>
          <span className="truncate flex-1 text-muted-foreground">{s.label}</span>
          <span className={`font-mono font-medium flex-shrink-0 ${s.type === 'débiteur' ? 'text-red-500' : ''}`}>
            {s.type === 'débiteur' ? '−' : ''}{s.value} €
          </span>
          <span className="text-muted-foreground">{s.type}</span>
        </div>
      ))}
    </div>
  )
}

const STORAGE_KEY = 'gael_import_state'

function loadState() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') } catch { return null }
}

function saveState(state: object) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function clearState() {
  sessionStorage.removeItem(STORAGE_KEY)
}

export default function ImportPage() {
  const saved = loadState()

  const [step, setStep] = useState<Step>(saved?.step ?? 'select')
  const [bankId, setBankId] = useState<string>(saved?.bankId ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [statementIds, setStatementIds] = useState<number[]>(saved?.statementIds ?? [])
  const [tableStatementIds, setTableStatementIds] = useState<number[]>(saved?.tableStatementIds ?? [])
  const [fileProgresses, setFileProgresses] = useState<FileProgress[]>(saved?.fileProgresses ?? [])
  const [csvFiles, setCsvFiles] = useState<CsvFile[]>(saved?.csvFiles ?? [])
  const [existingMapping, setExistingMapping] = useState<Record<string, string> | null>(saved?.existingMapping ?? null)
  const [tableRows, setTableRows] = useState<Record<number, Record<string, string>[]>>(saved?.tableRows ?? {})
  const [selectedTables, setSelectedTables] = useState<number[]>(saved?.selectedTables ?? [])
  const [activePdfStatementId, setActivePdfStatementId] = useState<number | null>(saved?.activePdfStatementId ?? null)
  const [mapping, setMapping] = useState(saved?.mapping ?? { date: '', label: '', debit: '', credit: '' })
  const [year, setYear] = useState<number>(saved?.year ?? new Date().getFullYear())
  const [excludedRows, setExcludedRows] = useState<Set<string>>(new Set())

  const inferredYear = useMemo(() => {
    const re = /SOLDE\s+(?:CREDIT(?:EUR)?|DEBIT(?:EUR)?)\s+(?:AU\s+)?(\d{2})[./](\d{2})[./](\d{4})/i
    for (const rows of Object.values(tableRows)) {
      for (const row of rows) {
        for (const val of Object.values(row)) {
          const m = re.exec(String(val ?? ''))
          if (m) return parseInt(m[3])
        }
      }
    }
    return null
  }, [tableRows])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statementIdsRef = useRef<number[]>(statementIds)
  useEffect(() => { statementIdsRef.current = statementIds }, [statementIds])

  // persist parsing progress
  useEffect(() => {
    if (step === 'parsing') saveState({ step, bankId, fileProgresses, statementIds: statementIdsRef.current })
  }, [fileProgresses])

  // on remount during parsing: resume ALL jobs that have a jobId, then go to review
  useEffect(() => {
    if (step !== 'parsing') return
    const resumable = fileProgresses
      .map((f, i) => ({ ...f, i }))
      .filter(f => (f.status === 'parsing' || f.status === 'done') && f.jobId)
    if (resumable.length === 0) {
      setFileProgresses(prev => prev.map(f =>
        f.status === 'waiting' || f.status === 'uploading'
          ? { ...f, status: 'error' as const, progress: 0 }
          : f
      ))
      return
    }
    let cancelled = false
    ;(async () => {
      const slotResults: ({ csvFiles: CsvFile[]; existingMapping: Record<string, string> | null } | null)[] =
        new Array(fileProgresses.length).fill(null)

      await Promise.all(resumable.map(async ({ i, jobId, status }) => {
        try {
          // if already done in this session, re-fetch the result; otherwise poll
          const result = status === 'done'
            ? await api.get(`/statements/job/${jobId!}`).then(r => r.data.result)
            : await pollJobRef.current(jobId!)
          if (cancelled || !result) return
          slotResults[i] = { csvFiles: result.csv_files, existingMapping: result.existing_mapping }
          setFileProgress(i, { status: 'done', progress: 100 })
        } catch {
          if (!cancelled) setFileProgress(i, { status: 'error', progress: 40 })
        }
      }))

      if (cancelled) return

      const allCsvFiles: CsvFile[] = []
      const allTableStatementIds: number[] = []
      let existingMap: Record<string, string> | null = null

      for (let i = 0; i < slotResults.length; i++) {
        const r = slotResults[i]
        if (!r) continue
        const sid = statementIdsRef.current[i]
        r.csvFiles.forEach(() => allTableStatementIds.push(sid))
        allCsvFiles.push(...r.csvFiles)
        if (!existingMap && r.existingMapping) existingMap = r.existingMapping
      }

      if (allCsvFiles.length === 0) return // some failed, show error state

      setCsvFiles(allCsvFiles)
      setExistingMapping(existingMap)
      setTableStatementIds(allTableStatementIds)
      setActivePdfStatementId(statementIdsRef.current[0] ?? null)
      setStatementIds(statementIdsRef.current)
      const rows: Record<number, Record<string, string>[]> = {}
      allCsvFiles.forEach((f, i) => { rows[i] = f.rows })
      setTableRows(rows)
      setSelectedTables(allCsvFiles.map((_, i) => i))
      if (existingMap) setMapping(existingMap as typeof mapping)
      setTimeout(() => setStep('review'), 400)
    })()
    return () => { cancelled = true }
  }, [])

  // persist review state
  useEffect(() => {
    if (step === 'review') {
      saveState({ step, bankId, statementIds, tableStatementIds, csvFiles, existingMapping, tableRows, selectedTables, activePdfStatementId, mapping, year })
    } else if (step === 'select' || step === 'done') {
      clearState()
    }
  }, [step, tableRows, selectedTables, mapping, year, activePdfStatementId])

  const { data: banks = [] } = useQuery<Bank[]>({
    queryKey: ['banks'],
    queryFn: () => api.get('/banks/').then(r => r.data),
  })

  // stable refs so the mutation closure never captures stale versions
  const bankIdRef = useRef(bankId)
  useEffect(() => { bankIdRef.current = bankId }, [bankId])

  const pollJobRef = useRef(async (jobId: string): Promise<{ csv_files: CsvFile[]; existing_mapping: Record<string, string> | null }> => {
    // wait 1500ms OR until the tab becomes visible again (whichever comes first)
    const wait = () => new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout>
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          clearTimeout(timer)
          document.removeEventListener('visibilitychange', onVisible)
          resolve()
        }
      }
      document.addEventListener('visibilitychange', onVisible)
      timer = setTimeout(() => {
        document.removeEventListener('visibilitychange', onVisible)
        resolve()
      }, 1500)
    })

    while (true) {
      await wait()
      const { data }: { data: JobResult } = await api.get(`/statements/job/${jobId}`)
      if (data.status === 'done' && data.result) return data.result
      if (data.status === 'error') throw new Error(data.error ?? 'Erreur parsing')
    }
  })

  const setFileProgress = useCallback((i: number, patch: Partial<FileProgress>) =>
    setFileProgresses(prev => prev.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  , [])

  const upload = useMutation({
    mutationFn: async (filesToUpload: File[]) => {
      const allStatementIds: number[] = new Array(filesToUpload.length).fill(0)
      const jobSlots: ({ jobId: string; statementId: number } | null)[] = new Array(filesToUpload.length).fill(null)

      setFileProgresses(filesToUpload.map(f => ({ name: f.name, status: 'waiting' as const, progress: 0 })))

      // Phase 1: upload ALL files first to get all job IDs before any polling
      for (let i = 0; i < filesToUpload.length; i++) {
        setFileProgress(i, { status: 'uploading', progress: 10 })
        const fd = new FormData()
        fd.append('bank_id', bankIdRef.current)
        fd.append('file', filesToUpload[i])
        const { data } = await api.post('/statements/upload', fd)
        allStatementIds[i] = data.statement_id

        if (data.duplicate) {
          setFileProgress(i, { status: 'duplicate', progress: 100 })
        } else {
          jobSlots[i] = { jobId: data.job_id, statementId: data.statement_id }
          setFileProgress(i, { status: 'parsing', progress: 40, jobId: data.job_id })
        }
      }
      // sync ref immediately so saveState has the IDs before onSuccess fires
      statementIdsRef.current = allStatementIds
      // state is saved here by the useEffect — all jobIds are now persisted

      // Phase 2: poll all jobs concurrently
      const slotResults: ({ csvFiles: CsvFile[]; existingMapping: Record<string, string> | null } | null)[] = new Array(filesToUpload.length).fill(null)
      await Promise.all(jobSlots.map(async (slot, i) => {
        if (!slot) return
        try {
          const result = await pollJobRef.current(slot.jobId)
          slotResults[i] = { csvFiles: result.csv_files, existingMapping: result.existing_mapping }
          setFileProgress(i, { status: 'done', progress: 100 })
        } catch (e) {
          setFileProgress(i, { status: 'error', progress: 40 })
        }
      }))

      const allCsvFiles: CsvFile[] = []
      const allTableStatementIds: number[] = []
      let existingMap: Record<string, string> | null = null
      for (let i = 0; i < jobSlots.length; i++) {
        const r = slotResults[i]
        if (!r) continue
        r.csvFiles.forEach(() => allTableStatementIds.push(allStatementIds[i]))
        allCsvFiles.push(...r.csvFiles)
        if (!existingMap && r.existingMapping) existingMap = r.existingMapping
      }

      return { allCsvFiles, allStatementIds, allTableStatementIds, existingMap }
    },
    onSuccess: ({ allCsvFiles, allStatementIds, allTableStatementIds, existingMap }) => {
      setStatementIds(allStatementIds)
      setTableStatementIds(allTableStatementIds)
      setActivePdfStatementId(allStatementIds[0] ?? null)
      setCsvFiles(allCsvFiles)
      setExistingMapping(existingMap)
      const rows: Record<number, Record<string, string>[]> = {}
      allCsvFiles.forEach((f, i) => { rows[i] = f.rows })
      setTableRows(rows)
      setSelectedTables(allCsvFiles.map((_, i) => i))
      if (existingMap) setMapping(existingMap as typeof mapping)
      setTimeout(() => setStep('review'), 400)
    },
    onError: (err: Error) => {
      // mark current in-progress file as error
      setFileProgresses(prev => prev.map(f =>
        f.status === 'uploading' || f.status === 'parsing' ? { ...f, status: 'error' as const, progress: f.progress } : f
      ))
      // show error message in UI instead of alert — user can restart
    },
  })

  const confirm = useMutation({
    mutationFn: async () => {
      // group selected tables by their source statement
      const byStatement: Record<number, Record<string, string>[][]> = {}
      selectedTables.forEach(i => {
        const sid = tableStatementIds[i]
        if (!byStatement[sid]) byStatement[sid] = []
        const rows = (tableRows[i] ?? []).filter((_, ri) => !excludedRows.has(`${i}-${ri}`))
        byStatement[sid].push(rows)
      })
      await Promise.all(Object.entries(byStatement).map(([sid, csvData]) =>
        api.post('/statements/confirm', {
          bank_id: Number(bankId),
          statement_id: Number(sid),
          csv_data: csvData,
          column_mapping: mapping,
          save_mapping: true,
        })
      ))
    },
    onSuccess: () => setStep('done'),
  })

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf')
    setFiles(prev => [...prev, ...dropped])
  }, [])

  const updateCell = (tableIdx: number, rowIdx: number, col: string, value: string) => {
    setTableRows(prev => {
      const rows = [...(prev[tableIdx] ?? [])]
      rows[rowIdx] = { ...rows[rowIdx], [col]: value }
      return { ...prev, [tableIdx]: rows }
    })
  }

  const toggleTable = (i: number) =>
    setSelectedTables(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])

  const [reviewPage, setReviewPage] = useState(0)
  const mappingColumns = csvFiles[selectedTables[0]]?.columns ?? []
  const currentPageMappingColumns = csvFiles[csvFiles.map((_, ti) => ti).find(ti => tableStatementIds[ti] === statementIds[reviewPage]) ?? 0]?.columns ?? mappingColumns

  const reset = () => {
    setStep('select'); setFiles([]); setStatementIds([])
    setFileProgresses([]); setCsvFiles([]); setSelectedTables([]); setTableRows({}); setTableStatementIds([]); clearState()
  }

  // ── DONE ──
  if (step === 'done') return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <CheckCircle2 className="h-16 w-16 text-green-500" />
      <h2 className="text-2xl font-bold">Import réussi</h2>
      <p className="text-muted-foreground">Les transactions ont été importées et validées.</p>
      <Button onClick={reset}>Importer un autre relevé</Button>
    </div>
  )

  // ── PARSING ──
  const allDone = fileProgresses.length > 0 && fileProgresses.every(f => f.status === 'done')
  const stillProcessing = fileProgresses.some(f => f.status === 'waiting' || f.status === 'uploading' || f.status === 'parsing')

  if (step === 'parsing') return (
    <div className="flex flex-col items-center justify-center py-24 gap-6 max-w-lg mx-auto w-full">
      {stillProcessing
        ? <Loader2 className="h-10 w-10 text-primary animate-spin" />
        : <CheckCircle2 className="h-10 w-10 text-green-500" />
      }
      <div className="w-full flex flex-col gap-4">
        {fileProgresses.map((f, i) => {
          const notStarted = f.status === 'error' && !f.jobId && f.progress === 0
          const statusLabel = f.status === 'waiting' ? 'En attente…' : f.status === 'uploading' ? 'Envoi…' : f.status === 'parsing' ? 'Docling extrait les tableaux…' : f.status === 'done' ? 'Terminé ✓' : f.status === 'duplicate' ? 'Déjà importé — ignoré' : notStarted ? 'Non traité — rechargez pour réessayer' : 'Erreur'
          const statusColor = f.status === 'done' ? 'text-green-500' : f.status === 'duplicate' ? 'text-amber-500' : f.status === 'error' ? (notStarted ? 'text-muted-foreground' : 'text-red-500') : 'text-muted-foreground'
          const barColor = f.status === 'done' ? 'bg-green-500' : f.status === 'duplicate' ? 'bg-amber-400' : f.status === 'error' ? (notStarted ? 'bg-muted' : 'bg-red-500') : 'bg-primary'
          return (
            <div key={i} className="w-full space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="font-medium truncate max-w-[70%]">{f.name}</span>
                <span className={`text-xs ${statusColor}`}>{f.progress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div className={`h-full ${barColor} rounded-full transition-all duration-700`} style={{ width: `${f.progress}%` }} />
              </div>
              <p className={`text-xs ${statusColor}`}>{statusLabel}</p>
            </div>
          )
        })}
      </div>

      {!stillProcessing && (
        <div className="text-center space-y-2">
          {allDone && csvFiles.length > 0
            ? <p className="text-sm text-green-600">Tous les fichiers sont prêts — passez à la vérification.</p>
            : allDone
            ? <p className="text-sm text-amber-500">Page rechargée pendant le traitement — les fichiers ont été analysés mais les données sont perdues. Relancez l'import.</p>
            : <p className="text-sm text-amber-500">Certains fichiers n'ont pas pu être traités après rechargement. Relancez l'import.</p>
          }
          <Button variant="outline" size="sm" onClick={() => { setFileProgresses([]); setStep('select'); clearState() }}>
            Recommencer
          </Button>
        </div>
      )}
    </div>
  )

  // ── REVIEW ──
  if (step === 'review') {
    const currentSid = statementIds[reviewPage]
    const pageTableIndices = csvFiles.map((_, ti) => ti).filter(ti => tableStatementIds[ti] === currentSid)
    const pageSelectedTables = selectedTables.filter(ti => tableStatementIds[ti] === currentSid)
    const isLastPage = reviewPage === statementIds.length - 1
    const allPagesReady = statementIds.length > 0

    return (
      <div className="flex h-[calc(100vh-7.5rem)] gap-4 overflow-hidden">
        {/* Left: PDF */}
        <div className="w-1/2 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <p className="text-xs font-medium text-muted-foreground">PDF original</p>
            {statementIds.length > 1 && (
              <div className="flex items-center gap-1">
                {statementIds.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setReviewPage(i)}
                    className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${reviewPage === i ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
          <iframe
            key={currentSid}
            src={`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/statements/${currentSid}/pdf`}
            className="flex-1 rounded-xl border bg-muted"
            title="Relevé bancaire"
          />
        </div>

        {/* Right: tables + controls */}
        <div className="w-1/2 flex flex-col gap-4 overflow-y-auto min-h-0 pb-4">
          <div className="flex items-center justify-between flex-shrink-0">
            <div>
              <h1 className="text-xl font-bold">
                PDF {reviewPage + 1} / {statementIds.length}
              </h1>
              <p className="text-muted-foreground text-xs mt-0.5">Modifiez les cellules si besoin.</p>
            </div>
          </div>

          {inferredYear && (
            <div className="flex items-center gap-2 text-xs text-primary/80 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
              <span>Année inférée depuis le relevé :</span>
              <span className="font-mono font-semibold">{inferredYear}</span>
            </div>
          )}

          {/* Mapping — affiché sur chaque page avec les colonnes du PDF courant */}
          <div className="rounded-xl border bg-card p-4 space-y-3 flex-shrink-0">
            {(['date', 'label', 'debit', 'credit'] as const).map(field => (
              <div key={field} className="flex items-center gap-3">
                <label className="text-sm font-medium w-20 flex-shrink-0">
                  {field === 'label' ? 'Libellé' : field === 'debit' ? 'Débit' : field === 'credit' ? 'Crédit' : 'Date'}
                </label>
                <Select value={mapping[field]} onValueChange={v => setMapping(p => ({ ...p, [field]: v }))}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Colonne…" /></SelectTrigger>
                  <SelectContent>
                    {currentPageMappingColumns.map(col => <SelectItem key={col} value={col}>{col}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          {/* Tables for this PDF */}
          {pageTableIndices.map(ti => {
            const csv = csvFiles[ti]
            const selected = selectedTables.includes(ti)
            const rows = tableRows[ti] ?? []
            return (
              <div key={ti} className={`rounded-xl border-2 overflow-hidden flex-shrink-0 transition-colors ${selected ? 'border-primary' : 'border-muted'}`}>
                <div className="flex items-center justify-between px-4 py-2 bg-muted/50 cursor-pointer" onClick={() => toggleTable(ti)}>
                  <span className="text-sm font-medium">Table {pageTableIndices.indexOf(ti) + 1} — {csv.total_rows} lignes</span>
                  <input type="checkbox" checked={selected} readOnly className="h-4 w-4 accent-primary" />
                </div>
                {selected && (
                  <div className="overflow-auto max-h-72">
                    <table className="w-full text-xs">
                      <thead className="border-b bg-muted/30">
                        <tr>
                          <th className="px-2 py-2 w-8">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-primary"
                              checked={rows.every((_, ri) => !excludedRows.has(`${ti}-${ri}`))}
                              onChange={e => {
                                setExcludedRows(prev => {
                                  const next = new Set(prev)
                                  rows.forEach((_, ri) => {
                                    const key = `${ti}-${ri}`
                                    if (e.target.checked) next.delete(key)
                                    else next.add(key)
                                  })
                                  return next
                                })
                              }}
                            />
                          </th>
                          {csv.columns.map(col => <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground">{col}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, ri) => {
                          const rowKey = `${ti}-${ri}`
                          const isChecked = !excludedRows.has(rowKey)
                          return (
                            <tr key={ri} className={`border-b last:border-0 hover:bg-muted/20 ${!isChecked ? 'opacity-40' : ''}`}>
                              <td className="px-2 py-0.5 w-8">
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 accent-primary"
                                  checked={isChecked}
                                  onChange={e => {
                                    setExcludedRows(prev => {
                                      const next = new Set(prev)
                                      if (e.target.checked) next.delete(rowKey)
                                      else next.add(rowKey)
                                      return next
                                    })
                                  }}
                                />
                              </td>
                              {csv.columns.map(col => {
                                const isDateCol = mapping.date && col === mapping.date
                                const rawVal = String(row[col] ?? '')
                                const displayVal = isDateCol && inferredYear && /^\d{2}[./]\d{2}$/.test(rawVal.trim())
                                  ? `${rawVal}.${inferredYear}`
                                  : rawVal
                                return (
                                  <td key={col} className="px-1 py-0.5">
                                    <input
                                      value={displayVal}
                                      onChange={e => {
                                        const v = e.target.value.replace(new RegExp(`\\.${inferredYear}$`), '')
                                        updateCell(ti, ri, col, v)
                                      }}
                                      className={`w-full bg-transparent px-2 py-1 rounded focus:bg-background focus:ring-1 focus:ring-primary outline-none min-w-[60px] ${isDateCol && inferredYear ? 'text-primary/80' : ''}`}
                                    />
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}

          <SoldePreview tableRows={tableRows} selectedTables={pageTableIndices} mapping={mapping} year={year} />

          <div className="flex gap-3 flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                // skip this PDF: deselect all its tables and move on
                setSelectedTables(prev => prev.filter(ti => tableStatementIds[ti] !== currentSid))
                if (isLastPage) confirm.mutate()
                else setReviewPage(p => p + 1)
              }}
            >
              Ignorer ce PDF
            </Button>
            {!isLastPage && (
              <Button onClick={() => setReviewPage(p => p + 1)} className="flex-1">
                Suivant <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {isLastPage && (
              <Button
                disabled={!allPagesReady || !mapping.date || !mapping.label || (!mapping.debit && !mapping.credit) || confirm.isPending}
                onClick={() => confirm.mutate()}
                className="flex-1"
              >
                {confirm.isPending ? 'Import en cours…' : `Importer ${statementIds.length > 1 ? `${statementIds.length} relevés` : 'et valider'}`}
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between flex-shrink-0">
            {reviewPage > 0
              ? <button onClick={() => setReviewPage(p => p - 1)} className="text-xs text-muted-foreground hover:text-foreground">← PDF précédent</button>
              : <span />
            }
            <button onClick={() => { setStep('select'); clearState() }} className="text-xs text-muted-foreground hover:text-destructive">
              Tout abandonner
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── SELECT ──

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Importer un relevé</h1>
        <p className="text-muted-foreground text-sm mt-1">Sélectionnez votre banque et déposez vos fichiers PDF</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Banque</label>
        <Select value={bankId} onValueChange={setBankId}>
          <SelectTrigger><SelectValue placeholder="Choisir une banque…" /></SelectTrigger>
          <SelectContent>
            {banks.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-16 transition-colors cursor-pointer ${dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}`}
      >
        <input id="file-input" type="file" accept=".pdf" multiple className="hidden"
          onChange={e => setFiles(Array.from(e.target.files ?? []))} />
        <Upload className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">Glissez vos PDFs ici</p>
        <p className="text-sm text-muted-foreground">ou cliquez pour sélectionner</p>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border px-4 py-3">
              <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate flex-1">{f.name}</span>
              <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} Ko</span>
            </div>
          ))}
        </div>
      )}

      <Button
        disabled={!bankId || files.length === 0 || upload.isPending}
        onClick={() => { setStep('parsing'); upload.mutate(files) }}
        className="w-full"
      >
        {upload.isPending ? 'Envoi…' : `Analyser ${files.length > 1 ? `${files.length} relevés` : 'le relevé'}`}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
