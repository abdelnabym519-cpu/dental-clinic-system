'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClipboardList, Hourglass, BarChart3, UserPlus, Loader2 } from 'lucide-react'
import {
  appointmentStatusConfig,
  formatTime,
  getPatientName,
  getDoctorName,
} from '@/lib/appointment-utils'
import { toDateKey } from '@/lib/agenda-utils'

interface QueueAppointment {
  id: string
  appointmentNo: string
  scheduledTime: string
  duration: number
  status: string
  patient: { id?: string; firstName: string; lastName: string }
  doctor: { firstName: string; lastName: string }
}

export interface WaitlistEntry {
  id: string
  status: string
  preferredTime: string | null
  notes: string | null
  createdAt: string
  patient: { id: string; patientId: string; firstName: string; lastName: string }
  doctor?: { id: string; firstName: string; lastName: string } | null
  procedure?: { name: string } | null
}

interface AnalyticsData {
  total: number
  completed: number
  cancelled: number
  noShow: number
  upcoming: number
  bookedMinutes: number
  completedRate: number
  cancellationRate: number
  noShowRate: number
  clinic: { occupancyPercent: number; availablePercent: number; capacityMinutes: number }
  doctorUtilization: Array<{ doctorId: string; bookedMinutes: number; utilization: number }>
  period: { from: string; to: string; days: number }
}

export interface AgendaPanelCapabilities {
  /** Check-in / queue actions (RECEPTIONIST + ADMIN per RBAC matrix). */
  canCheckIn: boolean
  /** Clinical status progression + no-show (DOCTOR + ADMIN). */
  canAdvance: boolean
  /** Waitlist management (RECEPTIONIST + ADMIN). */
  canWaitlist: boolean
  /** Scheduling analytics (ADMIN + DOCTOR). */
  canViewAnalytics: boolean
}

const QUEUE_ACTIVE = new Set(['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'])

/**
 * Agenda operations panel — today's queue, the waiting list and month
 * analytics as tabs under the calendar. All data comes from the real,
 * tenant-scoped appointment / waitlist / analytics endpoints; server RBAC
 * is authoritative, these flags only shape the UI.
 */
