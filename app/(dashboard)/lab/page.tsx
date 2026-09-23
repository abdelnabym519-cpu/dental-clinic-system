'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Eye,
  Edit,
  FlaskConical,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  Package,
  Truck,
  Users,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ExportMenu } from '@/components/ui/export-menu'

interface LabOrder {
  id: string
  orderNumber: string
  patientId: string
  patientName: string
  patientPhone: string
  labVendorId: string
  vendorName: string
  vendorPhone: string
  workType: string
  description: string
  toothNumbers: string
  shadeGuide: string
  orderDate: string
  expectedDate: string
  sentDate: string | null
  receivedDate: string | null
  deliveredDate: string | null
  estimatedCost: number
  actualCost: number | null
  status: string
  qualityCheck: string
  qualityNotes: string | null
  priority: string
  notes: string
  createdByName: string
  createdAt: string
}

interface LabVendor {
  id: string
  name: string
  code: string
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  pages: number
}

interface Stats {
  total: number
  created: number
  sentToLab: number
  inProgress: number
  ready: number
  delivered: number
  cancelled: number
}

export default function LabWorkPage() {
  const { locale } = useLanguage()
  const { t } = useLanguage()
  const router = useRouter()
  const [orders, setOrders] = useState<LabOrder[]>([])
  const [vendors, setVendors] = useState<LabVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<Stats>({
    total: 0,
    created: 0,
    sentToLab: 0,
    inProgress: 0,
    ready: 0,
    delivered: 0,
    cancelled: 0,
  })
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('all')
  const [workTypeFilter, setWorkTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  const fetchVendors = async () => {
    try {
      const response = await fetch('/api/lab-vendors?status=active')
      if (!response.ok) throw new Error(t('Failed to fetch vendors'))
      const data = await response.json()
      setVendors(data.data)
    } catch (error) {
      console.error('Error fetching vendors:', error)
    }
  }

  const fetchOrders = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (search) params.append('search', search)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (vendorFilter && vendorFilter !== 'all') params.append('vendorId', vendorFilter)
      if (workTypeFilter && workTypeFilter !== 'all') params.append('workType', workTypeFilter)
      if (priorityFilter && priorityFilter !== 'all') params.append('priority', priorityFilter)

      const response = await fetch(`/api/lab-orders?${params}`)
      if (!response.ok) throw new Error(t('Failed to fetch lab orders'))

      const data = await response.json()
      setOrders(data.data)
      setPagination(data.pagination)

      // Calculate stats
      calculateStats(data.data)
    } catch (error) {
      console.error('Error fetching lab orders:', error)
    } finally {
      setLoading(false)
    }
  }

  const calculateStats = (orders: LabOrder[]) => {
    const newStats = {
      total: orders.length,
      created: orders.filter((o) => o.status === 'CREATED').length,
      sentToLab: orders.filter((o) => o.status === 'SENT_TO_LAB').length,
      inProgress: orders.filter((o) => o.status === 'IN_PROGRESS').length,
      ready: orders.filter((o) => o.status === 'READY').length,
      delivered: orders.filter((o) => o.status === 'DELIVERED').length,
      cancelled: orders.filter((o) => o.status === 'CANCELLED').length,
    }
    setStats(newStats)
  }

  useEffect(() => {
    fetchVendors()
  }, [])

  useEffect(() => {
    fetchOrders()
  }, [pagination.page, search, statusFilter, vendorFilter, workTypeFilter, priorityFilter])

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { label: string; className: string; icon: any }> = {
      CREATED: {
        label: 'Created',
        className: 'bg-muted text-foreground',
        icon: Package,
      },
      SENT_TO_LAB: {
        label: 'Sent to Lab',
        className: 'bg-blue-100 text-blue-800',
        icon: Truck,
      },
      IN_PROGRESS: {
        label: 'In Progress',
        className: 'bg-yellow-100 text-yellow-800',
        icon: Clock,
      },
      QUALITY_CHECK: {
        label: 'Quality Check',
        className: 'bg-purple-100 text-purple-800',
        icon: FlaskConical,
      },
      READY: {
        label: 'Ready',
        className: 'bg-green-100 text-green-800',
        icon: CheckCircle,
      },
      DELIVERED: {
        label: 'Delivered',
        className: 'bg-emerald-100 text-emerald-800',
        icon: CheckCircle,
      },
      FITTED: {
        label: 'Fitted',
        className: 'bg-teal-100 text-teal-800',
        icon: CheckCircle,
      },
      REMAKE_REQUIRED: {
        label: 'Remake Required',
        className: 'bg-orange-100 text-orange-800',
        icon: AlertCircle,
      },
      CANCELLED: {
        label: 'Cancelled',
        className: 'bg-red-100 text-red-800',
        icon: XCircle,
      },
    }

    const config = configs[status] || configs.CREATED
    const Icon = config.icon

    return (
      <Badge className={config.className}>
        <Icon className="mr-1 h-3 w-3" />
        {t(config.label)}
      </Badge>
    )
  }

  const getPriorityBadge = (priority: string) => {
    const configs: Record<string, { label: string; className: string }> = {
      normal: { label: 'Normal', className: 'bg-muted text-foreground' },
      urgent: { label: 'Urgent', className: 'bg-orange-100 text-orange-800' },
      rush: { label: 'Rush', className: 'bg-red-100 text-red-800' },
    }

    const config = configs[priority] || configs.normal
    return <Badge className={config.className}>{t(config.label)}</Badge>
  }

  // workType is the LabWorkType enum (NIGHT_GUARD, ...), so lower-case the
  // tail rather than leaving it shouting.
  const formatWorkType = (workType: string) => {
    return workType
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Lab Work Management')}</h1>
          <p className="text-muted-foreground">
            {t('Manage lab orders, vendors, and track work progress')}
          </p>
        </div>
        <div className="flex gap-2">
          <ExportMenu
            filename="lab-orders"
            getData={() =>
              orders.map((o) => ({
                'Order No': o.orderNumber,
                Patient: o.patientName,
                'Patient Phone': o.patientPhone,
                Vendor: o.vendorName,
                'Work Type': formatWorkType(o.workType),
                Description: o.description || '',
                'Tooth Numbers': o.toothNumbers || '',
                'Shade Guide': o.shadeGuide || '',
                'Order Date': formatDate(o.orderDate),
                'Expected Date': formatDate(o.expectedDate),
                'Sent Date': formatDate(o.sentDate),
                'Received Date': formatDate(o.receivedDate),
                'Delivered Date': formatDate(o.deliveredDate),
                'Estimated Cost': o.estimatedCost,
                'Actual Cost': o.actualCost || '',
                Status: o.status,
                Priority: o.priority,
                'Quality Check': o.qualityCheck,
                Notes: o.notes || '',
              }))
            }
          />
          <Button variant="outline" onClick={() => router.push('/lab/vendors')}>
            <Users className="mr-2 h-4 w-4" />
            {t('Manage Vendors')}
          </Button>
          <Button onClick={() => router.push('/lab/orders/new')}>
            <Plus className="mr-2 h-4 w-4" />{t('ui.new_lab_order')}</Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('Total Orders')}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('ui.sent_to_lab')}</CardTitle>
            <Truck className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.sentToLab}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('ui.in_progress')}</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.inProgress}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('ui.ready')}</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.ready}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('ui.delivered')}</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.delivered}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('ui.cancelled')}</CardTitle>
            <XCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.cancelled}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('ui.created')}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.created}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-5">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('Search orders, patients...')}
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder={t('ui.all_statuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('ui.all_statuses')}</SelectItem>
                <SelectItem value="CREATED">{t('ui.created')}</SelectItem>
                <SelectItem value="SENT_TO_LAB">{t('ui.sent_to_lab')}</SelectItem>
                <SelectItem value="IN_PROGRESS">{t('ui.in_progress')}</SelectItem>
                <SelectItem value="QUALITY_CHECK">{t('Quality Check')}</SelectItem>
                <SelectItem value="READY">{t('ui.ready')}</SelectItem>
                <SelectItem value="DELIVERED">{t('ui.delivered')}</SelectItem>
                <SelectItem value="FITTED">{t('Fitted')}</SelectItem>
                <SelectItem value="REMAKE_REQUIRED">{t('Remake Required')}</SelectItem>
                <SelectItem value="CANCELLED">{t('ui.cancelled')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger>
                <SelectValue placeholder={t('ui.all_vendors')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('ui.all_vendors')}</SelectItem>
                {vendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={workTypeFilter} onValueChange={setWorkTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder={t('ui.all_work_types')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('ui.all_work_types')}</SelectItem>
                <SelectItem value="CROWN">{t('Crown')}</SelectItem>
                <SelectItem value="BRIDGE">{t('Bridge')}</SelectItem>
                <SelectItem value="DENTURE">{t('Denture')}</SelectItem>
                <SelectItem value="PARTIAL_DENTURE">{t('Partial Denture')}</SelectItem>
                <SelectItem value="IMPLANT_CROWN">{t('Implant Crown')}</SelectItem>
                <SelectItem value="VENEER">{t('Veneer')}</SelectItem>
                <SelectItem value="INLAY_ONLAY">{t('Inlay/Onlay')}</SelectItem>
                <SelectItem value="NIGHT_GUARD">{t('Night Guard')}</SelectItem>
                <SelectItem value="RETAINER">{t('Retainer')}</SelectItem>
                <SelectItem value="ALIGNER">{t('Aligner')}</SelectItem>
                <SelectItem value="MODEL">{t('Model')}</SelectItem>
                <SelectItem value="OTHER">{t('ui.other')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger>
                <SelectValue placeholder={t('ui.all_priorities')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('ui.all_priorities')}</SelectItem>
                <SelectItem value="normal">{t('ui.normal')}</SelectItem>
                <SelectItem value="urgent">{t('ui.urgent')}</SelectItem>
                <SelectItem value="rush">{t('Rush')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12">
              <FlaskConical className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">{t('No lab orders found')}</h3>
              <p className="text-muted-foreground">{t('Get started by creating your first lab order')}</p>
              <Button className="mt-4" onClick={() => router.push('/lab/orders/new')}>
                <Plus className="mr-2 h-4 w-4" />{t('ui.create_lab_order')}</Button>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Order No.')}</TableHead>
                    <TableHead>{t('ui.patient')}</TableHead>
                    <TableHead>{t('Work Type')}</TableHead>
                    <TableHead>{t('Vendor')}</TableHead>
                    <TableHead>{t('Order Date')}</TableHead>
                    <TableHead>{t('Expected')}</TableHead>
                    <TableHead>{t('ui.status')}</TableHead>
                    <TableHead>{t('ui.priority')}</TableHead>
                    <TableHead>{t('ui.cost')}</TableHead>
                    <TableHead className="text-right">{t('ui.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.orderNumber}</TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{order.patientName}</div>
                          <div className="text-sm text-muted-foreground">{order.patientPhone}</div>
                        </div>
                      </TableCell>
                      <TableCell>{formatWorkType(order.workType)}</TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{order.vendorName}</div>
                          <div className="text-sm text-muted-foreground">{order.vendorPhone}</div>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(order.orderDate)}</TableCell>
                      <TableCell>{formatDate(order.expectedDate)}</TableCell>
                      <TableCell>{getStatusBadge(order.status)}</TableCell>
                      <TableCell>{getPriorityBadge(order.priority)}</TableCell>
                      <TableCell>{formatCurrency(order.estimatedCost)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => router.push(`/lab/orders/${order.id}`)}
                            >
                              <Eye className="mr-2 h-4 w-4" />{t('ui.view_details')}</DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => router.push(`/lab/orders/${order.id}/edit`)}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              {t('Edit Order')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  {t("Showing")} {(pagination.page - 1) * pagination.limit + 1} {t("to")}{' '}
                  {Math.min(pagination.page * pagination.limit, pagination.total)} {t("of")}{' '}
                  {pagination.total} {t("orders")}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page === 1}
                    onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                  >
                    <ChevronLeft className="h-4 w-4" />{t('ui.previous')}</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page === pagination.pages}
                    onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                  >{t('ui.next')}<ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
