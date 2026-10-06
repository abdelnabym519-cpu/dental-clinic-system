'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  Calendar,
  FileText,
  CheckCircle,
  XCircle,
  Edit,
  Printer,
  AlertCircle,
  Play,
  ClipboardCheck,
} from 'lucide-react'
import {
  treatmentPlanStatusConfig,
  treatmentPlanItemStatusConfig,
  procedureCategoryConfig,
  formatCurrency,
  formatDate,
  calculatePlanProgress,
} from '@/lib/treatment-utils'

interface TreatmentPlanItem {
  id: string
  priority: number
  toothNumbers: string | null
  estimatedCost: string | number
  notes: string | null
  status: string
  procedure: {
    id: string
    code: string
    name: string
    category: string
    description: string | null
    defaultDuration: number
    basePrice: string | number
    preInstructions: string | null
    postInstructions: string | null
  }
}

interface TreatmentPlan {
  id: string
  planNumber: string
  title: string
  notes: string | null
  status: string
  estimatedCost: string | number
  estimatedDuration: number | null
  startDate: string | null
  expectedEndDate: string | null
  completedDate: string | null
  consentGiven: boolean
  createdAt: string
  updatedAt: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
    dateOfBirth: string | null
    gender: string | null
  }
  items: TreatmentPlanItem[]
}

