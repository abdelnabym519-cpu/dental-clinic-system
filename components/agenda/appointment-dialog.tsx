'use client'

import { useEffect, useState } from 'react'

import { useLanguage } from '@/components/providers/language-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, AlertTriangle } from 'lucide-react'
import { toDateKey } from '@/lib/agenda-utils'

export interface AppointmentDialogAppointment {
  id?: string
  patientId?: string
  doctorId?: string
  scheduledDate?: string // YYYY-MM-DD
  scheduledTime?: string // HH:MM
  duration?: number
  appointmentType?: string
  priority?: string
  chiefComplaint?: string | null
  notes?: string | null
  roomId?: string | null
  contactPhone?: string | null
}

interface AppointmentDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  patients: Array<{ id: string; patientId: string; firstName: string; lastName: string }>
  doctors: Array<{ id: string; firstName: string; lastName: string; specialization?: string | null }>
  /** Clinical rooms (Agenda Phase 2). Omit to hide the room selector. */
  rooms?: Array<{ id: string; name: string }>
  /** Preselected defaults (e.g. date clicked on the agenda). */
  defaults?: { scheduledDate?: string; scheduledTime?: string; doctorId?: string }
  /** When set, the dialog edits this appointment instead of creating one. */
  appointment?: AppointmentDialogAppointment | null
}

const RECURRENCE_PATTERNS = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']

const DURATIONS = [15, 30, 45, 60, 90, 120]
const TYPES = ['CONSULTATION', 'CHECK_UP', 'PROCEDURE', 'FOLLOW_UP', 'EMERGENCY']
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

/**
 * Create / edit appointment dialog for the Agenda workspace.
 * Persists through /api/appointments (POST) and /api/appointments/[id] (PUT);
 * server-side validation errors (including 409 schedule conflicts) are shown inline.
 */
