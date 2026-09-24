'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '@/components/providers/language-provider'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FileText, Loader2, Pencil, Pill, Plus, Send, Stamp } from 'lucide-react'

interface RxMedication {
  id: string
  medicationName: string
  dosage: string
  frequency: string
  duration: string
  route: string
  timing: string | null
  quantity: number | null
  instructions: string | null
}

interface Prescription {
  id: string
  prescriptionNo: string
  diagnosis: string | null
  notes: string | null
  status: string
  issuedAt: string | null
  validUntil: string | null
  sentViaWhatsApp: boolean
  whatsappSentAt: string | null
  appointmentId: string | null
  medications: RxMedication[]
}

interface MedDraft {
  medicationName: string
  dosage: string
  frequency: string
  duration: string
  instructions: string
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-700',
  SIGNED: 'bg-blue-100 text-blue-800',
  SENT: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

const EMPTY_MED: MedDraft = {
  medicationName: '',
  dosage: '',
  frequency: '',
  duration: '',
  instructions: '',
}

/**
 * Phase 11 — e-prescription form (embedded in the appointment detail).
 *
 * Flow: draft (create/edit medications) → sign (DRAFT → SIGNED, frozen) →
 * send via WhatsApp (PDF rendered server-side, queued through the Phase 6
 * MessageQueue) → SENT. The PDF preview button opens
 * /api/documents/prescription/:id in a new tab.
 *
 * RBAC: only DOCTOR/ADMIN get the write buttons (canEdit).
 */
export function PrescriptionForm({
  appointmentId,
  patientId,
  canEdit,
}: {
  appointmentId: string
  patientId: string
  canEdit: boolean
}) {
  const { t, locale } = useLanguage()
  const [rx, setRx] = useState<Prescription | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)

