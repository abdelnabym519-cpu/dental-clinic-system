'use client'

/**
 * R1a — the new 2D odontogram, backed by the vendored
 * React-Advanced-Odontogram, wired into DenToRa.
 *
 * Sits BESIDE the existing chart (route `dental-chart-v2`) and deletes nothing.
 * Reuses the existing `/api/dental-chart` routes, RBAC roles and shared chart
 * store — no new persistence path, no schema change.
 *
 * Data flow:
 *   load    GET summary -> entries -> adapter -> importStatus() -> drawn
 *   edit    onStateChange (debounced) -> getToothStates() -> adapter -> diff
 *                                    -> POST/PUT/DELETE -> refetch
 *   fail    re-import the last good snapshot (rollback) + Arabic error
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSession } from 'next-auth/react'
import { AlertCircle, Loader2 } from 'lucide-react'

// Imported through the bare specifier, NOT the relative vendor path: the
// bundler aliases it to the real vendored source (next.config.js) while
// TypeScript resolves it to types/rao-odontogram.d.ts, keeping the library's
// non-strict source out of the app's typecheck program.
import {
  OdontogramShell,
  importStatus,
  resetForPatient,
  getToothStates,
  onStateChange,
} from 'rao-odontogram'

import type { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'
import { useDentalChartStore } from '@/lib/dental-chart/chart-state'
import {
  entriesToRaoState,
  raoStateFromLibrary,
  raoStateToEntries,
  diffToothRows,
  buildImportPayload,
  fdiToSlot,
  slotToFdi,
  PERMANENT_TEETH,
  PRIMARY_TEETH,
  type RaoToothState,
} from '@/lib/dental-chart/v2/rao-adapter'
import { UnmappedFindingsPanel } from './UnmappedFindingsPanel'
import { useLanguage } from '@/components/providers/language-provider'

const Odontogram = dynamic(() => Promise.resolve(OdontogramShell), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
})

/**
 * Roles allowed to mutate. Matches the SERVER, not the other way round:
 * `POST|PUT|DELETE /api/dental-chart` all gate on `['ADMIN','DOCTOR']` and
 * return 403 otherwise. Offering editing to SUPER_ADMIN here would produce a
 * control that always fails, so the UI mirrors the server exactly. The server
 * remains the authority — this is only to avoid promising what it will refuse.
 */
const MUTATOR_ROLES = new Set(['DOCTOR', 'ADMIN'])
const VIEWER_ROLES = new Set(['DOCTOR', 'ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST'])

/** Debounce between the last edit and the write. */
const SAVE_DEBOUNCE_MS = 700

interface SummaryPayload {
  patient: { id: string; name: string }
  entries: DentalChartEntryRecord[]
}

const ALL_DENTORA_TEETH = [...PERMANENT_TEETH, ...PRIMARY_TEETH]