export function AgendaOperationsPanel({
  capabilities,
  refreshKey,
  onChanged,
  onOpenAppointment,
}: {
  capabilities: AgendaPanelCapabilities
  refreshKey: number
  onChanged: () => void
  onOpenAppointment: (id: string) => void
}) {
  const { t } = useLanguage()
  const showAny =
    capabilities.canCheckIn || capabilities.canWaitlist || capabilities.canViewAnalytics
  if (!showAny) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Clinic operations</CardTitle>
        <CardDescription>
          Today&apos;s queue, the waiting list and this month&apos;s scheduling analytics
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={capabilities.canCheckIn ? 'queue' : capabilities.canWaitlist ? 'waitlist' : 'analytics'}>
          <TabsList className="mb-3">
            {capabilities.canCheckIn && (
              <TabsTrigger value="queue" className="gap-2">
                <ClipboardList className="h-4 w-4" /> Queue
              </TabsTrigger>
            )}
            {capabilities.canWaitlist && (
              <TabsTrigger value="waitlist" className="gap-2">
                <Hourglass className="h-4 w-4" /> Waiting list
              </TabsTrigger>
            )}
            {capabilities.canViewAnalytics && (
              <TabsTrigger value="analytics" className="gap-2">
                <BarChart3 className="h-4 w-4" /> Analytics
              </TabsTrigger>
            )}
          </TabsList>
          {capabilities.canCheckIn && (
            <TabsContent value="queue">
              <TodayQueue
                capabilities={capabilities}
                refreshKey={refreshKey}
                onChanged={onChanged}
                onOpenAppointment={onOpenAppointment}
              />
            </TabsContent>
          )}
          {capabilities.canWaitlist && (
            <TabsContent value="waitlist">
              <WaitingListPanel refreshKey={refreshKey} onChanged={onChanged} />
            </TabsContent>
          )}
          {capabilities.canViewAnalytics && (
            <TabsContent value="analytics">
              <AnalyticsSummary />
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  )
}

/** Today's queue: active appointments in time order with one-click transitions. */
function TodayQueue({
  capabilities,
  refreshKey,
  onChanged,
  onOpenAppointment,
}: {
  capabilities: AgendaPanelCapabilities
  refreshKey: number
  onChanged: () => void
  onOpenAppointment: (id: string) => void
}) {
  const { t } = useLanguage()
  const [items, setItems] = useState<QueueAppointment[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/appointments?view=list&date=${toDateKey(new Date())}`)
      if (!res.ok) throw new Error('Failed to load the queue')
      const data = await res.json()
      const list: QueueAppointment[] = (data.appointments ?? []).filter((a: QueueAppointment) =>
        QUEUE_ACTIVE.has(a.status)
      )
      list.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
      setItems(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the queue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const setStatus = async (apt: QueueAppointment, status: string) => {
    if (busyId) return
    setBusyId(apt.id)
    setError(null)
    try {
      const res = await fetch(`/api/appointments/${apt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to update ${apt.appointmentNo}`)
      }
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update the appointment')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div data-testid="today-queue">
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading queue…
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          No active appointments for today. Booked patients appear here in arrival order.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((apt) => (
            <li key={apt.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="w-16 text-sm font-medium">{formatTime(apt.scheduledTime)}</span>
              <button
                type="button"
                className="text-sm font-medium hover:underline"
                onClick={() => onOpenAppointment(apt.id)}
              >
                {getPatientName(apt.patient)}
              </button>
              <span className="text-xs text-muted-foreground">
                Dr. {getDoctorName(apt.doctor)} · {apt.duration}m
              </span>
              <Badge variant="outline" className="ml-auto text-[10px]">
                {appointmentStatusConfig[apt.status]?.label ?? apt.status}
              </Badge>
              <span className="flex gap-1">
                {capabilities.canCheckIn &&
                  (apt.status === 'SCHEDULED' || apt.status === 'CONFIRMED') && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={busyId === apt.id}
                      aria-label={`Check in ${getPatientName(apt.patient)}`}
                      onClick={() => setStatus(apt, 'CHECKED_IN')}
                    >{t('ui.check_in_2')}</Button>
                  )}
                {capabilities.canAdvance && apt.status === 'CHECKED_IN' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={busyId === apt.id}
                    aria-label={`Start visit for ${getPatientName(apt.patient)}`}
                    onClick={() => setStatus(apt, 'IN_PROGRESS')}
                  >{t('ui.start')}</Button>
                )}
                {capabilities.canAdvance && apt.status === 'IN_PROGRESS' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={busyId === apt.id}
                    aria-label={`Complete visit for ${getPatientName(apt.patient)}`}
                    onClick={() => setStatus(apt, 'COMPLETED')}
                  >{t('ui.complete')}</Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Waiting list: ACTIVE entries with promote-to-appointment (opens the dialog pre-filled). */
function WaitingListPanel({
  refreshKey,
  onChanged,
}: {
  refreshKey: number
  onChanged: () => void
}) {
  const { t } = useLanguage()
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/appointments/waitlist?status=ACTIVE')
      if (!res.ok) throw new Error('Failed to load the waiting list')
      const data = await res.json()
      const list: WaitlistEntry[] = data.entries ?? []
      setEntries(Array.isArray(list) ? list : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the waiting list')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const promote = async (entry: WaitlistEntry) => {
    if (busyId) return
    setBusyId(entry.id)
    setError(null)
    try {
      const res = await fetch(`/api/appointments/waitlist/${entry.id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to book the waitlist entry')
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to book the waitlist entry')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div data-testid="waiting-list-panel">
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading waiting list…
        </div>
      ) : entries.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          The waiting list is empty. Patients requesting the next available slot appear here.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {entry.patient.firstName} {entry.patient.lastName}
                  {entry.doctor ? (
                    <span className="text-muted-foreground">
                      {' '}
                      · prefers Dr. {getDoctorName(entry.doctor)}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {entry.preferredTime ? `Preferred: ${entry.preferredTime.toLowerCase()}` : 'Any time'}
                  {entry.notes ? ` · ${entry.notes}` : ''}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
                  <Link href={`/patients/${entry.patient.id}`}>
                    <UserPlus className="h-3.5 w-3.5 mr-1" />{t('ui.patient')}</Link>
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busyId === entry.id}
                  aria-label={`Book ${entry.patient.firstName} ${entry.patient.lastName} from the waiting list`}
                  onClick={() => promote(entry)}
                >
                  {busyId === entry.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    'Book next slot'
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Month-to-date scheduling analytics, computed from real appointment records. */
function AnalyticsSummary() {
  const { t } = useLanguage()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch('/api/appointments/analytics')
        if (!res.ok) throw new Error('Failed to load analytics')
        const json = await res.json()
        if (!json || typeof json.total !== 'number' || !json.clinic) {
          throw new Error('Unexpected analytics payload')
        }
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load analytics')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Computing analytics…
      </div>
    )
  }
  if (error || !data) {
    return (
      <p role="alert" className="py-2 text-sm text-destructive">
        {error || 'Analytics unavailable'}
      </p>
    )
  }

  const stats: Array<{ label: string; value: string; hint?: string }> = [
    { label: 'Appointments', value: String(data.total) },
    { label: 'Completed', value: `${data.completed} (${data.completedRate}%)` },
    { label: 'Cancelled', value: `${data.cancelled} (${data.cancellationRate}%)` },
    { label: 'No-shows', value: `${data.noShow} (${data.noShowRate}%)` },
    {
      label: 'Clinic occupancy',
      value: `${data.clinic.occupancyPercent}%`,
      hint: `${Math.round(data.bookedMinutes / 60)}h booked this period`,
    },
  ]

  return (
    <div data-testid="analytics-summary">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-xl font-semibold">{s.value}</p>
            {s.hint && <p className="text-[10px] text-muted-foreground">{s.hint}</p>}
          </div>
        ))}
      </div>
      {data.doctorUtilization.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Doctor utilization (booked vs. published shift minutes)
          </p>
          <ul className="space-y-2">
            {data.doctorUtilization.map((d) => (
              <li key={d.doctorId} className="flex items-center gap-3 text-sm">
                <span className="w-24 truncate text-xs text-muted-foreground">{d.doctorId}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary/70"
                    style={{ width: `${Math.min(100, d.utilization)}%` }}
                  />
                </div>
                <span className="w-14 text-right text-xs">{d.utilization}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[10px] text-muted-foreground">
        Period {data.period.from} → {data.period.to} · computed from live appointment records
      </p>
    </div>
  )
}
