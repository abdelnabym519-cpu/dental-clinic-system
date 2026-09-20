'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RefreshCw, Loader2 } from 'lucide-react'

/**
 * Message log / audit panel (master prompt 3L) — ADMIN only. Shows every
 * outbound message with the recipient number masked (01x****xxxx style);
 * attachment bytes never leave the server.
 */

interface LogRow {
  id: string
  recipientMasked: string
  channel: string
  provider: string | null
  messageType: string
  status: string
  scheduledAt: string
  sentAt: string | null
  attempts: number
  lastError: string | null
  textPreview: string
  hasAttachment: boolean
}

const TYPE_LABELS: Record<string, string> = {
  APPOINTMENT_CONFIRMATION: 'تأكيد موعد',
  APPOINTMENT_REMINDER_24H: 'تذكير ٢٤ ساعة',
  APPOINTMENT_REMINDER_1H: 'تذكير ساعة',
  DOCTOR_NEW_APPOINTMENT: 'إشعار طبيب',
  DOCTOR_CANCELLATION: 'إلغاء موعد',
  DOCTOR_RESCHEDULE: 'تغيير موعد',
  PRESCRIPTION: 'وصفة طبية',
  INVOICE: 'فاتورة',
  RADIOLOGY: 'أشعة',
  REVIEW_REQUEST: 'طلب تقييم',
  TEST: 'اختبار',
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  SENT: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-zinc-100 text-zinc-600',
}

export function MessageLogPanel() {
  const [rows, setRows] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('all')
  const [channel, setChannel] = useState('all')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams()
      if (status !== 'all') params.set('status', status)
      if (channel !== 'all') params.set('channel', channel)
      const res = await fetch(`/api/communications/messages?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load the message log')
      const data = await res.json()
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the message log')
    } finally {
      setLoading(false)
    }
  }, [status, channel])

  useEffect(() => {
    load()
  }, [load])

  const act = async (id: string, action: 'cancel' | 'retry') => {
    if (busyId) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/communications/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error('Action failed')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div data-testid="message-log-panel" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="SENT">Sent</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="w-[150px]" aria-label="Filter by channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
            <SelectItem value="SMS">SMS</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load} aria-label="Refresh message log">
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{total} messages</span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading messages…
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          No messages yet. Appointment confirmations, reminders, prescriptions and invoices appear
          here once queued.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border" data-testid="message-log-table">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Recipient</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Scheduled / Sent</th>
                <th className="px-3 py-2">Message</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-3 py-2 font-mono text-xs">{row.recipientMasked}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}
                    {row.provider ? (
                      <span className="block text-[10px] text-muted-foreground">{row.provider}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {TYPE_LABELS[row.messageType] ?? row.messageType}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        STATUS_STYLES[row.status] ?? ''
                      }`}
                    >
                      {row.status}
                    </span>
                    {row.attempts > 0 && (
                      <span className="block text-[10px] text-muted-foreground">
                        {row.attempts} attempt{row.attempts > 1 ? 's' : ''}
                      </span>
                    )}
                    {row.lastError && (
                      <span
                        className="mt-1 block max-w-[180px] truncate text-[10px] text-destructive"
                        title={row.lastError}
                      >
                        {row.lastError}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(row.scheduledAt).toLocaleString()}
                    {row.sentAt && (
                      <span className="block">✓ {new Date(row.sentAt).toLocaleString()}</span>
                    )}
                  </td>
                  <td className="max-w-[260px] px-3 py-2 text-xs">
                    <span className="line-clamp-2">{row.textPreview}</span>
                    {row.hasAttachment && (
                      <Badge variant="outline" className="mt-1 text-[10px]">
                        مرفق 📎
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.status === 'PENDING' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={busyId === row.id}
                        onClick={() => act(row.id, 'cancel')}
                      >
                        Cancel
                      </Button>
                    )}
                    {row.status === 'FAILED' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={busyId === row.id}
                        onClick={() => act(row.id, 'retry')}
                      >
                        Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        Recipient numbers are masked for privacy. Delivery requires configured provider
        credentials; without them the built-in test provider is used.
      </p>
    </div>
  )
}
