'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { useToast } from '@/hooks/use-toast'
import {
  Shield,
  Package,
  ClipboardList,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Wrench,
  ArrowRight,
} from 'lucide-react'

interface DashboardStats {
  total: number
  available: number
  inUse: number
  sterilizing: number
  contaminated: number
  maintenance: number
  retired: number
  nearMaxCycles: number
  recentLogs: Array<{
    id: string
    cycleNumber: number
    method: string
    result: string
    startedAt: string
    instrument: { name: string; category: string }
  }>
}

export default function SterilizationDashboardPage() {
  const { locale } = useLanguage()
  const { t } = useLanguage()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    fetchDashboard()
  }, [])

  const fetchDashboard = async () => {
    setLoading(true)
    try {
      const [instrRes, logsRes] = await Promise.all([
        fetch('/api/sterilization/instruments'),
        fetch('/api/sterilization/logs?limit=10'),
      ])

      if (!instrRes.ok || !logsRes.ok) throw new Error('Failed to fetch data')

      const instrData = await instrRes.json()
      const logsData = await logsRes.json()
      const instruments = instrData.instruments || []

      const statusCounts: Record<string, number> = {}
      let nearMaxCycles = 0
      for (const i of instruments) {
        statusCounts[i.status] = (statusCounts[i.status] || 0) + 1
        if (i.maxCycles && i.sterilizationCycleCount >= i.maxCycles * 0.9) {
          nearMaxCycles++
        }
      }

      setStats({
        total: instruments.length,
        available: statusCounts['AVAILABLE'] || 0,
        inUse: statusCounts['IN_USE'] || 0,
        sterilizing: statusCounts['STERILIZING'] || 0,
        contaminated: statusCounts['CONTAMINATED'] || 0,
        maintenance: statusCounts['MAINTENANCE'] || 0,
        retired: statusCounts['RETIRED'] || 0,
        nearMaxCycles,
        recentLogs: logsData.logs || [],
      })
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'PASS':
        return 'default'
      case 'FAIL':
        return 'destructive'
      case 'PENDING':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('Sterilization Center')}</h2>
          <p className="text-muted-foreground">
            {t('Instrument tracking, sterilization cycles, and compliance monitoring')}
          </p>
        </div>
      </div>

      {/* Quick Nav */}
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/sterilization/instruments">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t('ui.instruments')}</CardTitle>
              <Package className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {t("Manage inventory")} <ArrowRight className="h-3 w-3" />
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/sterilization/logs">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t('ui.sterilization_logs')}</CardTitle>
              <ClipboardList className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.recentLogs.length || 0}</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {t("View cycle history")} <ArrowRight className="h-3 w-3" />
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/sterilization/reports">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t('ui.compliance_reports')}</CardTitle>
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{t('ui.reports')}</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {t("View compliance data")} <ArrowRight className="h-3 w-3" />
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Status Overview */}
      {stats && (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
          <Card>
            <CardContent className="pt-4 text-center">
              <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto mb-1" />
              <div className="text-xl font-bold">{stats.available}</div>
              <p className="text-xs text-muted-foreground">{t('Available')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <Wrench className="h-5 w-5 text-blue-500 mx-auto mb-1" />
              <div className="text-xl font-bold">{stats.inUse}</div>
              <p className="text-xs text-muted-foreground">{t('In Use')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <Shield className="h-5 w-5 text-purple-500 mx-auto mb-1" />
              <div className="text-xl font-bold">{stats.sterilizing}</div>
              <p className="text-xs text-muted-foreground">{t('Sterilizing')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <AlertTriangle className="h-5 w-5 text-orange-500 mx-auto mb-1" />
              <div className="text-xl font-bold">{stats.contaminated}</div>
              <p className="text-xs text-muted-foreground">{t('Contaminated')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <Wrench className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
              <div className="text-xl font-bold">{stats.maintenance}</div>
              <p className="text-xs text-muted-foreground">{t('ui.maintenance')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <XCircle className="h-5 w-5 text-red-500 mx-auto mb-1" />
              <div className="text-xl font-bold">{stats.retired}</div>
              <p className="text-xs text-muted-foreground">{t('Retired')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <AlertTriangle className="h-5 w-5 text-amber-500 mx-auto mb-1" />
              <div className="text-xl font-bold">{stats.nearMaxCycles}</div>
              <p className="text-xs text-muted-foreground">{t('Near Max Cycles')}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent Sterilization Logs */}
      {stats && stats.recentLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('Recent Sterilization Cycles')}</CardTitle>
            <CardDescription>{t('Last 10 recorded cycles')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.recentLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0"
                >
                  <div>
                    <p className="font-medium text-sm">{log.instrument.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.instrument.category} {t("— Cycle #")}{log.cycleNumber} — {log.method}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusColor(log.result)}>{log.result}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.startedAt).toLocaleDateString(locale)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
