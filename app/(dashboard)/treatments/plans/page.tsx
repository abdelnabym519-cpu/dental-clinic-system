'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  User,
  MoreHorizontal,
  Eye,
  Edit,
  FileText,
  CheckCircle,
  ArrowLeft,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  treatmentPlanStatusConfig,
  formatCurrency,
  formatDate,
  calculatePlanProgress,
} from '@/lib/treatment-utils'

interface TreatmentPlanItem {
  id: string
  priority: number
  estimatedCost: string | number
  status: string
  procedure: {
    id: string
    code: string
    name: string
    category: string
  }
}

interface TreatmentPlan {
  id: string
  planNumber: string
  title: string
  status: string
  estimatedCost: string | number
  estimatedDuration: number | null
  startDate: string | null
  expectedEndDate: string | null
  completedDate: string | null
  consentGiven: boolean
  createdAt: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
  }
  items: TreatmentPlanItem[]
  _count: {
    items: number
  }
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function TreatmentPlansPage() {
  const { locale } = useLanguage()
  const { t } = useLanguage()
  const router = useRouter()
  const [plans, setPlans] = useState<TreatmentPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [consentFilter, setConsentFilter] = useState('all')

  const fetchPlans = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (search) params.append('search', search)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (consentFilter && consentFilter !== 'all') params.append('consentGiven', consentFilter)

      const response = await fetch(`/api/treatment-plans?${params}`)
      if (!response.ok) throw new Error(t('Failed to fetch treatment plans'))

      const data = await response.json()
      setPlans(data.treatmentPlans)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching treatment plans:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlans()
  }, [pagination.page, search, statusFilter, consentFilter])

  const getStatusBadge = (status: string) => {
    const config = treatmentPlanStatusConfig[status] || {
      label: status,
      color: 'text-foreground',
      bgColor: 'bg-muted',
    }
    return <Badge className={`${config.bgColor} ${config.color} border-0`}>{config.label}</Badge>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/treatments">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('ui.treatment_plans')}</h1>
            <p className="text-muted-foreground">{t('Create and manage comprehensive treatment plans')}</p>
          </div>
        </div>
        <Link href="/treatments/plans/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />{t('ui.new_treatment_plan')}</Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('Search by patient name, plan number, or title...')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t('ui.status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('ui.all_status')}</SelectItem>
                  <SelectItem value="DRAFT">{t('ui.draft')}</SelectItem>
                  <SelectItem value="PROPOSED">{t('Proposed')}</SelectItem>
                  <SelectItem value="ACCEPTED">{t('Accepted')}</SelectItem>
                  <SelectItem value="IN_PROGRESS">{t('ui.in_progress')}</SelectItem>
                  <SelectItem value="COMPLETED">{t('ui.completed')}</SelectItem>
                  <SelectItem value="CANCELLED">{t('ui.cancelled')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={consentFilter} onValueChange={setConsentFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder={t('ui.consent')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('All Plans')}</SelectItem>
                  <SelectItem value="true">{t('ui.consent_given')}</SelectItem>
                  <SelectItem value="false">{t('Pending Consent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Treatment Plans Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t('Plan')}</TableHead>
                <TableHead>{t('ui.patient')}</TableHead>
                <TableHead>{t('ui.procedures')}</TableHead>
                <TableHead>{t('ui.progress')}</TableHead>
                <TableHead>{t('ui.estimated_cost')}</TableHead>
                <TableHead>{t('ui.status')}</TableHead>
                <TableHead className="text-right">{t('ui.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : plans.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <FileText className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">{t('No treatment plans found')}</p>
                      <Link href="/treatments/plans/new">
                        <Button variant="outline" size="sm">
                          <Plus className="h-4 w-4 mr-2" />{t('ui.create_treatment_plan')}</Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                plans.map((plan) => {
                  const progress = calculatePlanProgress(plan.items)
                  return (
                    <TableRow key={plan.id}>
                      <TableCell>
                        <div className="font-medium">{plan.planNumber}</div>
                        <div className="text-sm text-muted-foreground">{plan.title}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <div className="font-medium">
                              {plan.patient.firstName} {plan.patient.lastName}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {plan.patient.patientId}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {plan._count.items} {t("procedure")}{plan._count.items !== 1 ? 's' : ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="w-24 space-y-1">
                          <Progress value={progress} className="h-2" />
                          <div className="text-xs text-muted-foreground">{progress}{t("% complete")}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{formatCurrency(plan.estimatedCost, locale)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getStatusBadge(plan.status)}
                          {plan.consentGiven && (
                            <div className="flex items-center gap-1 text-xs text-green-600">
                              <CheckCircle className="h-3 w-3" />{t('ui.consent')}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => router.push(`/treatments/plans/${plan.id}`)}
                            >
                              <Eye className="h-4 w-4 mr-2" />{t('ui.view_details')}</DropdownMenuItem>
                            {plan.status !== 'COMPLETED' && plan.status !== 'CANCELLED' && (
                              <DropdownMenuItem
                                onClick={() => router.push(`/treatments/plans/${plan.id}/edit`)}
                              >
                                <Edit className="h-4 w-4 mr-2" />{t('ui.edit')}</DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {!loading && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-4">
              <div className="text-sm text-muted-foreground">
                {t("Showing")} {(pagination.page - 1) * pagination.limit + 1} {t("to")}{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} {t("of")}{' '}
                {pagination.total} {t("plans")}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                  disabled={pagination.page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />{t('ui.previous')}</Button>
                <div className="text-sm">
                  {t("Page")} {pagination.page} {t("of")} {pagination.totalPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                  disabled={pagination.page >= pagination.totalPages}
                >{t('ui.next')}<ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
