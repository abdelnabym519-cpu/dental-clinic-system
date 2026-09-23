'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  Search,
  Share2,
  CheckCircle,
  Gift,
  MoreHorizontal,
  Users,
  TrendingUp,
  Copy,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReferrerPatient {
  id: string
  patientId: string
  firstName: string
  lastName: string
}

interface Referral {
  id: string
  referralCode: string
  referrerPatient: ReferrerPatient
  referredName: string
  referredPhone: string
  status: 'PENDING' | 'CONVERTED' | 'EXPIRED' | 'REWARDED'
  rewardType: 'POINTS' | 'DISCOUNT' | 'CREDIT'
  rewardValue: number
  createdAt: string
}

interface Summary {
  total: number
  converted: number
  rewarded: number
  conversionRate: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface PatientSearchResult {
  id: string
  patientId: string
  firstName: string
  lastName: string
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Referral['status'] }) {
  const { t } = useLanguage()
  switch (status) {
    case 'PENDING':
      return <Badge variant="outline">{t('ui.pending')}</Badge>
    case 'CONVERTED':
      return (
        <Badge variant="default" className="bg-blue-100 text-blue-700 hover:bg-blue-100/80">{t('ui.converted')}</Badge>
      )
    case 'REWARDED':
      return (
        <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-100/80">{t('ui.rewarded')}</Badge>
      )
    case 'EXPIRED':
      return <Badge variant="destructive">{t('ui.expired')}</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ReferralsPage() {
  const { locale } = useLanguage()
  const { t } = useLanguage()
  const { toast } = useToast()

  // Data state
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    converted: 0,
    rewarded: 0,
    conversionRate: '0',
  })
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  })
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [page, setPage] = useState(1)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [referrerPatientId, setReferrerPatientId] = useState('')
  const [referrerDisplay, setReferrerDisplay] = useState('')
  const [referredName, setReferredName] = useState('')
  const [referredPhone, setReferredPhone] = useState('')
  const [rewardType, setRewardType] = useState<'POINTS' | 'DISCOUNT' | 'CREDIT'>('POINTS')
  const [rewardValue, setRewardValue] = useState('')

  // Patient search state
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>([])
  const [patientSearchLoading, setPatientSearchLoading] = useState(false)
  const [showPatientDropdown, setShowPatientDropdown] = useState(false)
  const patientSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ---------- Fetch referrals ----------

  const fetchReferrals = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter)
      params.set('page', String(page))
      params.set('limit', '20')

      const res = await fetch(`/api/referrals?${params.toString()}`)
      if (!res.ok) throw new Error(t('Failed to fetch referrals'))
      const data = await res.json()

      setReferrals(data.referrals || [])
      setSummary(data.summary || { total: 0, converted: 0, rewarded: 0, conversionRate: '0' })
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 })
    } catch {
      toast({ title: 'Failed to load referrals', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, page, toast])

  useEffect(() => {
    fetchReferrals()
  }, [fetchReferrals])

  // ---------- Patient search (debounced) ----------

  useEffect(() => {
    if (patientSearchTimer.current) clearTimeout(patientSearchTimer.current)

    if (patientSearch.length < 2) {
      setPatientResults([])
      setShowPatientDropdown(false)
      return
    }

    patientSearchTimer.current = setTimeout(async () => {
      try {
        setPatientSearchLoading(true)
        const res = await fetch(`/api/patients?search=${encodeURIComponent(patientSearch)}&limit=5`)
        if (!res.ok) throw new Error(t('Search failed'))
        const data = await res.json()
        const patients: PatientSearchResult[] = Array.isArray(data) ? data : data.patients || []
        setPatientResults(patients)
        setShowPatientDropdown(patients.length > 0)
      } catch {
        setPatientResults([])
      } finally {
        setPatientSearchLoading(false)
      }
    }, 350)

    return () => {
      if (patientSearchTimer.current) clearTimeout(patientSearchTimer.current)
    }
  }, [patientSearch])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowPatientDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ---------- Create referral ----------

  function resetForm() {
    setReferrerPatientId('')
    setReferrerDisplay('')
    setReferredName('')
    setReferredPhone('')
    setRewardType('POINTS')
    setRewardValue('')
    setPatientSearch('')
    setPatientResults([])
    setShowPatientDropdown(false)
  }

  async function handleCreateReferral() {
    if (!referrerPatientId) {
      toast({ title: 'Please select a referrer patient', variant: 'destructive' })
      return
    }
    if (!referredName.trim()) {
      toast({ title: 'Referred person name is required', variant: 'destructive' })
      return
    }
    if (!referredPhone.trim()) {
      toast({ title: 'Referred person phone is required', variant: 'destructive' })
      return
    }
    if (!rewardValue || Number(rewardValue) <= 0) {
      toast({ title: 'Reward value must be greater than 0', variant: 'destructive' })
      return
    }

    try {
      setSubmitting(true)
      const res = await fetch('/api/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referrerPatientId,
          referredName: referredName.trim(),
          referredPhone: referredPhone.trim(),
          rewardType,
          rewardValue: Number(rewardValue),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to create referral')
      }
      toast({ title: 'Referral created successfully' })
      setDialogOpen(false)
      resetForm()
      setPage(1)
      fetchReferrals()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create referral'
      toast({ title: message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- Update referral status ----------

  async function handleUpdateStatus(referralId: string, newStatus: 'CONVERTED' | 'REWARDED') {
    try {
      const res = await fetch(`/api/referrals/${referralId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to update referral')
      }
      toast({
        title:
          newStatus === 'CONVERTED' ? 'Referral marked as converted' : 'Reward given successfully',
      })
      fetchReferrals()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update referral'
      toast({ title: message, variant: 'destructive' })
    }
  }

  // ---------- Copy referral code ----------

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      toast({ title: 'Referral code copied' })
    })
  }

  // ---------- Render ----------

  // Loading skeleton
  if (loading && referrals.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">{t('ui.referral_program')}</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('ui.referral_program')}</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />{t('ui.create_referral')}</Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('Total Referrals')}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total}</div>
            <p className="text-xs text-muted-foreground">{t('All-time referrals')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('ui.converted')}</CardTitle>
            <CheckCircle className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.converted}</div>
            <p className="text-xs text-muted-foreground">{t('Referrals converted to patients')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('ui.rewarded')}</CardTitle>
            <Gift className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.rewarded}</div>
            <p className="text-xs text-muted-foreground">{t('Rewards distributed')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('Conversion Rate')}</CardTitle>
            <TrendingUp className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.conversionRate}%</div>
            <p className="text-xs text-muted-foreground">{t('Of total referrals')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-blue-500" />{t('ui.referrals')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('Search by name, phone or referral code...')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(val) => {
                setStatusFilter(val)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder={t('ui.filter_by_status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('ui.all_statuses')}</SelectItem>
                <SelectItem value="PENDING">{t('ui.pending')}</SelectItem>
                <SelectItem value="CONVERTED">{t('ui.converted')}</SelectItem>
                <SelectItem value="REWARDED">{t('ui.rewarded')}</SelectItem>
                <SelectItem value="EXPIRED">{t('ui.expired')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('ui.referral_code')}</TableHead>
                  <TableHead>{t('Referrer')}</TableHead>
                  <TableHead>{t('Referred Name')}</TableHead>
                  <TableHead>{t('Referred Phone')}</TableHead>
                  <TableHead>{t('ui.status')}</TableHead>
                  <TableHead>{t('ui.created')}</TableHead>
                  <TableHead className="w-[60px]">{t('ui.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referrals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {t('No referrals found.')}
                    </TableCell>
                  </TableRow>
                ) : (
                  referrals.map((referral) => (
                    <TableRow key={referral.id}>
                      <TableCell>
                        <button
                          onClick={() => copyCode(referral.referralCode)}
                          className="flex items-center gap-1.5 group"
                          title={t('Click to copy')}
                        >
                          <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
                            {referral.referralCode}
                          </code>
                          <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {referral.referrerPatient.firstName} {referral.referrerPatient.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {referral.referrerPatient.patientId}
                        </div>
                      </TableCell>
                      <TableCell>{referral.referredName}</TableCell>
                      <TableCell>{referral.referredPhone}</TableCell>
                      <TableCell>
                        <StatusBadge status={referral.status} />
                      </TableCell>
                      <TableCell>
                        {new Date(referral.createdAt).toLocaleDateString(locale)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">{t('ui.actions')}</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => copyCode(referral.referralCode)}>
                              <Copy className="mr-2 h-4 w-4" />
                              {t('Copy Code')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleUpdateStatus(referral.id, 'CONVERTED')}
                              disabled={
                                referral.status === 'CONVERTED' ||
                                referral.status === 'REWARDED' ||
                                referral.status === 'EXPIRED'
                              }
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              {t('Mark Converted')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleUpdateStatus(referral.id, 'REWARDED')}
                              disabled={
                                referral.status === 'REWARDED' ||
                                referral.status === 'EXPIRED' ||
                                referral.status === 'PENDING'
                              }
                            >
                              <Gift className="mr-2 h-4 w-4" />
                              {t('Give Reward')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                {t("Showing")} {(pagination.page - 1) * pagination.limit + 1} {t("to")}{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} {t("of")}{' '}
                {pagination.total} {t("referrals")}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >{t('ui.previous')}</Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >{t('ui.next')}</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Referral Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('ui.create_referral')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Referrer Patient Search */}
            <div className="space-y-2">
              <Label htmlFor="referrer">{t('Referrer Patient')}</Label>
              <div className="relative" ref={dropdownRef}>
                <Input
                  id="referrer"
                  placeholder={t('ui.search_patient_by_name_or_id')}
                  value={referrerPatientId ? referrerDisplay : patientSearch}
                  onChange={(e) => {
                    setPatientSearch(e.target.value)
                    setReferrerPatientId('')
                    setReferrerDisplay('')
                  }}
                  onFocus={() => {
                    if (patientResults.length > 0) setShowPatientDropdown(true)
                  }}
                />
                {patientSearchLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                )}
                {showPatientDropdown && patientResults.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    {patientResults.map((p) => (
                      <button
                        key={p.id}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                        onClick={() => {
                          setReferrerPatientId(p.id)
                          setReferrerDisplay(`${p.patientId} - ${p.firstName} ${p.lastName}`)
                          setPatientSearch('')
                          setShowPatientDropdown(false)
                        }}
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {p.patientId}
                        </span>
                        <span>
                          {p.firstName} {p.lastName}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {referrerPatientId && (
                <p className="text-xs text-muted-foreground">{t("Selected:")} {referrerDisplay}</p>
              )}
            </div>

            {/* Referred Person Name */}
            <div className="space-y-2">
              <Label htmlFor="referredName">{t('Referred Person Name')}</Label>
              <Input
                id="referredName"
                placeholder={t('Full name of referred person')}
                value={referredName}
                onChange={(e) => setReferredName(e.target.value)}
              />
            </div>

            {/* Referred Person Phone */}
            <div className="space-y-2">
              <Label htmlFor="referredPhone">{t('Referred Person Phone')}</Label>
              <Input
                id="referredPhone"
                placeholder={t('ui.phone_number_2')}
                value={referredPhone}
                onChange={(e) => setReferredPhone(e.target.value)}
              />
            </div>

            {/* Reward Type */}
            <div className="space-y-2">
              <Label>{t('Reward Type')}</Label>
              <Select
                value={rewardType}
                onValueChange={(val) => setRewardType(val as 'POINTS' | 'DISCOUNT' | 'CREDIT')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('Select reward type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POINTS">{t('ui.points')}</SelectItem>
                  <SelectItem value="DISCOUNT">{t('ui.discount')}</SelectItem>
                  <SelectItem value="CREDIT">{t('Credit')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Reward Value */}
            <div className="space-y-2">
              <Label htmlFor="rewardValue">{t('Reward Value')}</Label>
              <Input
                id="rewardValue"
                type="number"
                min="1"
                placeholder={`${t('e.g.')} 100`}
                value={rewardValue}
                onChange={(e) => setRewardValue(e.target.value)}
              />
            </div>

            {/* Submit */}
            <Button className="w-full" onClick={handleCreateReferral} disabled={submitting}>
              {submitting ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />{t('ui.creating')}</>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />{t('ui.create_referral')}</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
