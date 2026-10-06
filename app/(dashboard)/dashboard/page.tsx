'use client'

import { useLanguage } from '@/components/providers/language-provider'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Users,
  Calendar,
  Receipt,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Package,
} from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { InsightsPanel } from '@/components/ai/insights-panel'
import { CHART_COLORS } from '@/lib/chart-theme'

interface DashboardStats {
  overview: {
    totalPatients: number
    newPatientsThisMonth: number
    patientGrowth: number
    todayAppointments: number
    thisMonthAppointments: number
    appointmentGrowth: number
    pendingAppointments: number
    completedAppointmentsToday: number
    thisMonthRevenue: number
    todayRevenue: number
    revenueGrowth: number
    pendingPayments: number
    totalRevenue: number
  }
  charts: {
    last7DaysRevenue: Array<{ date: string; revenue: number }>
    last6MonthsRevenue: Array<{ month: string; revenue: number }>
    appointmentsByStatus: Array<{ status: string; count: number }>
    topProcedures: Array<{ name: string; count: number; revenue: number }>
  }
  recentActivity: {
    upcomingAppointments: Array<{
      id: string
      patientName: string
      doctorName: string
      date: string
      type: string
      status: string
    }>
    lowStockItems: Array<{
      id: string
      name: string
      currentStock: number
      minimumStock: number
      unit: string
    }>
  }
}

