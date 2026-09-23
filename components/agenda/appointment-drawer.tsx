'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  X,
  Loader2,
  Stethoscope,
  BellPlus,
  BellOff,
  FileText,
  Sparkles,
  History,
  LogIn,
  Play,
  CheckCheck,
  UserX,
} from 'lucide-react'
import {
  appointmentStatusConfig,
  appointmentTypeConfig,
  formatTime,
  getPatientName,
  getDoctorName,
} from '@/lib/appointment-utils'

interface DrawerAppointment {
  id: string
  appointmentNo: string
  scheduledDate: string
  scheduledTime: string
  duration: number
  appointmentType: string
  status: string
  priority: string
  chiefComplaint?: string | null
  notes?: string | null
  cancellationReason?: string | null
  recurrenceGroupId?: string | null
  room?: { id: string; name: string } | null
  patient: { id?: string; firstName: string; lastName: string }
  doctor: { firstName: string; lastName: string }
}

interface ReminderRow {
  id: string
  reminderType: string
  status: string
  scheduledFor: string
}

export interface DrawerCapabilities {
  canSchedule: boolean
  canCheckIn: boolean
  canAdvance: boolean
  canNoShow: boolean
  canRemind: boolean
}

/**
 * Appointment detail drawer for the Agenda — full context, one-click status
 * transitions (server-enforced), reminder infrastructure (queued records, no
 * live sending), and clinical navigation into the patient file / odontogram.
 */