export function AppointmentDialog({
  open,
  onClose,
  onSaved,
  patients,
  doctors,
  rooms,
  defaults,
  appointment,
}: AppointmentDialogProps) {
  const { t } = useLanguage()
  const editing = Boolean(appointment?.id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    patientId: '',
    doctorId: '',
    scheduledDate: '',
    scheduledTime: '09:00',
    duration: '30',
    appointmentType: 'CONSULTATION',
    priority: 'NORMAL',
    chiefComplaint: '',
    notes: '',
    roomId: 'none',
    contactPhone: '',
  })
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false)
  const [recurrence, setRecurrence] = useState({
    pattern: 'WEEKLY',
    count: '4',
    endDate: '',
  })

  useEffect(() => {
    if (!open) return
    setError(null)
    setRecurrenceEnabled(false)
    setRecurrence({ pattern: 'WEEKLY', count: '4', endDate: '' })
    if (appointment) {
      setForm({
        patientId: appointment.patientId || '',
        doctorId: appointment.doctorId || '',
        scheduledDate: appointment.scheduledDate || '',
        scheduledTime: appointment.scheduledTime || '09:00',
        duration: String(appointment.duration ?? 30),
        appointmentType: appointment.appointmentType || 'CONSULTATION',
        priority: appointment.priority || 'NORMAL',
        chiefComplaint: appointment.chiefComplaint || '',
        notes: appointment.notes || '',
        roomId: appointment.roomId || 'none',
        contactPhone: appointment.contactPhone || '',
      })
    } else {
      setForm({
        patientId: '',
        doctorId: defaults?.doctorId || '',
        scheduledDate: defaults?.scheduledDate || new Date().toISOString().slice(0, 10),
        scheduledTime: defaults?.scheduledTime || '09:00',
        duration: '30',
        appointmentType: 'CONSULTATION',
        priority: 'NORMAL',
        chiefComplaint: '',
        notes: '',
        roomId: 'none',
        contactPhone: '',
      })
    }
  }, [open, appointment, defaults])

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = async () => {
    setError(null)

    if (!form.patientId || !form.doctorId || !form.scheduledDate || !form.scheduledTime) {
      setError('Patient, provider, date, and start time are required.')
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        patientId: form.patientId,
        doctorId: form.doctorId,
        scheduledDate: form.scheduledDate,
        scheduledTime: form.scheduledTime,
        duration: parseInt(form.duration, 10),
        appointmentType: form.appointmentType,
        priority: form.priority,
        chiefComplaint: form.chiefComplaint || undefined,
        notes: form.notes || undefined,
        roomId: form.roomId && form.roomId !== 'none' ? form.roomId : undefined,
        contactPhone: form.contactPhone.trim() || undefined,
      }
      if (!editing && recurrenceEnabled) {
        payload.recurrence = {
          pattern: recurrence.pattern,
          count: parseInt(recurrence.count, 10) || 1,
          endDate: recurrence.endDate || undefined,
        }
      }
      const res = await fetch(
        editing ? `/api/appointments/${appointment!.id}` : '/api/appointments',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save the appointment')
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the appointment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[520px]" role="dialog" aria-modal="true">
        <DialogHeader>
          <DialogTitle>{editing ? t("Edit appointment") : 'New appointment'}</DialogTitle>
          <DialogDescription>
            {editing
              ? t("Update the appointment details. Reschedules are re-checked for provider conflicts.")
              : t("Book a patient into the clinic schedule.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="apt-patient">{t('agenda.patient')}</Label>
            <Select value={form.patientId} onValueChange={set('patientId')}>
              <SelectTrigger id="apt-patient" aria-label={t('Patient')}>
                <SelectValue placeholder={t('agenda.selectPatient')} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName} ({p.patientId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="apt-doctor">{t('agenda.provider')}</Label>
            <Select value={form.doctorId} onValueChange={set('doctorId')}>
              <SelectTrigger id="apt-doctor" aria-label={t('Provider')}>
                <SelectValue placeholder={t('agenda.selectProvider')} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {t("Dr.")} {d.firstName} {d.lastName}
                    {d.specialization ? ` — ${d.specialization}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="apt-date">{t('common.date')}</Label>
              <Input
                id="apt-date"
                type="date"
                value={form.scheduledDate}
                onChange={(e) => set('scheduledDate')(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apt-time">{t('agenda.startTime')}</Label>
              <Input
                id="apt-time"
                type="time"
                value={form.scheduledTime}
                onChange={(e) => set('scheduledTime')(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="apt-duration">{t('common.duration')}</Label>
              <Select value={form.duration} onValueChange={set('duration')}>
                <SelectTrigger id="apt-duration" aria-label={t('Duration')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} {t("min")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apt-type">{t('agenda.type')}</Label>
              <Select value={form.appointmentType} onValueChange={set('appointmentType')}>
                <SelectTrigger id="apt-type" aria-label={t('Appointment type')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`type.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apt-priority">{t('agenda.priority')}</Label>
              <Select value={form.priority} onValueChange={set('priority')}>
                <SelectTrigger id="apt-priority" aria-label={t('Priority')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`priority.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {rooms && rooms.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="apt-room">{t('common.room')}</Label>
              <Select value={form.roomId} onValueChange={set('roomId')}>
                <SelectTrigger id="apt-room" aria-label={t('Room or chair')}>
                  <SelectValue placeholder={t('agenda.noRoom')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('agenda.noRoom')}</SelectItem>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('Room double-bookings are rejected by the server.')}
              </p>
            </div>
          )}

          {!editing && (
            <fieldset className="rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{t('agenda.repeat')}</legend>
              <label className="mb-3 flex items-center gap-2 text-sm" htmlFor="apt-recurrence">
                <input
                  id="apt-recurrence"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={recurrenceEnabled}
                  onChange={(e) => setRecurrenceEnabled(e.target.checked)}
                  aria-label={t('Repeat this appointment as a series')}
                />
                {t('Repeat this appointment as a series')}
              </label>
              {recurrenceEnabled && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="apt-rec-pattern" className="text-xs">
                      {t('Pattern')}
                    </Label>
                    <Select
                      value={recurrence.pattern}
                      onValueChange={(v) => setRecurrence((r) => ({ ...r, pattern: v }))}
                    >
                      <SelectTrigger id="apt-rec-pattern" aria-label={t('Recurrence pattern')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RECURRENCE_PATTERNS.map((pattern) => (
                          <SelectItem key={pattern} value={pattern}>
                            {pattern === 'BIWEEKLY' ? t("Every 2 weeks") : pattern.toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="apt-rec-count" className="text-xs">
                      {t('Occurrences')}
                    </Label>
                    <Input
                      id="apt-rec-count"
                      type="number"
                      min={1}
                      max={60}
                      value={recurrence.count}
                      onChange={(e) => setRecurrence((r) => ({ ...r, count: e.target.value }))}
                      aria-label={t('Number of occurrences (max 60)')}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="apt-rec-end" className="text-xs">
                      {t("Until (optional)")}
                    </Label>
                    <Input
                      id="apt-rec-end"
                      type="date"
                      value={recurrence.endDate}
                      onChange={(e) => setRecurrence((r) => ({ ...r, endDate: e.target.value }))}
                      aria-label={t('Series end date (optional, overrides occurrences)')}
                    />
                  </div>
                </div>
              )}
              {recurrenceEnabled && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("Each occurrence is booked as a real appointment and conflict-checked individually (max 60). Editing later offers this-occurrence / future / whole series scope.")}
                </p>
              )}
            </fieldset>
          )}

          <div className="grid gap-2">
            <Label htmlFor="apt-complaint">{t('Chief complaint')}</Label>
            <Input
              id="apt-complaint"
              value={form.chiefComplaint}
              onChange={(e) => set('chiefComplaint')(e.target.value)}
              placeholder={t("e.g. Tooth pain, upper right")}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="apt-contact-phone">{t("WhatsApp number override (optional)")}</Label>
            <Input
              id="apt-contact-phone"
              value={form.contactPhone}
              onChange={(e) => set('contactPhone')(e.target.value)}
              placeholder={t("e.g. 01012345678 — confirmation & reminders go here")}
              aria-label={t('WhatsApp contact number override')}
            />
            <p className="text-xs text-muted-foreground">
              {t("Leave empty to use the patient's stored number. Invalid numbers are skipped safely.")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="apt-notes">{t('Notes')}</Label>
            <Textarea
              id="apt-notes"
              value={form.notes}
              onChange={(e) => set('notes')(e.target.value)}
              rows={2}
              placeholder={t('Internal notes (optional)')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('Cancel')}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editing ? t("Save changes") : 'Book appointment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
