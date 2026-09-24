'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '@/components/providers/language-provider'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Loader2, Plus, Stethoscope } from 'lucide-react'
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

interface PlanItem {
  id: string
  toothNumbers: string | null
  priority: number
  estimatedCost: number | string | null
  status: string
  notes: string | null
  procedure: { id: string; code: string; name: string; category: string }
}

interface Plan {
  id: string
  planNumber: string
  appointmentId: string | null
  title: string
  description: string | null
  chiefComplaint: string | null
  diagnosis: string | null
  status: string
  estimatedCost: number | string
  currency: string
  startDate: string | null
  expectedEndDate: string | null
  consentGiven: boolean
  items: PlanItem[]
  doctor: { firstName: string; lastName: string } | null
}

interface ProcedureOption {
  id: string
  code: string
  name: string
  category: string
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-700',
  PROPOSED: 'bg-amber-100 text-amber-800',
  ACCEPTED: 'bg-sky-100 text-sky-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

const ITEM_STATUSES = ['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']

/**
 * Phase 11 — treatment plan panel (embedded in the appointment detail).
 * Shows the plan linked to the appointment (or the patient's latest plan),
 * lets DOCTOR/ADMIN create plans, add procedure items (from the clinic's
 * Procedure catalog) and toggle item/plan status. RECEPTIONIST is read-only
 * (canEdit=false hides every write action).
 */
export function TreatmentPlanPanel({
  appointmentId,
  patientId,
  canEdit,
}: {
  appointmentId: string
  patientId: string
  canEdit: boolean
}) {
  const { t, locale } = useLanguage()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  // Create/edit form
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({
    title: '',
    chiefComplaint: '',
    diagnosis: '',
    estimatedCost: '',
    expectedEndDate: '',
    notes: '',
  })
  const [editing, setEditing] = useState(false)

  // Add-item form
  const [itemOpen, setItemOpen] = useState(false)
  const [procedures, setProcedures] = useState<ProcedureOption[]>([])
  const [itemForm, setItemForm] = useState({
    procedureId: '',
    toothNumbers: '',
    priority: '1',
    estimatedCost: '',
    notes: '',
  })

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/treatment-plans?patientId=${patientId}&limit=50`)
      if (!res.ok) throw new Error(t('clinical.load_error'))
      setError('')
      const data = await res.json()
      // Legacy contract: { treatmentPlans, pagination } (array tolerated).
      const plans: Plan[] = Array.isArray(data) ? data : (data.treatmentPlans ?? data.data ?? [])
      // Prefer the plan linked to this appointment, else the patient's latest.
      setPlan(plans.find((p) => p.appointmentId === appointmentId) ?? plans[0] ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setLoading(false)
    }
  }, [patientId, appointmentId, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!itemOpen) return
    fetch('/api/procedures?limit=100')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('x'))))
      .then((d) => setProcedures(d.data ?? []))
      .catch(() => setProcedures([]))
  }, [itemOpen])

  const openCreate = () => {
    setForm({
      title: '',
      chiefComplaint: '',
      diagnosis: '',
      estimatedCost: '',
      expectedEndDate: '',
      notes: '',
    })
    setEditing(false)
    setFormOpen(true)
  }

  const openEdit = () => {
    if (!plan) return
    setForm({
      title: plan.title,
      chiefComplaint: plan.chiefComplaint ?? '',
      diagnosis: plan.diagnosis ?? '',
      estimatedCost: String(plan.estimatedCost ?? ''),
      expectedEndDate: plan.expectedEndDate ? plan.expectedEndDate.slice(0, 10) : '',
      notes: plan.description ?? '',
    })
    setEditing(true)
    setFormOpen(true)
  }

  const submitForm = async () => {
    setBusy(true)
    setMessage('')
    try {
      const body = {
        title: form.title,
        chiefComplaint: form.chiefComplaint || undefined,
        diagnosis: form.diagnosis || undefined,
        estimatedCost: form.estimatedCost ? Number(form.estimatedCost) : undefined,
        expectedEndDate: form.expectedEndDate || undefined,
        notes: form.notes || undefined,
        appointmentId,
      }
      const res = editing
        ? await fetch(`/api/treatment-plans/${plan!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/treatment-plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, patientId }),
          })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('clinical.load_error'))
      setMessage(t('clinical.saved'))
      setFormOpen(false)
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setBusy(false)
    }
  }

  const addItem = async () => {
    if (!plan || !itemForm.procedureId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/treatment-plans/${plan.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          procedureId: itemForm.procedureId,
          toothNumbers: itemForm.toothNumbers || undefined,
          priority: Number(itemForm.priority) || 1,
          estimatedCost: itemForm.estimatedCost ? Number(itemForm.estimatedCost) : undefined,
          notes: itemForm.notes || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('clinical.load_error'))
      setItemOpen(false)
      setItemForm({
        procedureId: '',
        toothNumbers: '',
        priority: '1',
        estimatedCost: '',
        notes: '',
      })
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setBusy(false)
    }
  }

  const setItemStatus = async (itemId: string, status: string) => {
    if (!plan) return
    try {
      const res = await fetch(`/api/treatment-plans/${plan.id}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('clinical.load_error'))
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('clinical.load_error'))
    }
  }

  const setPlanStatus = async (status: string) => {
    if (!plan) return
    try {
      const res = await fetch(`/api/treatment-plans/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('clinical.load_error'))
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('clinical.load_error'))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('ui.loading')}
      </div>
    )
  }

  const itemsTotal = plan
    ? plan.items.reduce((sum, i) => sum + (Number(i.estimatedCost) || 0), 0)
    : 0

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800" role="status">
          {message}
        </p>
      )}

      {!plan ? (
        <div className="space-y-3 py-4 text-center">
          <p className="text-sm text-muted-foreground">{t('clinical.no_plan')}</p>
          {canEdit && (
            <Button onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" /> {t('clinical.create_plan')}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">{plan.title}</h3>
                <Badge className={STATUS_COLORS[plan.status] ?? 'bg-zinc-100 text-zinc-700'}>
                  {t(`clinical.status.${plan.status}`)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {plan.planNumber}
                {plan.doctor ? ` — Dr. ${plan.doctor.firstName} ${plan.doctor.lastName}` : ''}
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={openEdit}>
                  {t('ui.edit')}
                </Button>
                {plan.status !== 'COMPLETED' && plan.status !== 'CANCELLED' && (
                  <Button variant="outline" size="sm" onClick={() => setItemOpen(true)}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> {t('clinical.add_procedure')}
                  </Button>
                )}
              </div>
            )}
          </div>

          {(plan.chiefComplaint || plan.diagnosis) && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              {plan.chiefComplaint && (
                <div>
                  <span className="text-muted-foreground">{t('clinical.chief_complaint')}: </span>
                  {plan.chiefComplaint}
                </div>
              )}
              {plan.diagnosis && (
                <div>
                  <span className="text-muted-foreground">{t('clinical.diagnosis')}: </span>
                  {plan.diagnosis}
                </div>
              )}
            </div>
          )}

          {canEdit && !['COMPLETED', 'CANCELLED'].includes(plan.status) && (
            <div className="flex items-center gap-2">
              <Label className="text-sm">{t('ui.status')}</Label>
              <Select value={plan.status} onValueChange={setPlanStatus}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['DRAFT', 'PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(
                    (s) => (
                      <SelectItem key={s} value={s}>
                        {t(`clinical.status.${s}`)}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {plan.items.length > 0 && (
            <div className="space-y-2">
              {plan.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.procedure.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.procedure.code}
                      {item.toothNumbers
                        ? ` · ${t('clinical.tooth_numbers')}: ${item.toothNumbers}`
                        : ''}
                      {' · '}
                      {t('clinical.priority')}: {item.priority}
                      {Number(item.estimatedCost) > 0
                        ? ` · ${Number(item.estimatedCost)} ${plan.currency}`
                        : ''}
                    </p>
                  </div>
                  {canEdit ? (
                    <Select value={item.status} onValueChange={(v) => setItemStatus(item.id, v)}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ITEM_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {t(`clinical.status.${s}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge className={STATUS_COLORS[item.status] ?? 'bg-zinc-100 text-zinc-700'}>
                      {t(`clinical.status.${item.status}`)}
                    </Badge>
                  )}
                </div>
              ))}
              <Separator />
              <div className="flex justify-end text-sm font-semibold">
                {t('clinical.total_estimated')}: {itemsTotal}{' '}
                {plan.currency === 'EGP' ? t('clinical.egp') : plan.currency}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create / edit plan dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? t('clinical.update_plan') : t('clinical.new_plan')}
            </DialogTitle>
            <DialogDescription>{t('clinical.treatment_plan')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>{t('clinical.plan_title')} *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="خطة علاج التسوس — الأسنان العلوية"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('clinical.chief_complaint')}</Label>
              <Textarea
                rows={2}
                value={form.chiefComplaint}
                onChange={(e) => setForm({ ...form, chiefComplaint: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('clinical.diagnosis')}</Label>
              <Textarea
                rows={2}
                value={form.diagnosis}
                onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('ui.notes')}</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>
                  {t('clinical.estimated_cost')} ({t('clinical.egp')})
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.estimatedCost}
                  onChange={(e) => setForm({ ...form, estimatedCost: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('ui.date')}</Label>
                <Input
                  type="date"
                  value={form.expectedEndDate}
                  onChange={(e) => setForm({ ...form, expectedEndDate: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submitForm} disabled={busy || form.title.trim().length < 3}>
              {busy ? t('ui.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add procedure item dialog */}
      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('clinical.add_procedure')}</DialogTitle>
            <DialogDescription>{plan?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>{t('clinical.select_procedure')} *</Label>
              <Select
                value={itemForm.procedureId || undefined}
                onValueChange={(v) => setItemForm({ ...itemForm, procedureId: v ?? '' })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('clinical.select_procedure')} />
                </SelectTrigger>
                <SelectContent>
                  {procedures.length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">
                      {t('clinical.no_procedures')}
                    </div>
                  ) : (
                    procedures.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('clinical.tooth_numbers')}</Label>
                <Input
                  value={itemForm.toothNumbers}
                  onChange={(e) => setItemForm({ ...itemForm, toothNumbers: e.target.value })}
                  placeholder="16, 26"
                />
              </div>
              <div className="space-y-1">
                <Label>{t('clinical.priority')}</Label>
                <Input
                  type="number"
                  min="1"
                  value={itemForm.priority}
                  onChange={(e) => setItemForm({ ...itemForm, priority: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>
                {t('clinical.estimated_cost')} ({plan?.currency ?? 'EGP'})
              </Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={itemForm.estimatedCost}
                onChange={(e) => setItemForm({ ...itemForm, estimatedCost: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={addItem} disabled={busy || !itemForm.procedureId}>
              {busy ? t('ui.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
