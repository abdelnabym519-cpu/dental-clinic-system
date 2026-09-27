'use client'

import { Check, X } from 'lucide-react'

import { useLanguage } from '@/components/providers/language-provider'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { findingColor, type ImagingFinding } from '@/components/imaging/types'

// Phase 20 (D5) — detail card for a single AI finding.
//
// Deliberate omission: there is NO severity badge. The Liodon model emits
// class + confidence + box only, and Phase 19A fixed the rule that confidence
// must never be re-labelled as severity — the UI honours that.

interface FindingCardProps {
  finding: ImagingFinding
  index: number
  selected?: boolean
  onSelect?: (index: number) => void
  /** Review mode: show the accept checkbox (doctor only, pre-review). */
  reviewMode?: boolean
  reviewChecked?: boolean
  onReviewToggle?: (index: number) => void
}

export function FindingCard({
  finding,
  index,
  selected = false,
  onSelect,
  reviewMode = false,
  reviewChecked = true,
  onReviewToggle,
}: FindingCardProps) {
  const { t } = useLanguage()
  const color = findingColor(finding.condition)
  const pct = Math.round((finding.confidence ?? 0) * 100)

  const key = `imaging.condition.${finding.condition}`
  const out = t(key)
  const condition = out === key ? finding.condition : out

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.(index)
        }
      }}
      className={`cursor-pointer transition-colors ${
        selected ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/40'
      }`}
    >
      <div className="flex items-start gap-3 p-3">
        {reviewMode && (
          <input
            type="checkbox"
            checked={reviewChecked}
            onChange={() => onReviewToggle?.(index)}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 h-4 w-4 accent-primary"
            aria-label={t('imaging.review.finding_accepted')}
          />
        )}
        <span
          className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">
              {condition}
              {finding.tooth_number != null && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  · {t('imaging.tooth')} {finding.tooth_number}
                </span>
              )}
            </p>
            {reviewMode && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {reviewChecked ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <X className="h-3.5 w-3.5 text-red-500" />
                )}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Progress
              value={pct}
              className="h-1.5 flex-1"
              aria-label={t('imaging.confidence')}
            />
            <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
          </div>
        </div>
      </div>
    </Card>
  )
}