export function AppointmentDrawer({
  appointmentId,
  capabilities,
  onClose,
  onChanged,
}: {
  appointmentId: string | null
  capabilities: DrawerCapabilities
  onClose: () => void
  onChanged: () => void
}) {
  const { locale } = useLanguage()
  const { t } = useLanguage()
  const [appointment, setAppointment] = useState<DrawerAppointment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reminders, setReminders] = useState<ReminderRow[]>([])
  const [remindChannel, setRemindChannel] = useState('WHATSAPP')
  const [remindAt, setRemindAt] = useState('')
  const [remindersLoading, setRemindersLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const loadReminders = useCallback(async (id: string) => {
    setRemindersLoading(true)
    try {
      const res = await fetch(`/api/appointments/reminders?appointmentId=${id}`)
      if (res.ok) {
        const data = await res.json()
        setReminders(data.reminders ?? [])
      } else {
        setReminders([])
      }
    } catch {
      setReminders([])
    } finally {
      setRemindersLoading(false)
    }
  }, [])

  // Load (or reload) the appointment detail when the drawer opens.
  useEffect(() => {
    setError(null)
    setAppointment(null)
    if (!appointmentId) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/appointments/${appointmentId}`)
        if (!res.ok) throw new Error(t('Failed to load the appointment'))
        const data = await res.json()
        if (!cancelled) {
          setAppointment(data)
          // Default reminder time: 24h before the appointment.
          const when = new Date(`${data.scheduledDate}T${data.scheduledTime}:00`)
          when.setDate(when.getDate() - 1)
          if (!Number.isNaN(when.getTime()) && when.getTime() > Date.now()) {
            const pad = (n: number) => String(n).padStart(2, '0')
            setRemindAt(
              `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`
            )
          } else {
            setRemindAt('')
          }
          loadReminders(data.id)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load the appointment')
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [appointmentId, loadReminders, reloadKey])

  if (!appointmentId || !appointment) return null

  const patientId = appointment.patient.id

  const setStatus = async (status: string, extra?: Record<string, unknown>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...extra }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update the appointment')
      onChanged()
      setReloadKey((k) => k + 1) // reflect the new status in the drawer
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update the appointment')
    } finally {
      setBusy(false)
    }
  }

  const cancelWithReason = () => {
    const reason = window.prompt('Cancellation reason (recorded on the appointment):')
    if (reason === null) return
    setStatus('CANCELLED', { cancellationReason: reason || t('Cancelled from Agenda') })
  }

  const addReminder = async () => {
    if (busy || !remindAt) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/appointments/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: appointment.id,
          channel: remindChannel,
          scheduledFor: new Date(remindAt).toISOString(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to schedule the reminder')
      await loadReminders(appointment.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule the reminder')
    } finally {
      setBusy(false)
    }
  }

  const cancelReminder = async (id: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/appointments/reminders?id=${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to cancel the reminder')
      await loadReminders(appointment.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel the reminder')
    } finally {
      setBusy(false)
    }
  }

  const statusConfig = appointmentStatusConfig[appointment.status]
  const typeConfig = appointmentTypeConfig[appointment.appointmentType]
  const status = appointment.status

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("Appointment {v1} details", { v1: appointment.appointmentNo })}>
      <button
        type="button"
        aria-label={t('Close details')}
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l bg-background p-5 shadow-xl"
        data-testid="appointment-drawer"
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">{appointment.appointmentNo}</p>
            <h2 className="text-lg font-semibold">{getPatientName(appointment.patient)}</h2>
            <p className="text-sm text-muted-foreground">
              {appointment.scheduledDate} · {formatTime(appointment.scheduledTime)} ·{' '}
              {appointment.duration} {t("min")}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('ui.close')}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <Badge className={statusConfig?.bgColor ?? ''}>
            {statusConfig?.label ?? status}
          </Badge>
          <Badge variant="outline">{typeConfig?.label ?? appointment.appointmentType}</Badge>
          <Badge variant="outline">{appointment.priority}</Badge>
          {appointment.room && <Badge variant="outline">{appointment.room.name}</Badge>}
        </div>

        {error && (
          <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* One-click status transitions */}
        <section className="mb-5">
          <h3 className="mb-2 text-sm font-semibold">{t('Visit status')}</h3>
          <div className="flex flex-wrap gap-2">
            {capabilities.canAdvance && status === 'SCHEDULED' && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus('CONFIRMED')}>{t('ui.confirm')}</Button>
            )}
            {capabilities.canCheckIn && (status === 'SCHEDULED' || status === 'CONFIRMED') && (
              <Button size="sm" disabled={busy} aria-label={t('Check in patient')} onClick={() => setStatus('CHECKED_IN')}>
                <LogIn className="h-3.5 w-3.5 mr-1" />{t('ui.check_in_2')}</Button>
            )}
            {capabilities.canAdvance && status === 'CHECKED_IN' && (
              <Button size="sm" disabled={busy} onClick={() => setStatus('IN_PROGRESS')}>
                <Play className="h-3.5 w-3.5 mr-1" />{t('ui.start_visit')}</Button>
            )}
            {capabilities.canAdvance && status === 'IN_PROGRESS' && (
              <Button size="sm" disabled={busy} onClick={() => setStatus('COMPLETED')}>
                <CheckCheck className="h-3.5 w-3.5 mr-1" />{t('ui.complete')}</Button>
            )}
            {capabilities.canNoShow && ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN'].includes(status) && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus('NO_SHOW')}>
                <UserX className="h-3.5 w-3.5 mr-1" />{t('ui.no_show_2')}</Button>
            )}
            {capabilities.canSchedule && !['CANCELLED', 'COMPLETED'].includes(status) && (
              <Button size="sm" variant="outline" disabled={busy} onClick={cancelWithReason}>
                {t("Cancel…")}
              </Button>
            )}
          </div>
          {appointment.cancellationReason && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("Cancellation reason:")} {appointment.cancellationReason}
            </p>
          )}
        </section>

        {/* Clinical context — one click into the existing patient modules */}
        {patientId && (
          <section className="mb-5">
            <h3 className="mb-2 text-sm font-semibold">{t('Clinical context')}</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href={`/patients/${patientId}?tab=appointments`}>
                  <FileText className="h-3.5 w-3.5 mr-1" /> {t("Patient file")}
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/patients/${patientId}?tab=dental-chart`}>
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> {t("Odontogram")}
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/patients/${patientId}?tab=appointments`}>
                  <History className="h-3.5 w-3.5 mr-1" /> {t("Full history")}
                </Link>
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("Treatment plans live in the patient file's Treatments tab.")}
            </p>
          </section>
        )}

        {/* Reminder infrastructure — records queued for the reminder cron; no live sending */}
        {capabilities.canRemind && (
          <section className="mb-5">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Stethoscope className="h-4 w-4" /> {t("Reminders")}
            </h3>
            {remindersLoading ? (
              <p className="text-xs text-muted-foreground">{t("Loading reminders…")}</p>
            ) : reminders.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('No reminders scheduled.')}</p>
            ) : (
              <ul className="mb-3 space-y-1">
                {reminders.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
                    <Badge variant="outline" className="text-[10px]">
                      {r.reminderType}
                    </Badge>
                    <span>{new Date(r.scheduledFor).toLocaleString(locale)}</span>
                    <span className="ml-auto font-medium">{r.status}</span>
                    {r.status !== 'SENT' && r.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        aria-label={t("Cancel reminder for {v1}", { v1: formatTime(appointment.scheduledTime) })}
                        className="rounded p-1 hover:bg-muted disabled:opacity-50"
                        disabled={busy}
                        onClick={() => cancelReminder(r.id)}
                      >
                        <BellOff className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor="drawer-remind-channel" className="text-xs">{t('ui.channel')}</Label>
                <Select value={remindChannel} onValueChange={setRemindChannel}>
                  <SelectTrigger id="drawer-remind-channel" className="w-[130px]" aria-label={t('Reminder channel')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WHATSAPP">{t('ui.whatsapp')}</SelectItem>
                    <SelectItem value="SMS">{t('ui.sms')}</SelectItem>
                    <SelectItem value="EMAIL">{t('ui.email')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="drawer-remind-at" className="text-xs">
                  {t('Send at')}
                </Label>
                <Input
                  id="drawer-remind-at"
                  type="datetime-local"
                  className="w-[220px]"
                  value={remindAt}
                  onChange={(e) => setRemindAt(e.target.value)}
                />
              </div>
              <Button size="sm" disabled={busy || !remindAt} onClick={addReminder}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellPlus className="h-3.5 w-3.5 mr-1" />}
                {t("Queue")}
              </Button>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {t("Queued reminders are processed by the clinic reminder job — no message is sent from this screen.")}
            </p>
          </section>
        )}

        <section className="space-y-2 text-sm">
          <h3 className="text-sm font-semibold">{t('Details')}</h3>
          <p>
            <span className="text-muted-foreground">{t("Provider:")}</span> {t("Dr.")}{' '}
            {getDoctorName(appointment.doctor)}
          </p>
          {appointment.chiefComplaint && (
            <p>
              <span className="text-muted-foreground">{t("Chief complaint:")}</span>{' '}
              {appointment.chiefComplaint}
            </p>
          )}
          {appointment.notes && (
            <p>
              <span className="text-muted-foreground">{t("Notes:")}</span> {appointment.notes}
            </p>
          )}
          {appointment.recurrenceGroupId && (
            <p className="text-xs text-muted-foreground">
              {t("Part of a recurring series (")}{appointment.recurrenceGroupId})
            </p>
          )}
        </section>
      </aside>
    </div>
  )
}
