'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Plus,
  Search,
  Edit,
  Trash2,
  MoreHorizontal,
  Crown,
  Users,
  Banknote,
  UserPlus,
  X,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatCurrency } from '@/lib/i18n/format'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Benefit {
  description: string
  discountPercent?: number
}

interface MembershipPlan {
  id: string
  name: string
  description: string | null
  price: number
  durationMonths: number
  benefits: Benefit[]
  maxMembers: number | null
  isActive: boolean
  _count: { memberships: number }
}

interface PatientSearchResult {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
}

interface Membership {
  id: string
  startDate: string
  endDate: string
  autoRenew: boolean
  status: string
  patient: {
    id: string
    firstName: string
    lastName: string
    phone: string | null
    email: string | null
  }
}

// ── Empty form state ───────────────────────────────────────────────────────────

const emptyPlanForm = {
  name: '',
  description: '',
  price: '',
  durationMonths: '12',
  benefits: [{ description: '', discountPercent: undefined }] as Benefit[],
  maxMembers: '',
  isActive: true,
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function MembershipPlansPage() {
  const { t, locale } = useLanguage()
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  // Plan list state
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [loading, setLoading] = useState(true)

  // Create / Edit dialog
  const [planDialogOpen, setPlanDialogOpen] = useState(false)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [planForm, setPlanForm] = useState(emptyPlanForm)
  const [savingPlan, setSavingPlan] = useState(false)

  // Enroll dialog
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false)
  const [enrollPlanId, setEnrollPlanId] = useState<string | null>(null)
  const [enrollPlanName, setEnrollPlanName] = useState('')
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>([])
  const [searchingPatients, setSearchingPatients] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null)
  const [autoRenew, setAutoRenew] = useState(true)
  const [enrolling, setEnrolling] = useState(false)

  // Plan detail view
  const [detailPlan, setDetailPlan] = useState<MembershipPlan | null>(null)
  const [detailMembers, setDetailMembers] = useState<Membership[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Debounce ref for patient search
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fetch plans ────────────────────────────────────────────────────────────

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch('/api/memberships/plans')
      if (!res.ok) throw new Error('Failed to fetch plans')
      const data = await res.json()
      setPlans(data)
    } catch {
      toast({ title: 'Failed to load membership plans', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchPlans()
  }, [fetchPlans])

  // ── Plan CRUD ──────────────────────────────────────────────────────────────

  const openCreatePlan = () => {
    setEditingPlanId(null)
    setPlanForm({ ...emptyPlanForm, benefits: [{ description: '', discountPercent: undefined }] })
    setPlanDialogOpen(true)
  }

  const openEditPlan = (plan: MembershipPlan) => {
    setEditingPlanId(plan.id)
    setPlanForm({
      name: plan.name,
      description: plan.description || '',
      price: String(plan.price),
      durationMonths: String(plan.durationMonths),
      benefits:
        plan.benefits.length > 0
          ? plan.benefits.map((b) => ({ ...b }))
          : [{ description: '', discountPercent: undefined }],
      maxMembers: plan.maxMembers ? String(plan.maxMembers) : '',
      isActive: plan.isActive,
    })
    setPlanDialogOpen(true)
  }

  const handleSavePlan = async () => {
    if (!planForm.name.trim()) {
      toast({ title: 'Plan name is required', variant: 'destructive' })
      return
    }
    if (!planForm.price || Number(planForm.price) <= 0) {
      toast({ title: 'Price must be greater than 0', variant: 'destructive' })
      return
    }
    if (!planForm.durationMonths || Number(planForm.durationMonths) <= 0) {
      toast({ title: 'Duration must be at least 1 month', variant: 'destructive' })
      return
    }

    setSavingPlan(true)
    try {
      const filteredBenefits = planForm.benefits.filter((b) => b.description.trim() !== '')
      const payload = {
        name: planForm.name.trim(),
        description: planForm.description.trim() || null,
        price: Number(planForm.price),
        durationMonths: Number(planForm.durationMonths),
        benefits: filteredBenefits,
        maxMembers: planForm.maxMembers ? Number(planForm.maxMembers) : null,
        isActive: planForm.isActive,
      }

      const url = editingPlanId
        ? `/api/memberships/plans/${editingPlanId}`
        : '/api/memberships/plans'
      const res = await fetch(url, {
        method: editingPlanId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save plan')
      }

      toast({ title: editingPlanId ? 'Plan updated' : 'Plan created' })
      setPlanDialogOpen(false)
      fetchPlans()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setSavingPlan(false)
    }
  }

  const handleDeletePlan = async (id: string) => {
    const ok = await confirm({
      title: 'Delete plan?',
      description: 'Are you sure you want to delete this plan?',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/memberships/plans/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete')
      }
      toast({ title: 'Plan deleted' })
      if (detailPlan?.id === id) setDetailPlan(null)
      fetchPlans()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    }
  }

  // ── Benefits management ────────────────────────────────────────────────────

  const addBenefit = () => {
    setPlanForm((prev) => ({
      ...prev,
      benefits: [...prev.benefits, { description: '', discountPercent: undefined }],
    }))
  }

  const removeBenefit = (index: number) => {
    setPlanForm((prev) => ({
      ...prev,
      benefits: prev.benefits.filter((_, i) => i !== index),
    }))
  }

  const updateBenefit = (index: number, field: keyof Benefit, value: string) => {
    setPlanForm((prev) => {
      const updated = [...prev.benefits]
      if (field === 'description') {
        updated[index] = { ...updated[index], description: value }
      } else if (field === 'discountPercent') {
        updated[index] = {
          ...updated[index],
          discountPercent: value ? Number(value) : undefined,
        }
      }
      return { ...prev, benefits: updated }
    })
  }

  // ── Enroll Patient ─────────────────────────────────────────────────────────

  const openEnrollDialog = (plan: MembershipPlan) => {
    setEnrollPlanId(plan.id)
    setEnrollPlanName(plan.name)
    setPatientSearch('')
    setPatientResults([])
    setSelectedPatient(null)
    setAutoRenew(true)
    setEnrollDialogOpen(true)
  }

  const handlePatientSearchChange = (value: string) => {
    setPatientSearch(value)
    setSelectedPatient(null)

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)

    if (value.trim().length < 2) {
      setPatientResults([])
      return
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearchingPatients(true)
      try {
        const res = await fetch(`/api/patients?search=${encodeURIComponent(value.trim())}&limit=5`)
        if (res.ok) {
          const data = await res.json()
          // API may return { patients: [...] } or just [...]
          setPatientResults(Array.isArray(data) ? data : data.patients || [])
        }
      } catch {
        // Silently fail search
      } finally {
        setSearchingPatients(false)
      }
    }, 400)
  }

  const selectPatient = (patient: PatientSearchResult) => {
    setSelectedPatient(patient)
    setPatientSearch(`${patient.firstName} ${patient.lastName}`)
    setPatientResults([])
  }

  const handleEnroll = async () => {
    if (!selectedPatient || !enrollPlanId) {
      toast({ title: 'Please select a patient', variant: 'destructive' })
      return
    }

    setEnrolling(true)
    try {
      const res = await fetch('/api/memberships/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: enrollPlanId,
          patientId: selectedPatient.id,
          autoRenew,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to enroll patient')
      }

      toast({
        title: `${selectedPatient.firstName} ${selectedPatient.lastName} enrolled successfully`,
      })
      setEnrollDialogOpen(false)
      fetchPlans()
      // Refresh detail view if open
      if (detailPlan?.id === enrollPlanId) {
        fetchPlanDetail(enrollPlanId)
      }
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setEnrolling(false)
    }
  }

  // ── Plan Detail View ───────────────────────────────────────────────────────

  const fetchPlanDetail = async (planId: string) => {
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/memberships/enroll?planId=${planId}`)
      if (!res.ok) throw new Error('Failed to load members')
      const data = await res.json()
      setDetailMembers(Array.isArray(data) ? data : data.memberships || [])
    } catch {
      toast({ title: 'Failed to load plan members', variant: 'destructive' })
    } finally {
      setLoadingDetail(false)
    }
  }

  const openPlanDetail = (plan: MembershipPlan) => {
    setDetailPlan(plan)
    fetchPlanDetail(plan.id)
  }

  const closePlanDetail = () => {
    setDetailPlan(null)
    setDetailMembers([])
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  const formatPrice = (price: number) => formatCurrency(price, { locale })

  const formatDuration = (months: number) => {
    if (months === 1) return t('1 month')
    if (months === 12) return t('1 year')
    if (months % 12 === 0) return t('{v1} years', { v1: months / 12 })
    return t('{v1} months', { v1: months })
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('ui.membership_plans')}</h1>
            <p className="text-muted-foreground">{t('ui.create_and_manage_membership_plans_for_patients')}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // ── Plan Detail View ───────────────────────────────────────────────────────

  if (detailPlan) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={closePlanDetail}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Crown className="h-6 w-6 text-amber-500" />
              {detailPlan.name}
            </h1>
            <p className="text-muted-foreground">
              {formatPrice(detailPlan.price)} / {formatDuration(detailPlan.durationMonths)}
              {' \u2022 '}
              {t(detailPlan._count.memberships === 1 ? '{v1} member' : '{v1} members', { v1: detailPlan._count.memberships })}
            </p>
          </div>
          <Button onClick={() => openEnrollDialog(detailPlan)}>
            <UserPlus className="h-4 w-4 mr-2" />{t('ui.enroll_patient')}</Button>
        </div>

        {/* Benefits */}
        {detailPlan.benefits.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">{t('Plan Benefits')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {detailPlan.benefits.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    <span>
                      {t(b.description)}
                      {b.discountPercent ? (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {b.discountPercent}{t("% off")}
                        </Badge>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Members Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">{t('Enrolled Patients')}</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingDetail ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : detailMembers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="font-medium">{t('No enrolled patients yet')}</p>
                <p className="text-sm">
                  {t('Click "Enroll Patient" to add members to this plan')}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('ui.patient')}</TableHead>
                    <TableHead>{t('ui.contact')}</TableHead>
                    <TableHead>{t('ui.start_date')}</TableHead>
                    <TableHead>{t('ui.end_date')}</TableHead>
                    <TableHead>{t('ui.auto_renew')}</TableHead>
                    <TableHead>{t('ui.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailMembers.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        {m.patient.firstName} {m.patient.lastName}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {m.patient.phone || m.patient.email || '\u2014'}
                      </TableCell>
                      <TableCell>{formatDate(m.startDate)}</TableCell>
                      <TableCell>{formatDate(m.endDate)}</TableCell>
                      <TableCell>
                        <Badge variant={m.autoRenew ? 'default' : 'secondary'}>
                          {m.autoRenew ? t("Yes") : t("No")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            m.status === 'ACTIVE'
                              ? 'default'
                              : m.status === 'EXPIRED'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {m.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Main View: Plan Grid ───────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('ui.membership_plans')}</h1>
          <p className="text-muted-foreground">{t('ui.create_and_manage_membership_plans_for_patients')}</p>
        </div>
        <Button onClick={openCreatePlan}>
          <Plus className="h-4 w-4 mr-2" />
          {t('New Plan')}
        </Button>
      </div>

      {/* Plans Grid */}
      {plans.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <div className="text-center text-muted-foreground">
              <Crown className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-lg">{t('No membership plans yet')}</p>
              <p className="text-sm mb-4">
                {t('Create your first membership plan to start enrolling patients')}
              </p>
              <Button onClick={openCreatePlan}>
                <Plus className="h-4 w-4 mr-2" />
                {t('Create First Plan')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <Card
              key={plan.id}
              className={`relative cursor-pointer transition-shadow hover:shadow-md ${
                !plan.isActive ? 'opacity-60' : ''
              }`}
              onClick={() => openPlanDetail(plan)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Crown className="h-5 w-5 text-amber-500" />
                    <CardTitle className="text-lg">{t(plan.name)}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Badge variant={plan.isActive ? 'default' : 'secondary'}>
                      {plan.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditPlan(plan)}>
                          <Edit className="h-4 w-4 mr-2" /> {t("Edit Plan")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEnrollDialog(plan)}>
                          <UserPlus className="h-4 w-4 mr-2" />{t('ui.enroll_patient')}</DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDeletePlan(plan.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />{t('ui.delete')}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {plan.description && (
                  <p className="text-sm text-muted-foreground mt-1">{t(plan.description)}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Price & Duration */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Banknote className="h-4 w-4 text-muted-foreground" />
                    <span className="text-2xl font-bold">
                      {Number(plan.price).toLocaleString(locale)}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    / {formatDuration(plan.durationMonths)}
                  </span>
                </div>

                {/* Member Count */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>
                    {t(plan._count.memberships === 1 ? '{v1} member' : '{v1} members', { v1: plan._count.memberships })}
                    {plan.maxMembers ? t(" / {v1} max", { v1: plan.maxMembers }) : ''}
                  </span>
                </div>

                {/* Benefits Preview */}
                {plan.benefits.length > 0 && (
                  <div className="border-t pt-3 space-y-1.5">
                    {plan.benefits.slice(0, 3).map((b, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                        <span className="text-muted-foreground line-clamp-1">
                          {t(b.description)}
                          {b.discountPercent ? t(" ({v1}% off)", { v1: b.discountPercent }) : ''}
                        </span>
                      </div>
                    ))}
                    {plan.benefits.length > 3 && (
                      <p className="text-xs text-muted-foreground pl-5">
                        +{plan.benefits.length - 3} {t("more benefit")}
                        {plan.benefits.length - 3 > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Create / Edit Plan Dialog ──────────────────────────────────────── */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPlanId ? t("Edit Plan") : t("Create Membership Plan")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Name */}
            <div>
              <Label>{t("Plan Name *")}</Label>
              <Input
                value={planForm.name}
                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                placeholder={t("e.g., Gold Membership")}
              />
            </div>

            {/* Description */}
            <div>
              <Label>{t('ui.description')}</Label>
              <Textarea
                value={t(planForm.description)}
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                placeholder={t('Brief description of the plan...')}
                rows={3}
              />
            </div>

            {/* Price & Duration */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("Price (EGP) *")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={planForm.price}
                  onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })}
                  placeholder="e.g., 5000"
                />
              </div>
              <div>
                <Label>{t("Duration (months) *")}</Label>
                <Input
                  type="number"
                  min="1"
                  value={planForm.durationMonths}
                  onChange={(e) => setPlanForm({ ...planForm, durationMonths: e.target.value })}
                  placeholder="e.g., 12"
                />
              </div>
            </div>

            {/* Max Members */}
            <div>
              <Label>{t("Max Members (optional)")}</Label>
              <Input
                type="number"
                min="1"
                value={planForm.maxMembers}
                onChange={(e) => setPlanForm({ ...planForm, maxMembers: e.target.value })}
                placeholder={t('Leave blank for unlimited')}
              />
            </div>

            {/* Benefits */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>{t('Benefits')}</Label>
                <Button type="button" variant="outline" size="sm" onClick={addBenefit}>
                  <Plus className="h-3 w-3 mr-1" /> {t("Add Benefit")}
                </Button>
              </div>
              <div className="space-y-2">
                {planForm.benefits.map((benefit, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        value={t(benefit.description)}
                        onChange={(e) => updateBenefit(index, 'description', e.target.value)}
                        placeholder={t('Benefit description')}
                      />
                    </div>
                    <div className="w-24">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={benefit.discountPercent ?? ''}
                        onChange={(e) => updateBenefit(index, 'discountPercent', e.target.value)}
                        placeholder={t("% off")}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => removeBenefit(index)}
                      disabled={planForm.benefits.length === 1}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t('Add benefit descriptions with optional discount percentages')}
              </p>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">{t('ui.active')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('Inactive plans cannot accept new enrollments')}
                </p>
              </div>
              <Switch
                checked={planForm.isActive}
                onCheckedChange={(checked) => setPlanForm({ ...planForm, isActive: checked })}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>{t('ui.cancel')}</Button>
              <Button onClick={handleSavePlan} disabled={savingPlan}>
                {savingPlan ? 'Saving...' : editingPlanId ? t("Update Plan") : t("Create Plan")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Enroll Patient Dialog ──────────────────────────────────────────── */}
      <Dialog open={enrollDialogOpen} onOpenChange={setEnrollDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Enroll Patient in")} {enrollPlanName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Patient Search */}
            <div>
              <Label>{t("Search Patient *")}</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={patientSearch}
                  onChange={(e) => handlePatientSearchChange(e.target.value)}
                  placeholder={t('Type patient name or phone...')}
                  className="pl-9"
                />
              </div>

              {/* Search Results Dropdown */}
              {(patientResults.length > 0 || searchingPatients) && !selectedPatient && (
                <div className="border rounded-md mt-1 bg-background shadow-sm max-h-48 overflow-y-auto">
                  {searchingPatients ? (
                    <div className="p-3 text-sm text-muted-foreground text-center">{t('ui.searching')}</div>
                  ) : (
                    patientResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted text-sm transition-colors"
                        onClick={() => selectPatient(p)}
                      >
                        <div className="font-medium">
                          {p.firstName} {p.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.phone || p.email || t("No contact info")}
                        </div>
                      </button>
                    ))
                  )}
                  {!searchingPatients &&
                    patientResults.length === 0 &&
                    patientSearch.length >= 2 && (
                      <div className="p-3 text-sm text-muted-foreground text-center">{t('ui.no_patients_found')}</div>
                    )}
                </div>
              )}

              {/* Selected Patient Chip */}
              {selectedPatient && (
                <div className="flex items-center gap-2 mt-2 p-2 rounded-md bg-muted">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium flex-1">
                    {selectedPatient.firstName} {selectedPatient.lastName}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      setSelectedPatient(null)
                      setPatientSearch('')
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            {/* Auto-Renew Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">{t('ui.auto_renew')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('Automatically renew when membership expires')}
                </p>
              </div>
              <Switch checked={autoRenew} onCheckedChange={setAutoRenew} />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEnrollDialogOpen(false)}>{t('ui.cancel')}</Button>
              <Button onClick={handleEnroll} disabled={enrolling || !selectedPatient}>
                {enrolling ? t("Enrolling...") : 'Enroll Patient'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {ConfirmDialogComponent}
    </div>
  )
}
