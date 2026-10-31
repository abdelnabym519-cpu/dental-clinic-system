'use client'

/**
 * R1a — the new 2D odontogram, backed by the vendored
 * React-Advanced-Odontogram, wired into DenToRa.
 *
 * Deliberately sits BESIDE the existing chart (route `dental-chart-v2`) and
 * deletes nothing. It reuses the existing `/api/dental-chart` routes, the
 * existing RBAC roles, and the existing shared chart store — there is no new
 * persistence path and no schema change.
 *
 * Selection sync (requirement: 2D -> store -> 3D -> store -> 2D):
 * the shared `useDentalChartStore` is the single source of truth. This
 * component pushes selection changes into it and re-reads from it, so the 3D
 * view and the clinical panel stay in agreement whichever one the user touched.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSession } from 'next-auth/react'
import { AlertCircle, Loader2 } from 'lucide-react'

// Imported through the bare specifier, NOT the relative vendor path: webpack
// aliases it to the real vendored source (see next.config.js) while
// TypeScript resolves it to types/rao-odontogram.d.ts, keeping the
// library's non-strict source out of the app's typecheck program.
import { OdontogramShell } from 'rao-odontogram'
import type { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'
import { useDentalChartStore } from '@/lib/dental-chart/chart-state'
import {
  entriesToRaoState,
  fdiToSlot,
  slotToFdi,
  PERMANENT_TEETH,
  PRIMARY_TEETH,
} from '@/lib/dental-chart/v2/rao-adapter'
import { useLanguage } from '@/components/providers/language-provider'

// The library is an imperative, DOM-heavy engine (it owns #toothGrid and
// attaches document-level listeners). It cannot be server-rendered.
const Odontogram = dynamic(() => Promise.resolve(OdontogramShell), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center" dir="rtl">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
})

/** Roles allowed to mutate the chart — same set the existing workspace uses. */
const MUTATOR_ROLES = new Set(['DOCTOR', 'ADMIN', 'SUPER_ADMIN'])
const VIEWER_ROLES = new Set(['DOCTOR', 'ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST'])

interface SummaryPayload {
  patient: { id: string; name: string }
  entries: DentalChartEntryRecord[]
}

/** Every tooth we may need a state for: 32 permanent slots + the 20 primary. */
const ALL_DENTORA_TEETH = [...PERMANENT_TEETH, ...PRIMARY_TEETH]

export function RaoOdontogram({ patientId }: { patientId: string }) {
  const { data: session } = useSession()
  const { locale, dir } = useLanguage()

  const [entries, setEntries] = useState<DentalChartEntryRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const role = session?.user?.role as string | undefined
  const canView = Boolean(role && VIEWER_ROLES.has(role))
  // R1a (iv): readOnly straight from RBAC.
  const readOnly = !MUTATOR_ROLES.has(role ?? '')

  // ── store: selection + per-patient reset ──────────────────────────────────
  const selectedToothNumber = useDentalChartStore((s) => s.selectedToothNumber)
  const setSelectedTooth = useDentalChartStore((s) => s.setSelectedTooth)
  const storeReset = useDentalChartStore((s) => s.reset)

  // ── data: the EXISTING aggregate summary route ────────────────────────────
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

  // R1a (v): a patient switch must clear ALL chart state before the new
  // patient's data lands — otherwise patient B opens with patient A's findings.
  // The shared store's reset() handles the app-side interaction state; the
  // engine's resetForPatient() (patch 5) handles the library side.
  useEffect(() => {
    storeReset()
    const id = setTimeout(refetch, 0)
    return () => clearTimeout(id)
  }, [refetch, patientId, storeReset])

  // ── adapter: DenToRa rows -> one library state per tooth ──────────────────
  const statesBySlot = useMemo(() => {
    const map = new Map<number, ReturnType<typeof entriesToRaoState>>()
    if (!entries) return map
    for (const tooth of ALL_DENTORA_TEETH) {
      if (tooth > 48 && !PRIMARY_TEETH.includes(tooth)) continue
      const rows = entries.filter((e) => e.toothNumber === tooth)
      const state = entriesToRaoState(rows, tooth)
      map.set(state.slot, state)
    }
    return map
  }, [entries])

  // ── selection: store <-> odontogram ───────────────────────────────────────
  // DenToRa FDI (incl. 51-85) -> library slot (11-45 + milktooth flag).
  const selectedSlots = useMemo(() => {
    if (selectedToothNumber === null) return []
    try {
      return [fdiToSlot(selectedToothNumber).slot]
    } catch {
      return []
    }
  }, [selectedToothNumber])

  // Guard against the echo loop: 2D fires -> store -> prop -> 2D -> fire...
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
      // The library reports SLOTS. Re-expand to the DenToRa FDI the store
      // expects — a primary tooth must come back as 51-85, not as its slot.
      const state = statesBySlot.get(slot)
      const fdi = slotToFdi(slot, state?.isPrimary ?? false)
      if (lastPushed.current === fdi) return
      lastPushed.current = fdi
      setSelectedTooth(fdi)
    },
    [setSelectedTooth, statesBySlot],
  )

  // Keep `lastPushed` in step when the store is changed by the 3D view or the
  // panel, so the next 2D click is still recognised as a change.
  useEffect(() => {
    lastPushed.current = selectedToothNumber
  }, [selectedToothNumber])

  // Arabic by default, RTL. The app owns the locale; the in-chart language
  // switcher is hidden (patch 3) so the two can never disagree.
  // App locales are 'ar-EG' | 'en-EG' | 'en-US'; the library takes 'ar' | 'en'.
  const chartLanguage = locale.startsWith('ar') ? 'ar' : 'en'

  if (!canView) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        dir="rtl"
      >
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>ليس لديك صلاحية عرض مخطط الأسنان</span>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        dir="rtl"
      >
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    )
  }

  return (
    <div dir={dir} className="overflow-hidden rounded-lg border bg-card">
      <Odontogram
        language={chartLanguage}
        showLanguageSwitcher={false}
        readOnly={readOnly}
        selectedTeeth={selectedSlots}
        onSelectionChange={handleSelectionChange}
      />
    </div>
  )
}