export function RaoOdontogram({ patientId }: { patientId: string }) {
  const { data: session } = useSession()
  const { locale } = useLanguage()

  const [entries, setEntries] = useState<DentalChartEntryRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const role = session?.user?.role as string | undefined
  const canView = Boolean(role && VIEWER_ROLES.has(role))
  const readOnly = !MUTATOR_ROLES.has(role ?? '')

  const selectedToothNumber = useDentalChartStore((s) => s.selectedToothNumber)
  const setSelectedTooth = useDentalChartStore((s) => s.setSelectedTooth)
  const storeReset = useDentalChartStore((s) => s.reset)

  // ── data ──────────────────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/dental-chart/${patientId}/summary`, { cache: 'no-store' })
      if (!res.ok) throw new Error(res.status === 403 ? 'forbidden' : 'failed')
      const data = (await res.json()) as SummaryPayload
      setEntries(data.entries ?? [])
      setError(null)
    } catch {
      setError('تعذّر تحميل مخطط الأسنان')
    }
  }, [patientId])

  // ── the states we last successfully reconciled with the server ─────────────
  // This is the rollback point AND the diff baseline: it holds the rows as they
  // are persisted, not as the chart currently shows them.
  const baselineRef = useRef<Map<number, DentalChartEntryRecord[]>>(new Map())
  const payloadRef = useRef<ReturnType<typeof buildImportPayload> | null>(null)
  // Double-submit guard: one write in flight at a time.
  const inFlightRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const statesBySlot = useMemo(() => {
    const map = new Map<number, RaoToothState>()
    if (!entries) return map
    for (const tooth of ALL_DENTORA_TEETH) {
      const rows = entries.filter((e) => e.toothNumber === tooth)
      if (rows.length === 0) continue
      const state = entriesToRaoState(rows, tooth)
      map.set(state.slot, state)
    }
    return map
  }, [entries])

  // ── push DenToRa data INTO the library so it is actually drawn ─────────────
  // The library renders from its own internal chart map, which is only filled by
  // an import or by user interaction. Without this the chart would open empty
  // even though `statesBySlot` had been computed.
  useEffect(() => {
    if (!entries) return
    const payload = buildImportPayload(statesBySlot)
    payloadRef.current = payload
    // importStatus() is imperative and synchronous; it repaints every tooth.
    importStatus(payload)
    // Remember the persisted rows per tooth as the diff baseline.
    const base = new Map<number, DentalChartEntryRecord[]>()
    for (const e of entries) {
      const list = base.get(e.toothNumber) ?? []
      list.push(e)
      base.set(e.toothNumber, list)
    }
    baselineRef.current = base
  }, [entries, statesBySlot])

  // ── per-patient reset ─────────────────────────────────────────────────────
  // Navigating to another patient must clear BOTH the app-side interaction
  // state (store.reset) and the library's patient data + selection
  // (resetForPatient, patch 5). Without the latter, patient B would open with
  // patient A's findings still painted.
  useEffect(() => {
    storeReset()
    baselineRef.current = new Map()
    payloadRef.current = null
    resetForPatient()
    const id = setTimeout(refetch, 0)
    return () => clearTimeout(id)
  }, [refetch, patientId, storeReset])

  // ── selection: store <-> odontogram ───────────────────────────────────────
  const selectedSlots = useMemo(() => {
    if (selectedToothNumber === null) return []
    try {
      return [fdiToSlot(selectedToothNumber).slot]
    } catch {
      return []
    }
  }, [selectedToothNumber])

  const lastPushed = useRef<number | null>(null)

  const handleSelectionChange = useCallback(
    (slots: number[]) => {
      const slot = slots[0] ?? null
      if (slot === null) {
        if (lastPushed.current !== null) {
          lastPushed.current = null
          setSelectedTooth(null)
        }
        return
      }
      // The library reports SLOTS; re-expand to the DenToRa FDI the store
      // expects so a primary tooth comes back as 51-85, not as its slot.
      const state = statesBySlot.get(slot)
      const fdi = slotToFdi(slot, state?.isPrimary ?? false)
      if (lastPushed.current === fdi) return
      lastPushed.current = fdi
      setSelectedTooth(fdi)
    },
    [setSelectedTooth, statesBySlot],
  )

  useEffect(() => {
    lastPushed.current = selectedToothNumber
  }, [selectedToothNumber])

  // ── persistence ───────────────────────────────────────────────────────────
  const persist = useCallback(async () => {
    // Double-submit guard.
    if (inFlightRef.current) return
    if (!payloadRef.current) return

    const snapshot = getToothStates()
    if (!snapshot) return

    const baseline = baselineRef.current
    const teeth = new Set<number>([...baseline.keys(), ...Object.keys(snapshot).map(Number)])

    const jobs: Array<() => Promise<Response>> = []

    for (const slot of teeth) {
      const raw = snapshot[String(slot)] as Record<string, unknown> | undefined
      // A slot the library reports but DenToRa never had is an empty tooth.
      const isPrimary = [...PRIMARY_TEETH].some((f) => fdiToSlot(f).slot === slot)
      const nextState = raoStateFromLibrary(raw ?? null, slot, isPrimary)
      const fdi = slotToFdi(slot, isPrimary)
      const nextRows = raoStateToEntries(nextState, fdi, {
        patientId,
        hospitalId: '',
        diagnosedDate: new Date().toISOString(),
      })
      const prevRows = baseline.get(fdi) ?? []
      const { added, removed, changed } = diffToothRows(prevRows, nextRows)

      for (const row of added) {
        jobs.push(() =>
          fetch('/api/dental-chart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patientId,
              toothNumber: row.toothNumber,
              toothNotation: String(row.toothNumber),
              condition: row.condition,
              severity: row.severity,
              mesial: row.mesial,
              distal: row.distal,
              occlusal: row.occlusal,
              buccal: row.buccal,
              lingual: row.lingual,
              notes: row.notes ?? null,
            }),
          }),
        )
      }
      for (const row of removed) {
        // Prefer resolving (soft delete) when the row has an id; the clinical
        // record should not silently vanish from the patient's history.
        if (!row.id) continue
        jobs.push(() =>
          fetch(`/api/dental-chart/${row.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolvedDate: new Date().toISOString() }),
          }),
        )
      }
      for (const row of changed) {
        if (!row.id) continue
        jobs.push(() =>
          fetch(`/api/dental-chart/${row.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              condition: row.condition,
              severity: row.severity,
              mesial: row.mesial,
              distal: row.distal,
              occlusal: row.occlusal,
              buccal: row.buccal,
              lingual: row.lingual,
            }),
          }),
        )
      }
    }

    if (jobs.length === 0) return

    inFlightRef.current = true
    setSaving(true)
    try {
      const results = await Promise.all(jobs.map((j) => j()))
      const failed = results.find((r) => !r.ok)
      if (failed) {
        // ROLLBACK: re-import the last snapshot known to match the server, so
        // the chart never shows a finding that was not saved.
        if (payloadRef.current) importStatus(payloadRef.current)
        setError(
          failed.status === 403
            ? 'لا تملك صلاحية تعديل المخطط السني'
            : 'تعذّر حفظ التعديلات. تم التراجع عن التغييرات.',
        )
        return
      }
      setError(null)
      await refetch()
    } catch {
      if (payloadRef.current) importStatus(payloadRef.current)
      setError('تعذّر الاتصال بالخادم. تم التراجع عن التغييرات.')
    } finally {
      inFlightRef.current = false
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, refetch])

  // The library notifies on every edit; debounce so a burst of clicks is one
  // write, and skip entirely when read-only.
  useEffect(() => {
    if (readOnly) return
    return onStateChange(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => void persist(), SAVE_DEBOUNCE_MS)
    })
  }, [readOnly, persist])

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    [],
  )

  const chartLanguage = locale.startsWith('ar') ? 'ar' : 'en'
  const dir = locale.startsWith('ar') ? 'rtl' : 'ltr'

  if (!canView) {
    return (
      <div
        dir="rtl"
        className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>ليس لديك صلاحية عرض مخطط الأسنان</span>
      </div>
    )
  }

  return (
    <div dir={dir} className="space-y-2">
      {error && (
        <div
          role="alert"
          data-testid="chart-error"
          className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {saving && (
        <div
          data-testid="chart-saving"
          className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>جارٍ الحفظ…</span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <Odontogram
          language={chartLanguage}
          showLanguageSwitcher={false}
          readOnly={readOnly}
          selectedTeeth={selectedSlots}
          onSelectionChange={handleSelectionChange}
        />
      </div>

      <UnmappedFindingsPanel entries={entries ?? []} locale={locale} />
    </div>
  )
}

export default RaoOdontogram

