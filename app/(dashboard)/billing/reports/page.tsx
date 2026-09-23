'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import {
  BarChart3,
  Download,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Stethoscope,
  Calendar,
  Clock,
  AlertCircle,
  Banknote,
  CreditCard,
} from 'lucide-react'
import { dateRangePresets, formatCurrency, formatDate } from '@/lib/billing-utils'

interface OutstandingInvoice {
  id: string
  invoiceNo: string
  invoiceDate: string
  dueDate: string | null
  totalAmount: string | number
  balanceAmount: string | number
  status: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
  }
}

interface AgingData {
  current: { amount: number; count: number }
  days1_30: { amount: number; count: number }
  days31_60: { amount: number; count: number }
  days61_90: { amount: number; count: number }
  over90: { amount: number; count: number }
}

interface ProcedureRevenue {
  procedureId: string
  code: string
  name: string
  category: string
  totalRevenue: number
  count: number
  avgRevenue: number
}

interface DoctorRevenue {
  doctorId: string
  name: string
  specialization: string | null
  totalRevenue: number
  treatmentCount: number
  avgPerTreatment: number
  topProcedures: Array<{ name: string; count: number }>
}

export default function FinancialReportsPage() {
  const { locale } = useLanguage()
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [datePreset, setDatePreset] = useState('this_month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activeTab, setActiveTab] = useState('outstanding')

  // Report data
  const [outstandingData, setOutstandingData] = useState<{
    invoices: OutstandingInvoice[]
    aging: AgingData
    totals: { totalOutstanding: number; invoiceCount: number }
  } | null>(null)

  const [procedureData, setProcedureData] = useState<{
    byProcedure: ProcedureRevenue[]
    totals: { totalRevenue: number; totalTreatments: number }
  } | null>(null)

  const [doctorData, setDoctorData] = useState<{
    byDoctor: DoctorRevenue[]
    totals: { totalRevenue: number; totalTreatments: number; doctorCount: number }
  } | null>(null)

  const [dailyData, setDailyData] = useState<{
    dailyData: Array<{
      date: string
      cash: number
      card: number
      instapay: number
      bankTransfer: number
      total: number
      count: number
    }>
    totals: { totalCollection: number; totalPayments: number }
  } | null>(null)

  const fetchReport = async (type: string) => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ type })

      if (dateFrom && dateTo) {
        params.append('dateFrom', dateFrom)
        params.append('dateTo', dateTo)
      } else {
        params.append('preset', datePreset)
      }

      const response = await fetch(`/api/billing/reports?${params}`)
      if (!response.ok) throw new Error('Failed to fetch report')
      const data = await response.json()

      switch (type) {
        case 'outstanding':
          setOutstandingData(data)
          break
        case 'procedure_revenue':
          setProcedureData(data)
          break
        case 'doctor_revenue':
          setDoctorData(data)
          break
        case 'daily_collection':
          setDailyData(data)
          break
      }
    } catch (error) {
      console.error(`Error fetching ${type} report:`, error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReport(activeTab)
  }, [activeTab, datePreset, dateFrom, dateTo])

  const handleExport = () => {
    // TODO: Implement export functionality
    alert('Export functionality coming soon!')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Financial Reports')}</h1>
          <p className="text-muted-foreground">{t('View detailed financial analytics and reports')}</p>
        </div>
        <div className="flex gap-2">
          <Select
            value={datePreset}
            onValueChange={(v) => {
              setDatePreset(v)
              setDateFrom('')
              setDateTo('')
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder={t('ui.select_period')} />
            </SelectTrigger>
            <SelectContent>
              {dateRangePresets.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {t(preset.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {datePreset === 'custom' && (
            <>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[140px]"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[140px]"
              />
            </>
          )}
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />{t('ui.export')}</Button>
        </div>
      </div>

      {/* Report Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="outstanding" className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />{t('ui.outstanding')}</TabsTrigger>
          <TabsTrigger value="procedure_revenue" className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            {t('By Procedure')}
          </TabsTrigger>
          <TabsTrigger value="doctor_revenue" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {t('By Doctor')}
          </TabsTrigger>
          <TabsTrigger value="daily_collection" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t('Daily Collection')}
          </TabsTrigger>
        </TabsList>

        {/* Outstanding Report */}
        <TabsContent value="outstanding" className="space-y-6">
          {/* Aging Summary */}
          <div className="grid gap-4 md:grid-cols-5">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="pt-6">
                    <Skeleton className="h-8 w-24" />
                  </CardContent>
                </Card>
              ))
            ) : outstandingData ? (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-green-600">{t('ui.current')}</CardTitle>
                    <CardDescription>{t('Not yet due')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstandingData.aging.current.amount, locale)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {outstandingData.aging.current.count} {t("invoices")}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-yellow-600">{t("1-30 Days")}</CardTitle>
                    <CardDescription>{t('ui.overdue')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstandingData.aging.days1_30.amount, locale)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {outstandingData.aging.days1_30.count} {t("invoices")}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-orange-600">
                      {t("31-60 Days")}
                    </CardTitle>
                    <CardDescription>{t('ui.overdue')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstandingData.aging.days31_60.amount, locale)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {outstandingData.aging.days31_60.count} {t("invoices")}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-red-500">{t("61-90 Days")}</CardTitle>
                    <CardDescription>{t('ui.overdue')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstandingData.aging.days61_90.amount, locale)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {outstandingData.aging.days61_90.count} {t("invoices")}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-red-700">{t("90+ Days")}</CardTitle>
                    <CardDescription>{t('Critical')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstandingData.aging.over90.amount, locale)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {outstandingData.aging.over90.count} {t("invoices")}
                    </p>
                  </CardContent>
                </Card>
              </>
            ) : null}
          </div>

          {/* Outstanding Invoices Table */}
          <Card>
            <CardHeader>
              <CardTitle>{t('Outstanding Invoices')}</CardTitle>
              <CardDescription>
                {t("Total:")} {formatCurrency(outstandingData?.totals.totalOutstanding || 0, locale)} {t("from")}{' '}
                {outstandingData?.totals.invoiceCount || 0} {t("invoices")}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('ui.invoice')}</TableHead>
                    <TableHead>{t('ui.patient')}</TableHead>
                    <TableHead>{t('ui.invoice_date')}</TableHead>
                    <TableHead>{t('ui.due_date')}</TableHead>
                    <TableHead className="text-right">{t('ui.total')}</TableHead>
                    <TableHead className="text-right">{t('ui.balance')}</TableHead>
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
                          <Skeleton className="h-4 w-24" />
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
                      </TableRow>
                    ))
                  ) : outstandingData?.invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        {t('No outstanding invoices')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    outstandingData?.invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{invoice.invoiceNo}</TableCell>
                        <TableCell>
                          {invoice.patient.firstName} {invoice.patient.lastName}
                        </TableCell>
                        <TableCell>{formatDate(invoice.invoiceDate, locale)}</TableCell>
                        <TableCell>{invoice.dueDate ? formatDate(invoice.dueDate, locale) : '-'}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(invoice.totalAmount, locale)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-red-600">
                          {formatCurrency(invoice.balanceAmount, locale)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Procedure Revenue Report */}
        <TabsContent value="procedure_revenue" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('ui.total_revenue')}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">
                    {formatCurrency(procedureData?.totals.totalRevenue || 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('ui.total_treatments')}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">
                    {procedureData?.totals.totalTreatments || 0}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('Revenue by Procedure')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('ui.procedure')}</TableHead>
                    <TableHead>{t('ui.category')}</TableHead>
                    <TableHead className="text-center">{t('ui.count')}</TableHead>
                    <TableHead className="text-right">{t('Avg. Revenue')}</TableHead>
                    <TableHead className="text-right">{t('ui.total_revenue')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : procedureData?.byProcedure.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">{t('ui.no_procedure_data_available')}</TableCell>
                    </TableRow>
                  ) : (
                    procedureData?.byProcedure.map((proc) => (
                      <TableRow key={proc.procedureId}>
                        <TableCell>
                          <div className="font-medium">{proc.name}</div>
                          <div className="text-sm text-muted-foreground">{proc.code}</div>
                        </TableCell>
                        <TableCell>{proc.category}</TableCell>
                        <TableCell className="text-center">{proc.count}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(proc.avgRevenue, locale)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(proc.totalRevenue, locale)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Doctor Revenue Report */}
        <TabsContent value="doctor_revenue" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('ui.total_revenue')}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">
                    {formatCurrency(doctorData?.totals.totalRevenue || 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('ui.total_treatments')}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">
                    {doctorData?.totals.totalTreatments || 0}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('Active Doctors')}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">{doctorData?.totals.doctorCount || 0}</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('Revenue by Doctor')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('ui.doctor')}</TableHead>
                    <TableHead className="text-center">{t('ui.treatments')}</TableHead>
                    <TableHead className="text-right">{t('Avg. per Treatment')}</TableHead>
                    <TableHead className="text-right">{t('ui.total_revenue')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : doctorData?.byDoctor.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                        {t('No doctor data available')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    doctorData?.byDoctor.map((doc) => (
                      <TableRow key={doc.doctorId}>
                        <TableCell>
                          <div className="font-medium">{t("Dr.")} {doc.name}</div>
                          {doc.specialization && (
                            <div className="text-sm text-muted-foreground">
                              {doc.specialization}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center">{doc.treatmentCount}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(doc.avgPerTreatment, locale)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(doc.totalRevenue, locale)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Daily Collection Report */}
        <TabsContent value="daily_collection" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('Total Collection')}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold text-green-600">
                    {formatCurrency(dailyData?.totals.totalCollection || 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('Total Payments')}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold">{dailyData?.totals.totalPayments || 0}</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('Daily Collection Breakdown')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('ui.date')}</TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Banknote className="h-4 w-4" />{t('ui.cash')}</div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <CreditCard className="h-4 w-4" />{t('ui.card')}</div>
                    </TableHead>
                    <TableHead className="text-right">{t('ui.instapay')}</TableHead>
                    <TableHead className="text-right">{t('ui.bank_transfer')}</TableHead>
                    <TableHead className="text-right">{t('ui.total')}</TableHead>
                    <TableHead className="text-center">{t('ui.count')}</TableHead>
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
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-12" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : dailyData?.dailyData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                        {t('No collection data available')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    dailyData?.dailyData.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell className="font-medium">{formatDate(day.date, locale)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(day.cash, locale)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(day.card, locale)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(day.instapay, locale)}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(day.bankTransfer, locale)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-green-600">
                          {formatCurrency(day.total, locale)}
                        </TableCell>
                        <TableCell className="text-center">{day.count}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