  const [form, setForm] = useState({ diagnosis: '', notes: '' })
  const [meds, setMeds] = useState<MedDraft[]>([{ ...EMPTY_MED }])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/prescriptions?patientId=${patientId}&limit=50`)
      if (!res.ok) throw new Error(t('clinical.load_error'))
      setError('')
      const data = await res.json()
      const list: Prescription[] = data.data ?? []
      // Prefer this appointment's prescription, else the patient's latest.
      setRx(list.find((p) => p.appointmentId === appointmentId) ?? list[0] ?? null)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setLoading(false)
    }
  }, [patientId, appointmentId, t])

  useEffect(() => {
    void load()
  }, [load])

  const startCreate = () => {
    setForm({ diagnosis: '', notes: '' })
    setMeds([{ ...EMPTY_MED }])
    setEditing(true)
  }

  const startEdit = () => {
    if (!rx) return
    setForm({ diagnosis: rx.diagnosis ?? '', notes: rx.notes ?? '' })
    setMeds(
      rx.medications.map((m) => ({
        medicationName: m.medicationName,
        dosage: m.dosage,
        frequency: m.frequency,
        duration: m.duration,
        instructions: m.instructions ?? '',
      }))
    )
    setEditing(true)
  }

  const validMeds = meds.filter(
    (m) => m.medicationName.trim() && m.dosage.trim() && m.frequency.trim() && m.duration.trim()
  )

  const saveDraft = async () => {
    setBusy(true)
    setMessage('')
    try {
      const payload = {
        diagnosis: form.diagnosis || undefined,
        notes: form.notes || undefined,
        appointmentId,
        medications: validMeds,
      }
      const res = rx
        ? await fetch(`/api/prescriptions/${rx.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/prescriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientId, ...payload }),
          })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('clinical.load_error'))
      setMessage(t('clinical.saved'))
      setEditing(false)
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setBusy(false)
    }
  }

  const sign = async () => {
    if (!rx) return
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`/api/prescriptions/${rx.id}/sign`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('clinical.load_error'))
      setMessage(`${t('clinical.sign_prescription')} ✓`)
      setEditing(false)
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!rx) return
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`/api/communications/prescriptions/${rx.id}/send`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('clinical.load_error'))
      setMessage(t('clinical.prescription_sent'))
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('ui.loading')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800" role="status">
          {message}
        </p>
      )}

      {!rx && !editing ? (
        <div className="space-y-3 py-4 text-center">
          <p className="text-sm text-muted-foreground">{t('clinical.no_prescription')}</p>
          {canEdit && (
            <Button onClick={startCreate}>
              <Plus className="mr-1 h-4 w-4" /> {t('clinical.new_prescription')}
            </Button>
          )}
        </div>
      ) : editing ? (
        /* ── Create / edit draft ── */
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t('clinical.diagnosis')}</Label>
            <Textarea
              rows={2}
              value={form.diagnosis}
              onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
            />
          </div>
          {meds.map((m, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1 text-xs">
                  <Pill className="h-3.5 w-3.5" /> {t('clinical.medication_name')} {i + 1}
                </Label>
                {meds.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive"
                    onClick={() => setMeds(meds.filter((_, j) => j !== i))}
                  >
                    {t('ui.delete')}
                  </Button>
                )}
              </div>
              <Input
                value={m.medicationName}
                onChange={(e) =>
                  setMeds(
                    meds.map((x, j) => (j === i ? { ...x, medicationName: e.target.value } : x))
                  )
                }
                placeholder="Amoxicillin"
              />
              <div className="grid grid-cols-3 gap-2">
                <Input
                  value={m.dosage}
                  onChange={(e) =>
                    setMeds(meds.map((x, j) => (j === i ? { ...x, dosage: e.target.value } : x)))
                  }
                  placeholder={t('clinical.dosage')}
                  aria-label={t('clinical.dosage_n', { v1: i + 1 })}
                />
                <Input
                  value={m.frequency}
                  onChange={(e) =>
                    setMeds(meds.map((x, j) => (j === i ? { ...x, frequency: e.target.value } : x)))
                  }
                  placeholder={t('clinical.frequency')}
                  aria-label={t('clinical.frequency_n', { v1: i + 1 })}
                />
                <Input
                  value={m.duration}
                  onChange={(e) =>
                    setMeds(meds.map((x, j) => (j === i ? { ...x, duration: e.target.value } : x)))
                  }
                  placeholder={t('clinical.duration')}
                  aria-label={t('clinical.duration_n', { v1: i + 1 })}
                />
              </div>
              <Input
                value={m.instructions}
                onChange={(e) =>
                  setMeds(
                    meds.map((x, j) => (j === i ? { ...x, instructions: e.target.value } : x))
                  )
                }
                placeholder={t('clinical.instructions')}
                aria-label={t('clinical.instructions_n', { v1: i + 1 })}
              />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setMeds([...meds, { ...EMPTY_MED }])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> {t('clinical.add_medication')}
          </Button>
          <div className="space-y-1">
            <Label>
              {t('clinical.instructions')} — {t('ui.notes')}
            </Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button onClick={saveDraft} disabled={busy || validMeds.length === 0}>
                {busy ? t('ui.loading') : t('clinical.save_draft')}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* ── Read view (existing prescription) ── */
        rx && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">
                    {t('clinical.prescription')} {rx.prescriptionNo}
                  </h3>
                  <Badge className={STATUS_COLORS[rx.status] ?? 'bg-zinc-100 text-zinc-700'}>
                    {t(`clinical.status.${rx.status}`)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {rx.issuedAt &&
                    `${t('clinical.issued_on')} ${new Date(rx.issuedAt).toLocaleString(locale)}`}
                  {rx.validUntil &&
                    ` · ${t('clinical.expires_on')} ${new Date(rx.validUntil).toLocaleDateString(locale)}`}
                  {rx.sentViaWhatsApp &&
                    rx.whatsappSentAt &&
                    ` · ${t('clinical.status.SENT')} ${new Date(rx.whatsappSentAt).toLocaleString(locale)}`}
                </p>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {rx.status === 'DRAFT' && (
                    <Button variant="outline" size="sm" onClick={startEdit}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> {t('ui.edit')}
                    </Button>
                  )}
                  {rx.status === 'DRAFT' && (
                    <Button size="sm" onClick={sign} disabled={busy || rx.medications.length === 0}>
                      <Stamp className="mr-1 h-3.5 w-3.5" /> {t('clinical.sign_prescription')}
                    </Button>
                  )}
                  {rx.status === 'SIGNED' && (
                    <Button size="sm" onClick={send} disabled={busy}>
                      <Send className="mr-1 h-3.5 w-3.5" /> {t('clinical.send_via_whatsapp')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`/api/documents/prescription/${rx.id}`, '_blank')}
                  >
                    <FileText className="mr-1 h-3.5 w-3.5" /> {t('clinical.pdf_preview')}
                  </Button>
                </div>
              )}
            </div>

            {rx.diagnosis && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <span className="text-muted-foreground">{t('clinical.diagnosis')}: </span>
                {rx.diagnosis}
              </div>
            )}

            {rx.medications.length > 0 && (
              <div className="space-y-2">
                {rx.medications.map((m) => (
                  <div key={m.id} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">
                      {m.medicationName} — {m.dosage}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.frequency} · {m.duration}
                      {m.route ? ` · ${m.route}` : ''}
                      {m.instructions ? ` — ${m.instructions}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {rx.notes && (
              <div className="text-sm">
                <span className="text-muted-foreground">{t('clinical.instructions')}: </span>
                {rx.notes}
              </div>
            )}

            {rx.status === 'DRAFT' && canEdit && (
              <p className="text-xs text-muted-foreground">{t('clinical.sign_note')}</p>
            )}
            {rx.status === 'SIGNED' && (
              <p className="text-xs text-muted-foreground">{t('clinical.send_note')}</p>
            )}
          </div>
        )
      )}
    </div>
  )
}