export default function TreatmentPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { locale } = useLanguage()
  const { t } = useLanguage()
  const { id } = use(params)
  const router = useRouter()
  const [plan, setPlan] = useState<TreatmentPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [consentDialogOpen, setConsentDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)

  const fetchPlan = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/treatment-plans/${id}`)
      if (!response.ok) throw new Error(t('Failed to fetch treatment plan'))
      const data = await response.json()
      setPlan(data)
    } catch (error) {
      console.error('Error fetching treatment plan:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlan()
  }, [id])

  const handleStatusChange = async (status: string) => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/treatment-plans/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!response.ok) throw new Error(t('Failed to update status'))
      fetchPlan()
    } catch (error) {
      console.error('Error updating status:', error)
    } finally {
      setActionLoading(false)
    }
  }

  const handleConsentGiven = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/treatment-plans/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consentGiven: true,
          status: plan?.status === 'PROPOSED' ? 'ACCEPTED' : plan?.status,
        }),
      })
      if (!response.ok) throw new Error(t('Failed to record consent'))
      setConsentDialogOpen(false)
      fetchPlan()
    } catch (error) {
      console.error('Error recording consent:', error)
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelPlan = async () => {
    try {
      setActionLoading(true)
      const response = await fetch(`/api/treatment-plans/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      })
      if (!response.ok) throw new Error(t('Failed to cancel plan'))
      setCancelDialogOpen(false)
      fetchPlan()
    } catch (error) {
      console.error('Error cancelling plan:', error)
    } finally {
      setActionLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const config = treatmentPlanStatusConfig[status] || {
      label: status,
      color: 'text-foreground',
      bgColor: 'bg-muted',
    }
    return (
      <Badge className={`${config.bgColor} ${config.color} border-0 text-sm`}>{config.label}</Badge>
    )
  }

  const getItemStatusBadge = (status: string) => {
    const config = treatmentPlanItemStatusConfig[status] || {
      label: status,
      color: 'text-foreground',
      bgColor: 'bg-muted',
    }
    return <Badge className={`${config.bgColor} ${config.color} border-0`}>{config.label}</Badge>
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{t('Treatment plan not found')}</p>
        <Link href="/treatments/plans">
          <Button variant="outline">{t('Back to Treatment Plans')}</Button>
        </Link>
      </div>
    )
  }

  const progress = calculatePlanProgress(plan.items)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/treatments/plans">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{plan.planNumber}</h1>
              {getStatusBadge(plan.status)}
              {plan.consentGiven && (
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  <CheckCircle className="h-3 w-3 mr-1" />{t('ui.consent_given')}</Badge>
              )}
            </div>
            <p className="text-muted-foreground">{plan.title}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {plan.status === 'DRAFT' && (
            <Button onClick={() => handleStatusChange('PROPOSED')} disabled={actionLoading}>
              <FileText className="h-4 w-4 mr-2" />
              {t('Propose to Patient')}
            </Button>
          )}
          {plan.status === 'PROPOSED' && !plan.consentGiven && (
            <Button onClick={() => setConsentDialogOpen(true)}>
              <ClipboardCheck className="h-4 w-4 mr-2" />
              {t('Record Consent')}
            </Button>
          )}
          {plan.status === 'ACCEPTED' && (
            <Button onClick={() => handleStatusChange('IN_PROGRESS')} disabled={actionLoading}>
              <Play className="h-4 w-4 mr-2" />{t('ui.start_treatment')}</Button>
          )}
          {!['COMPLETED', 'CANCELLED'].includes(plan.status) && (
            <>
              <Link href={`/treatments/plans/${id}/edit`}>
                <Button variant="outline">
                  <Edit className="h-4 w-4 mr-2" />{t('ui.edit')}</Button>
              </Link>
              <Button
                variant="outline"
                className="text-red-600"
                onClick={() => setCancelDialogOpen(true)}
              >
                <XCircle className="h-4 w-4 mr-2" />{t('ui.cancel_plan')}</Button>
            </>
          )}
          <Button variant="outline">
            <Printer className="h-4 w-4 mr-2" />{t('ui.print')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Progress */}
          <Card>
            <CardHeader>
              <CardTitle>{t('Treatment Progress')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {plan.items.filter((i) => i.status === 'COMPLETED').length} {t("of")}{' '}
                    {plan.items.length} {t("procedures completed")}
                  </span>
                  <span className="text-sm font-medium">{progress}%</span>
                </div>
                <Progress value={progress} className="h-3" />
              </div>
            </CardContent>
          </Card>

          {/* Procedures */}
          <Card>
            <CardHeader>
              <CardTitle>{t('Treatment Procedures')}</CardTitle>
              <CardDescription>
                {t('Procedures in this treatment plan, ordered by priority')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>{t('ui.procedure')}</TableHead>
                    <TableHead>{t('ui.teeth')}</TableHead>
                    <TableHead>{t('ui.cost')}</TableHead>
                    <TableHead>{t('ui.status')}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.priority}</TableCell>
                      <TableCell>
                        <div className="font-medium">{item.procedure.name}</div>
                        <div className="text-sm text-muted-foreground">{item.procedure.code}</div>
                        <Badge
                          variant="outline"
                          className={`mt-1 ${procedureCategoryConfig[item.procedure.category]?.bgColor} ${procedureCategoryConfig[item.procedure.category]?.color} border-0`}
                        >
                          {procedureCategoryConfig[item.procedure.category]?.label}
                        </Badge>
                        {item.notes && (
                          <p className="text-sm text-muted-foreground mt-1">{item.notes}</p>
                        )}
                      </TableCell>
                      <TableCell>{item.toothNumbers || '-'}</TableCell>
                      <TableCell>{formatCurrency(item.estimatedCost, locale)}</TableCell>
                      <TableCell>{getItemStatusBadge(item.status)}</TableCell>
                      <TableCell>
                        {item.status === 'PENDING' && plan.status === 'IN_PROGRESS' && (
                          <Link
                            href={`/treatments/new?patientId=${plan.patient.id}&procedureId=${item.procedure.id}`}
                          >
                            <Button size="sm" variant="outline">{t('ui.start')}</Button>
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-medium">
                      {t("Total Estimated Cost:")}
                    </TableCell>
                    <TableCell className="font-bold text-lg">
                      {formatCurrency(plan.estimatedCost, locale)}
                    </TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Notes */}
          {plan.notes && (
            <Card>
              <CardHeader>
                <CardTitle>{t('ui.notes')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{plan.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Patient Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />{t('ui.patient')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="font-medium">
                    {plan.patient.firstName} {plan.patient.lastName}
                  </div>
                  <div className="text-sm text-muted-foreground">{plan.patient.patientId}</div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  {plan.patient.phone}
                </div>
                {plan.patient.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {plan.patient.email}
                  </div>
                )}
              </div>

              <Link href={`/patients/${plan.patient.id}`}>
                <Button variant="outline" className="w-full">{t('ui.view_patient_profile')}</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Plan Summary */}
          <Card>
            <CardHeader>
              <CardTitle>{t('ui.plan_summary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">{t('ui.total_cost')}</div>
                  <div className="font-bold text-lg">{formatCurrency(plan.estimatedCost, locale)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{t('ui.procedures')}</div>
                  <div className="font-bold text-lg">{plan.items.length}</div>
                </div>
              </div>

              {plan.estimatedDuration && (
                <div>
                  <div className="text-sm text-muted-foreground">{t('Est. Duration')}</div>
                  <div className="font-medium">{Math.round(plan.estimatedDuration / 60)} {t('hours')}</div>
                </div>
              )}

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('ui.created')}</span>
                  <span>{formatDate(plan.createdAt, locale)}</span>
                </div>
                {plan.startDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('ui.start_date')}</span>
                    <span>{formatDate(plan.startDate, locale)}</span>
                  </div>
                )}
                {plan.expectedEndDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('Expected End')}</span>
                    <span>{formatDate(plan.expectedEndDate, locale)}</span>
                  </div>
                )}
                {plan.completedDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('ui.completed')}</span>
                    <span>{formatDate(plan.completedDate, locale)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Consent Dialog */}
      <Dialog open={consentDialogOpen} onOpenChange={setConsentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Record Patient Consent')}</DialogTitle>
            <DialogDescription>
              {t('Confirm that the patient has given consent to proceed with this treatment plan.')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">{t("By recording consent, you confirm that:")}</p>
            <ul className="list-disc list-inside text-sm text-muted-foreground mt-2 space-y-1">
              <li>{t('The treatment plan has been explained to the patient')}</li>
              <li>{t('All questions have been answered')}</li>
              <li>{t('The patient understands the costs and procedures involved')}</li>
              <li>{t('The patient has agreed to proceed')}</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsentDialogOpen(false)}>{t('ui.cancel')}</Button>
            <Button onClick={handleConsentGiven} disabled={actionLoading}>
              {actionLoading ? t("Recording...") : t("Confirm Consent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Cancel Treatment Plan')}</DialogTitle>
            <DialogDescription>
              {t('Are you sure you want to cancel this treatment plan? This action cannot be undone.')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>{t('ui.keep_plan')}</Button>
            <Button variant="destructive" onClick={handleCancelPlan} disabled={actionLoading}>
              {actionLoading ? 'Cancelling...' : 'Cancel Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
