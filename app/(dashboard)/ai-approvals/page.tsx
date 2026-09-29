'use client'

/**
 * /ai-approvals — Phase 1: human decisions on sensitive AI actions.
 *
 * Minimal by design (this phase hardens the execution layer, it does not
 * redesign the UI). The page renders the tenant's pending AI action
 * requests and the actions each viewer is allowed to take — the server
 * re-checks every permission on POST, the client affordances are cosmetic.
 */

import { useLanguage } from '@/components/providers/language-provider'
import { useCallback, useEffect, useState } from 'react'

interface Approval {
  id: string
  action: string
  params: Record<string, string>
  riskLevel: string
  amount: number | null
  status: string
  requestReason: string | null
  blockReason: string | null
  patient: { firstName: string; lastName: string } | null
  requestedByName: string | null
  requestedAt: string
  expiresAt: string
  executedAt: string | null
  result: any
  canApprove: boolean
  canReject: boolean
  canCancel: boolean
  canExecute: boolean
}

export default function AiApprovalsPage() {
  const { t } = useLanguage()
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/approvals')
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Internal server error')
      const data = await res.json()
      setApprovals(data.approvals || [])
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Internal server error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function decide(id: string, decision: 'approve' | 'reject' | 'cancel' | 'execute') {
    setBusy(id + decision)
    try {
      const res = await fetch(`/api/ai/approvals/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Internal server error')
      await load()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setBusy(null)
    }
  }

  const pending = approvals.filter((a) => a.status === 'PENDING')
  const recent = approvals.filter((a) => a.status !== 'PENDING')

  const statusLabel = (s: string) =>
    t(`aiApprovals.status.${s.toLowerCase()}` as never) ?? s

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

  if (loading) return <div className="p-6 text-sm text-muted-foreground">…</div>

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('aiApprovals.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('aiApprovals.subtitle')}</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Pending */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('aiApprovals.pending')} ({pending.length})
        </h2>
        {pending.length === 0 && (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {t('aiApprovals.empty')}
          </p>
        )}
        {pending.map((a) => (
          <div key={a.id} className="rounded-lg border p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-mono text-sm font-medium">{a.action}</span>
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {a.riskLevel}
                </span>
              </div>
              <div className="flex gap-2">
                {a.canApprove && (
                  <button
                    onClick={() => decide(a.id, 'approve')}
                    disabled={busy !== null}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {t('aiApprovals.approve')}
                  </button>
                )}
                {a.canReject && (
                  <button
                    onClick={() => decide(a.id, 'reject')}
                    disabled={busy !== null}
                    className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  >
                    {t('aiApprovals.reject')}
                  </button>
                )}
                {a.canCancel && (
                  <button
                    onClick={() => decide(a.id, 'cancel')}
                    disabled={busy !== null}
                    className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground disabled:opacity-50"
                  >
                    {t('aiApprovals.cancel')}
                  </button>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">{t('aiApprovals.patient')}</dt>
                <dd>{a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('aiApprovals.amount')}</dt>
                <dd>{a.amount !== null ? `EGP ${a.amount.toLocaleString()}` : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('aiApprovals.requestedBy')}</dt>
                <dd>{a.requestedByName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('aiApprovals.expiresAt')}</dt>
                <dd>{fmt(a.expiresAt)}</dd>
              </div>
            </dl>

            {a.requestReason && (
              <p className="text-sm text-muted-foreground">
                <span className="text-xs text-muted-foreground/70">{t('aiApprovals.reason')}:</span>{' '}
                {a.requestReason}
              </p>
            )}
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(a.params, null, 2)}
            </pre>
          </div>
        ))}
      </section>

      {/* Recent */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('aiApprovals.recent')}
        </h2>
        {recent.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
        {recent.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-mono">{a.action}</span>
              <span className="text-muted-foreground">{statusLabel(a.status)}</span>
              {a.blockReason && (
                <span className="text-xs text-muted-foreground/70">({a.blockReason})</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {a.canExecute && a.status === 'APPROVED' && (
                <button
                  onClick={() => decide(a.id, 'execute')}
                  disabled={busy !== null}
                  className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                >
                  {t('aiApprovals.execute')}
                </button>
              )}
              <span>{fmt(a.requestedAt)}</span>
              {a.executedAt && <span>{fmt(a.executedAt)}</span>}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