export default function DashboardPage() {
  const { t } = useLanguage()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDashboardStats()
  }, [])

  const fetchDashboardStats = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/dashboard/stats')

      if (!response.ok) {
        throw new Error(t('Failed to fetch dashboard statistics'))
      }

      const data = await response.json()
      setStats(data.data)
    } catch (err: any) {
      console.error('Error fetching dashboard stats:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 0,
    }).format(amount)
  }

  const getGrowthIcon = (growth: number) => {
    if (growth > 0) return <ArrowUpRight className="h-4 w-4 text-green-600" />
    if (growth < 0) return <ArrowDownRight className="h-4 w-4 text-red-600" />
    return null
  }

  const getGrowthColor = (growth: number) => {
    if (growth > 0) return 'text-green-600'
    if (growth < 0) return 'text-red-600'
    return 'text-muted-foreground'
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('dashboard.title')}</h1>
          <p className="text-muted-foreground">{t('Loading your practice data...')}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="h-4 w-24 bg-muted rounded animate-pulse" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 bg-muted rounded animate-pulse mb-2" />
                <div className="h-3 w-32 bg-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('dashboard.title')}</h1>
          <p className="text-muted-foreground text-red-600">{t('dashboard.loadError')}</p>
        </div>
        <Card className="border-red-200">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              <p>{error || t("An error occurred")}</p>
            </div>
            <Button onClick={fetchDashboardStats} className="mt-4">
              {t('Retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Welcome message */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{t('Dashboard')}</h1>
        <p className="text-muted-foreground">
          {t("Here's what's happening at your dental practice today.")}
        </p>
      </div>

      {/* AI Insights */}
      <InsightsPanel />

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Total Patients */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.totalPatients')}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.overview.totalPatients.toLocaleString()}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {getGrowthIcon(stats.overview.patientGrowth)}
              <span className={getGrowthColor(stats.overview.patientGrowth)}>
                {stats.overview.patientGrowth > 0 ? '+' : ''}
                {stats.overview.patientGrowth.toFixed(1)}%
              </span>
              <span className="text-muted-foreground">{t('dashboard.fromLastMonth')}</span>
            </div>
          </CardContent>
        </Card>

        {/* Today's Appointments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("Today's Appointments")}</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.overview.todayAppointments}</div>
            <p className="text-xs text-muted-foreground">
              {stats.overview.completedAppointmentsToday} {t("completed,")}{' '}
              {stats.overview.pendingAppointments} {t("pending")}
            </p>
          </CardContent>
        </Card>

        {/* This Month Revenue */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.monthRevenue')}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.overview.thisMonthRevenue)}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {getGrowthIcon(stats.overview.revenueGrowth)}
              <span className={getGrowthColor(stats.overview.revenueGrowth)}>
                {stats.overview.revenueGrowth > 0 ? '+' : ''}
                {stats.overview.revenueGrowth.toFixed(1)}%
              </span>
              <span className="text-muted-foreground">{t('dashboard.fromLastMonth')}</span>
            </div>
          </CardContent>
        </Card>

        {/* Pending Payments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.pendingPayments')}</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.overview.pendingPayments)}
            </div>
            <p className="text-xs text-muted-foreground">{t('dashboard.outstanding')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts and Activity */}
      <div className="grid gap-4 lg:grid-cols-7">
        {/* Revenue Chart */}
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>{t('dashboard.revenueOverview')}</CardTitle>
            <CardDescription>{t('Last 7 days revenue trend')}</CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            {stats.charts.last7DaysRevenue && stats.charts.last7DaysRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={stats.charts.last7DaysRevenue.map((item: any) => ({
                    date: format(new Date(item.date), 'MMM dd'),
                    revenue: Number(item.revenue),
                  }))}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => (typeof value === 'number' ? formatCurrency(value) : '')}
                    labelStyle={{ color: 'inherit' }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    activeDot={{ r: 8 }}
                    name="Revenue"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-8">{t('dashboard.noRevenue')}</p>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Appointments */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t('dashboard.upcomingAppointments')}</CardTitle>
            <CardDescription>{t('Next 5 scheduled appointments')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.recentActivity.upcomingAppointments &&
              stats.recentActivity.upcomingAppointments.length > 0 ? (
                stats.recentActivity.upcomingAppointments.map((apt) => (
                  <div key={apt.id} className="flex items-start gap-3 text-sm">
                    <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1 space-y-1">
                      <p className="font-medium">{apt.patientName}</p>
                      <p className="text-muted-foreground text-xs">
                        {format(new Date(apt.date), 'MMM dd, yyyy HH:mm')} • {apt.doctorName}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-center py-8">{t('dashboard.noUpcoming')}</p>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <Button asChild>
                <Link href="/agenda">{t('dashboard.openAgenda')}</Link>
              </Button>
              <Link href="/appointments" className="flex-1">
                <Button variant="outline" className="w-full">
                  {t('View All Appointments')}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Appointment Status Chart */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.appointmentsByStatus')}</CardTitle>
            <CardDescription>{t("This month's appointment distribution")}</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.charts.appointmentsByStatus && stats.charts.appointmentsByStatus.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={stats.charts.appointmentsByStatus.map((item: any) => ({
                      name: item.status,
                      value: item.count,
                    }))}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name}: ${percent ? (percent * 100).toFixed(0) : 0}%`
                    }
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {stats.charts.appointmentsByStatus.map((_: unknown, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                {t('No appointment data available')}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Monthly Revenue Trend */}
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.revenueTrend')}</CardTitle>
            <CardDescription>{t('Last 6 months revenue comparison')}</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.charts.last6MonthsRevenue && stats.charts.last6MonthsRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={stats.charts.last6MonthsRevenue.map((item: any) => ({
                    month: item.month,
                    revenue: Number(item.revenue),
                  }))}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => (typeof value === 'number' ? formatCurrency(value) : '')}
                  />
                  <Legend />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-8">{t('dashboard.noRevenue')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid gap-4 lg:grid-cols-7">
        {/* Top Procedures */}
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>{t('dashboard.topProcedures')}</CardTitle>
            <CardDescription>{t('dashboard.topProceduresDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.charts.topProcedures && stats.charts.topProcedures.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={stats.charts.topProcedures.map((proc: any) => ({
                    name: proc.name.length > 20 ? proc.name.substring(0, 20) + '...' : proc.name,
                    count: Number(proc.count),
                    revenue: Number(proc.revenue),
                  }))}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis yAxisId="left" orientation="left" stroke="hsl(var(--chart-1))" />
                  <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--chart-2))" />
                  <Tooltip
                    formatter={(value, _name, item) => {
                      if (typeof value !== 'number') return ''
                      // Match on dataKey, not name: the <Bar> sets a display
                      // name ("Revenue (EGP )"), and that is what recharts passes
                      // as `name`, so comparing it to 'revenue' never matched.
                      if (item?.dataKey === 'revenue') return formatCurrency(value)
                      return value
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="count" fill="#8884d8" name="Count" />
                  <Bar yAxisId="right" dataKey="revenue" fill="#82ca9d" name="Revenue (EGP )" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-8">{t('dashboard.noProcedures')}</p>
            )}
          </CardContent>
        </Card>

        {/* Low Stock Alerts */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {t('Low Stock Alerts')}
            </CardTitle>
            <CardDescription>{t('dashboard.lowStockDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.recentActivity.lowStockItems &&
              stats.recentActivity.lowStockItems.length > 0 ? (
                stats.recentActivity.lowStockItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <div className="flex-1">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("Min:")} {item.minimumStock} {item.unit}
                      </p>
                    </div>
                    <div className="text-red-600 font-medium">
                      {item.currentStock} {item.unit}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-center py-8">{t('dashboard.allInStock')}</p>
              )}
            </div>
            <Link href="/inventory">
              <Button variant="outline" className="w-full mt-4">
                {t('View Inventory')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.quickActions')}</CardTitle>
          <CardDescription>{t('dashboard.quickActionsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <Link
            href="/patients/new"
            className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{t('dashboard.addPatient')}</p>
              <p className="text-sm text-muted-foreground">{t('dashboard.registerNew')}</p>
            </div>
          </Link>
          <Link
            href="/appointments/new"
            className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{t('dashboard.bookAppointment')}</p>
              <p className="text-sm text-muted-foreground">{t('dashboard.scheduleVisit')}</p>
            </div>
          </Link>
          <Link
            href="/billing"
            className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Receipt className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{t('dashboard.createInvoice')}</p>
              <p className="text-sm text-muted-foreground">{t('dashboard.billPatient')}</p>
            </div>
          </Link>
          <Link
            href="/reports"
            className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{t('dashboard.viewReports')}</p>
              <p className="text-sm text-muted-foreground">{t('common.analytics')}</p>
            </div>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
