'use client'

/**
 * R1a — "حالات غير معروضة في المخطط" (findings not shown in the chart).
 *
 * The vendored 2D library cannot draw every DenToRa condition. `SENSITIVE` is
 * the clearest case: it has no state axis, no SVG layer and no translation key
 * anywhere in the library. Rather than let those rows vanish from the 2D view,
 * they are listed here in full — tooth, condition, surfaces, date and status.
 *
 * Nothing is editable: this panel is a read-only disclosure of data that exists
 * in the database but has no 2D representation. The requirement is that nothing
 * may disappear silently.
 */

import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'
import { UNMAPPED_CONDITIONS, DENTORA_SURFACES } from '@/lib/dental-chart/v2/rao-adapter'
import { conditionLabel } from '@/lib/dental-chart/labels'

/** Arabic labels for the surfaces; falls back to the raw key. */
const SURFACE_AR: Record<string, string> = {
  mesial: 'إنسي',
  distal: 'وحشي',
  occlusal: 'إطباقي',
  buccal: 'شدقي',
  lingual: 'لساني',
}

function formatDate(value: string | Date | null | undefined, locale: string): string {
  if (!value) return '—'
  try {
    const d = typeof value === 'string' ? new Date(value) : value
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString(locale === 'en' ? 'en-GB' : 'ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

export interface UnmappedFindingsPanelProps {
  entries: DentalChartEntryRecord[]
  locale: string
}

export function UnmappedFindingsPanel({ entries, locale }: UnmappedFindingsPanelProps) {
  const unmapped = useMemo(
    () => UNMAPPED_CONDITIONS.map((c) => String(c)),
    [],
  )

  const rows = useMemo(
    () => entries.filter((e) => unmapped.includes(String(e.condition))),
    [entries, unmapped],
  )

  // Nothing to disclose: render nothing rather than an empty alarming box.
  if (rows.length === 0) return null

  return (
    <section
      dir={locale.startsWith('ar') ? 'rtl' : 'ltr'}
      className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5"
      aria-labelledby="unmapped-findings-heading"
      data-testid="unmapped-findings-panel"
    >
      <header className="flex items-center gap-2 border-b border-amber-500/30 px-4 py-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <h2 id="unmapped-findings-heading" className="text-sm font-semibold">
          حالات غير معروضة في المخطط
        </h2>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700">
          {rows.length}
        </span>
      </header>

      <p className="px-4 pt-3 text-xs text-muted-foreground">
        هذه الحالات مسجلة في ملف المريض ولا يمكن عرضها في المخطط ثنائي الأبعاد. تبقى محفوظة كما هي
        ولا يتم حذفها.
      </p>

      <div className="overflow-x-auto p-4">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="px-2 py-2 text-start font-medium">السن</th>
              <th scope="col" className="px-2 py-2 text-start font-medium">الحالة</th>
              <th scope="col" className="px-2 py-2 text-start font-medium">السطح</th>
              <th scope="col" className="px-2 py-2 text-start font-medium">التاريخ</th>
              <th scope="col" className="px-2 py-2 text-start font-medium">الوضع</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const surfaces = DENTORA_SURFACES.filter((s) => row[s] === true)
              return (
                <tr
                  key={row.id}
                  className="border-b last:border-0"
                  data-testid="unmapped-findings-row"
                  data-tooth={row.toothNumber}
                  data-condition={row.condition}
                >
                  <td className="px-2 py-2 font-medium tabular-nums">{row.toothNumber}</td>
                  <td className="px-2 py-2">
                    {conditionLabel(row.condition, locale) || row.condition}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {surfaces.length === 0
                      ? '—'
                      : surfaces.map((s) => SURFACE_AR[s] ?? s).join('، ')}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {formatDate(row.diagnosedDate, locale)}
                  </td>
                  <td className="px-2 py-2">
                    {row.resolvedDate ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">مغلق</span>
                    ) : (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-700">
                        نشط
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default UnmappedFindingsPanel
