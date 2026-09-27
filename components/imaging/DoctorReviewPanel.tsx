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
import { findingColor, type ImagingFinding } from '@/components/imaging/types'

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
// schema (condition / tooth_number / confidence / bounding_box), which they
// do by construction — we only subset the AI array, never reshape it.

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
            const key = `imaging.condition.${finding.condition}`
            const out = t(key)
            const condition = out === key ? finding.condition : out
            const pct = Math.round((finding.confidence ?? 0) * 100)
            return (
              <label
                key={`${finding.bounding_box.x}-${finding.bounding_box.y}-${index}`}
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
                  style={{ backgroundColor: findingColor(finding.condition) }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {condition}
                  {finding.tooth_number != null && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {t('imaging.tooth')} {finding.tooth_number}
                    </span>
                  )}
                </span>
                <span className="w-16">
                  <Progress value={pct} className="h-1" />
                </span>
                <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                  {pct}%
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
