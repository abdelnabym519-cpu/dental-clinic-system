'use client'

import { useState } from 'react'
import { Check, CheckCheck, Loader2, XCircle } from 'lucide-react'

import { useLanguage } from '@/components/providers/language-provider'
import { useToast } from '@/hooks/use-toast'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import {
  FALLBACK_COLOR,
  LANDMARK_COLOR,
  findingColor,
  isBoxFinding,
  isLandmarkFinding,
  type ImagingFinding,
} from '@/components/imaging/types'

// Phase 20 (D6) — the mandatory human gate over AI findings.
//
// Maps the spec's three outcomes onto the existing 19A review contract
// (POST /api/imaging/jobs/:id/review):
//
//   "قبول الكل"      → ACCEPTED          (server keeps the AI findings as-is)
//   "قبول المحدد"    → ACCEPTED          when every finding is ticked
//                    → MODIFIED          otherwise (acceptedFindings = subset)
//   "رفض الكل"      → REJECTED          (confirmation dialog required)
//
// The server is the source of truth: findings sent back must match its
// schema (box / landmark / segment — the 19B D15 union), which they do by
// construction — we only subset the AI array, never reshape it.

export type ReviewDecision = 'ACCEPTED' | 'MODIFIED' | 'REJECTED'

interface DoctorReviewPanelProps {
  jobId: string
  findings: ImagingFinding[]
  onReviewComplete: (decision: ReviewDecision) => Promise<void> | void
}

export function DoctorReviewPanel({ jobId, findings, onReviewComplete }: DoctorReviewPanelProps) {
  const { t } = useLanguage()
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  const [checked, setChecked] = useState<Set<number>>(() => new Set(findings.map((_, i) => i)))
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState<ReviewDecision | null>(null)

  const allChecked = checked.size === findings.length
  const noneChecked = checked.size === 0

  const toggle = (index: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const submit = async (
    kind: 'accept-all' | 'accept-selected' | 'reject-all'
  ) => {
    if (submitting) return

    if (kind === 'reject-all') {
      const ok = await confirm({
        title: t('imaging.review.confirm_reject_title'),
        description: t('imaging.review.confirm_reject_desc'),
        confirmLabel: t('imaging.review.reject_all'),
        variant: 'destructive',
      })
      if (!ok) return
    }

    let decision: ReviewDecision
    let acceptedFindings: ImagingFinding[] | undefined
    if (kind === 'accept-all') {
      decision = 'ACCEPTED'
    } else if (kind === 'accept-selected') {
      if (noneChecked) return
      if (allChecked) {
        decision = 'ACCEPTED'
      } else {
        decision = 'MODIFIED'
        acceptedFindings = findings.filter((_, i) => checked.has(i))
      }
    } else {
      decision = 'REJECTED'
    }

    setSubmitting(decision)
    try {
      const res = await fetch(`/api/imaging/jobs/${jobId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          ...(acceptedFindings ? { acceptedFindings } : {}),
          ...(notes.trim() ? { reviewNotes: notes.trim() } : {}),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: t('imaging.review.failed'),
          description: body.error || `${res.status}`,
        })
        return
      }
      await onReviewComplete(decision)
    } catch {
      toast({
        variant: 'destructive',
        title: t('imaging.review.failed'),
        description: t('imaging.review.network_error'),
      })
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {t('imaging.review.title')} ({findings.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Per-finding accept/reject selection (spec D6 layout). */}
        <div className="space-y-1.5">
          {findings.map((finding, index) => {
            // Per-engine display (19B D15): boxes show the condition,
            // landmarks their number, segments the neutral class. The
            // accept/reject checkbox works identically for every shape —
            // the server re-validates the accepted subset.
            let color = FALLBACK_COLOR
            let label = ''
            let tooth: number | string | null = null
            let pct: number | null = null
            let key: string
            if (isBoxFinding(finding)) {
              color = findingColor(finding.condition)
              const condKey = `imaging.condition.${finding.condition}`
              const out = t(condKey)
              label = out === condKey ? finding.condition : out
              tooth = finding.tooth_number
              pct = Math.round((finding.confidence ?? 0) * 100)
              key = `box-${finding.bounding_box.x}-${finding.bounding_box.y}-${index}`
            } else if (isLandmarkFinding(finding)) {
              color = LANDMARK_COLOR
              label = t('imaging.landmark_label', { n: finding.landmark_id + 1 })
              pct = finding.score === null ? null : Math.round(finding.score * 100)
              key = `lm-${finding.landmark_id}-${index}`
            } else {
              color = findingColor(finding.class_name)
              label = finding.class_name
              key = `seg-${finding.class_id}-${index}`
            }
            return (
              <label
                key={key}
                className="flex items-center gap-3 rounded-md border p-2 text-sm hover:bg-accent/40"
              >
                <input
                  type="checkbox"
                  checked={checked.has(index)}
                  onChange={() => toggle(index)}
                  className="h-4 w-4 accent-primary"
                />
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: color }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {label}
                  {tooth != null && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {t('imaging.tooth')} {tooth}
                    </span>
                  )}
                </span>
                <span className="w-16">
                  {pct !== null && <Progress value={pct} className="h-1" />}
                </span>
                <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                  {pct === null ? '—' : `${pct}%`}
                </span>
              </label>
            )
          })}
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">{t('imaging.review.notes')}</span>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('imaging.review.notes_placeholder')}
            rows={3}
          />
        </label>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            onClick={() => submit('accept-all')}
            disabled={submitting !== null}
            className="gap-2"
          >
            {submitting === 'ACCEPTED' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4" />
            )}
            {t('imaging.review.accept_all')}
          </Button>
          <Button
            variant="outline"
            onClick={() => submit('accept-selected')}
            disabled={submitting !== null || noneChecked}
            className="gap-2"
          >
            {submitting === 'MODIFIED' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {t('imaging.review.accept_selected')}
            {checked.size > 0 && !allChecked && ` (${checked.size})`}
          </Button>
          <Button
            variant="destructive"
            onClick={() => submit('reject-all')}
            disabled={submitting !== null}
            className="gap-2"
          >
            <XCircle className="h-4 w-4" />
            {t('imaging.review.reject_all')}
          </Button>
        </div>
      </CardContent>
      {ConfirmDialogComponent}
    </Card>
  )
}
