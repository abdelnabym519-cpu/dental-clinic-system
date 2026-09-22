'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  Trash,
  FlaskConical,
  Star,
  Phone,
  Mail,
  MapPin,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { EGYPT_GOVERNORATES } from '@/lib/egypt-governorates'

interface LabVendor {
  id: string
  code: string
  name: string
  contactPerson: string
  email: string
  phone: string
  alternatePhone: string
  address: string
  city: string
  state: string
  pincode: string
  gstNumber: string
  panNumber: string
  specializations: string
  avgTurnaround: number
  rating: number
  paymentTerms: string
  creditLimit: number
  status: 'active' | 'inactive' | 'blocked'
  notes: string
  createdAt: string
  updatedAt: string
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  pages: number
}

export default function LabVendorsPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [vendors, setVendors] = useState<LabVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingVendor, setEditingVendor] = useState<LabVendor | null>(null)
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    alternatePhone: '',
    address: '',
    city: '',
    state: 'القاهرة',
    pincode: '',
    taxId: '',
    registrationNo: '',
    specializations: '',
    avgTurnaround: 7,
    rating: 0,
    paymentTerms: 'Net 30',
    creditLimit: 0,
    status: 'active' as 'active' | 'inactive' | 'blocked',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  const fetchVendors = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (search) params.append('search', search)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)

      const response = await fetch(`/api/lab-vendors?${params}`)
      if (!response.ok) throw new Error('Failed to fetch vendors')

      const data = await response.json()
      setVendors(data.data)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching vendors:', error)
      toast({
        title: 'Error',
        description: 'Failed to fetch lab vendors',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchVendors()
  }, [pagination.page, search, statusFilter])

  const handleOpenDialog = (vendor?: LabVendor) => {
    if (vendor) {
      setEditingVendor(vendor)
      setFormData({
        code: vendor.code,
        name: vendor.name,
        contactPerson: vendor.contactPerson || '',
        email: vendor.email || '',
        phone: vendor.phone,
        alternatePhone: vendor.alternatePhone || '',
        address: vendor.address || '',
        city: vendor.city || '',
        state: vendor.state || 'القاهرة',
        pincode: vendor.pincode || '',
        taxId: vendor.gstNumber || '',
        registrationNo: vendor.panNumber || '',
        specializations: vendor.specializations || '',
        avgTurnaround: vendor.avgTurnaround,
        rating: vendor.rating,
        paymentTerms: vendor.paymentTerms,
        creditLimit: vendor.creditLimit,
        status: vendor.status,
        notes: vendor.notes || '',
      })
    } else {
      setEditingVendor(null)
      setFormData({
        code: '',
        name: '',
        contactPerson: '',
        email: '',
        phone: '',
        alternatePhone: '',
        address: '',
        city: '',
        state: 'القاهرة',
        pincode: '',
        taxId: '',
        registrationNo: '',
        specializations: '',
        avgTurnaround: 7,
        rating: 0,
        paymentTerms: 'Net 30',
        creditLimit: 0,
        status: 'active',
        notes: '',
      })
    }
    setIsDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const url = editingVendor ? `/api/lab-vendors/${editingVendor.id}` : `/api/lab-vendors`
      const method = editingVendor ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save vendor')
      }

      toast({
        title: 'Success',
        description: `Lab vendor ${editingVendor ? 'updated' : 'created'} successfully`,
      })

      setIsDialogOpen(false)
      fetchVendors()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (vendorId: string) => {
    const ok = await confirm({
      title: 'Delete Vendor',
      description: 'Are you sure you want to delete this vendor?',
      confirmLabel: 'Delete',
    })
    if (!ok) return

    try {
      const response = await fetch(`/api/lab-vendors/${vendorId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete vendor')
      }

      toast({
        title: 'Success',
        description: 'Lab vendor deleted successfully',
      })

      fetchVendors()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { label: string; className: string; icon: any }> = {
      active: {
        label: 'Active',
        className: 'bg-green-100 text-green-800',
        icon: CheckCircle,
      },
      inactive: {
        label: 'Inactive',
        className: 'bg-muted text-foreground',
        icon: XCircle,
      },
      blocked: {
        label: 'Blocked',
        className: 'bg-red-100 text-red-800',
        icon: XCircle,
      },
    }

    const config = configs[status] || configs.active
    const Icon = config.icon

    return (
      <Badge className={config.className}>
        <Icon className="mr-1 h-3 w-3" />
        {t(config.label)}
      </Badge>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Lab Vendors')}</h1>
          <p className="text-muted-foreground">
            {t('Manage external laboratory vendors and their information')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/lab')}>
            <FlaskConical className="mr-2 h-4 w-4" />
            {t('Back to Lab Orders')}
          </Button>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="mr-2 h-4 w-4" />{t('ui.add_vendor')}</Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('Total Vendors')}</CardTitle>
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pagination.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('Active Vendors')}</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {vendors.filter((v) => v.status === t("active")).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('Avg. Rating')}</CardTitle>
            <Star className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {vendors.length > 0
                ? (vendors.reduce((sum, v) => sum + v.rating, 0) / vendors.length).toFixed(1)
                : '0.0'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('Search vendors...')}
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
                <SelectItem value="active">{t('ui.active')}</SelectItem>
                <SelectItem value="inactive">{t('ui.inactive')}</SelectItem>
                <SelectItem value="blocked">{t('ui.blocked')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Vendors Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : vendors.length === 0 ? (
            <div className="text-center py-12">
              <FlaskConical className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">{t('No vendors found')}</h3>
              <p className="text-muted-foreground">{t('Get started by adding your first lab vendor')}</p>
              <Button className="mt-4" onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />{t('ui.add_vendor')}</Button>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Vendor Code')}</TableHead>
                    <TableHead>{t('ui.name')}</TableHead>
                    <TableHead>{t('ui.contact')}</TableHead>
                    <TableHead>{t('ui.specializations')}</TableHead>
                    <TableHead>{t('Turnaround')}</TableHead>
                    <TableHead>{t('ui.rating')}</TableHead>
                    <TableHead>{t('ui.status')}</TableHead>
                    <TableHead className="text-right">{t('ui.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendors.map((vendor) => (
                    <TableRow key={vendor.id}>
                      <TableCell className="font-medium">{vendor.code}</TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{vendor.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {vendor.contactPerson}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center text-sm">
                            <Phone className="mr-1 h-3 w-3" />
                            {vendor.phone}
                          </div>
                          {vendor.email && (
                            <div className="flex items-center text-sm text-muted-foreground">
                              <Mail className="mr-1 h-3 w-3" />
                              {vendor.email}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {vendor.specializations
                            ? vendor.specializations.split(',').slice(0, 2).join(', ')
                            : '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center">
                          <Clock className="mr-1 h-3 w-3" />
                          {vendor.avgTurnaround} {t("days")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center">
                          <Star className="mr-1 h-3 w-3 fill-yellow-400 text-yellow-400" />
                          {vendor.rating.toFixed(1)}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(vendor.status)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenDialog(vendor)}>
                              <Edit className="mr-2 h-4 w-4" />{t('ui.edit')}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(vendor.id)}
                              className="text-red-600"
                            >
                              <Trash className="mr-2 h-4 w-4" />{t('ui.delete')}</DropdownMenuItem>
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
                  {pagination.total} {t("vendors")}
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

      {/* Add/Edit Vendor Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingVendor ? t("Edit Lab Vendor") : t("Add Lab Vendor")}</DialogTitle>
            <DialogDescription>{t('Enter the vendor information below')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">{t("Vendor Code *")}</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">{t("Vendor Name *")}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contactPerson">{t('ui.contact_person')}</Label>
                <Input
                  id="contactPerson"
                  value={formData.contactPerson}
                  onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">{t("Phone *")}</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t('ui.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="alternatePhone">{t('ui.alternate_phone')}</Label>
                <Input
                  id="alternatePhone"
                  value={formData.alternatePhone}
                  onChange={(e) => setFormData({ ...formData, alternatePhone: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">{t('ui.address')}</Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">{t('ui.city')}</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">{t('Governorate')}</Label>
                <Input
                  id="state"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                />
                <datalist id="egypt-governorates">
                  {EGYPT_GOVERNORATES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {t(g.label)}
                    </option>
                  ))}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pincode">{t('ui.postal_code')}</Label>
                <Input
                  id="pincode"
                  value={formData.pincode}
                  onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="specializations">{t('ui.specializations')}</Label>
              <Input
                id="specializations"
                value={formData.specializations}
                onChange={(e) => setFormData({ ...formData, specializations: e.target.value })}
                placeholder={t("crown, bridge, denture, etc. (comma-separated)")}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="avgTurnaround">{t("Avg. Turnaround (days)")}</Label>
                <Input
                  id="avgTurnaround"
                  type="number"
                  value={formData.avgTurnaround}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      avgTurnaround: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rating">{t('Quality Rating')}</Label>
                <Input
                  id="rating"
                  type="number"
                  step="0.1"
                  min="0"
                  max="5"
                  value={formData.rating}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      rating: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">{t('ui.status')}</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      status: value as 'active' | 'inactive' | 'blocked',
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t('ui.active')}</SelectItem>
                    <SelectItem value="inactive">{t('ui.inactive')}</SelectItem>
                    <SelectItem value="blocked">{t('ui.blocked')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">{t('ui.notes')}</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>{t('ui.cancel')}</Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : editingVendor ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {ConfirmDialogComponent}
    </div>
  )
}
