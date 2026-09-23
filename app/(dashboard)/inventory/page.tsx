'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Eye,
  Edit,
  Package,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Settings,
  FileText,
  TrendingUp,
  Users,
  Brain,
  Loader2,
  ArrowDown,
  ArrowUp,
  Minus,
  ShoppingCart,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ExportMenu } from '@/components/ui/export-menu'

interface InventoryItem {
  id: string
  sku: string
  name: string
  description: string
  itemType: string
  categoryName: string
  supplierName: string
  currentStock: number
  minimumStock: number
  reorderLevel: number
  unit: string
  purchasePrice: number
  sellingPrice: number
  stockStatus: 'out_of_stock' | 'low_stock' | 'reorder' | 'sufficient'
  isActive: boolean
}

interface Category {
  id: string
  name: string
  item_count: number
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  pages: number
}

export default function InventoryPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 50,
    total: 0,
    pages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [lowStockOnly, setLowStockOnly] = useState(false)

  // AI Forecast
  const [forecastData, setForecastData] = useState<any>(null)
  const [forecastLoading, setForecastLoading] = useState(false)
  const [showForecast, setShowForecast] = useState(false)

  const fetchForecast = async () => {
    try {
      setForecastLoading(true)
      const res = await fetch('/api/ai/inventory-forecast')
      if (!res.ok) return
      const data = await res.json()
      setForecastData(data)
      setShowForecast(true)
    } catch {
      // non-critical
    } finally {
      setForecastLoading(false)
    }
  }

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/inventory/categories')
      if (!response.ok) throw new Error(t('Failed to fetch categories'))
      const data = await response.json()
      setCategories(data.data)
    } catch (error) {
      console.error('Error fetching categories:', error)
    }
  }

  const fetchItems = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (search) params.append('search', search)
      if (categoryFilter && categoryFilter !== 'all') params.append('category', categoryFilter)
      if (typeFilter && typeFilter !== 'all') params.append('type', typeFilter)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (lowStockOnly) params.append('lowStock', 'true')

      const response = await fetch(`/api/inventory/items?${params}`)
      if (!response.ok) throw new Error(t('Failed to fetch inventory items'))

      const data = await response.json()
      setItems(data.data)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching inventory items:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCategories()
  }, [])

  useEffect(() => {
    fetchItems()
  }, [pagination.page, search, categoryFilter, typeFilter, statusFilter, lowStockOnly])

  // itemType arrives as the InventoryItemType enum (DENTAL_MATERIAL, ...).
  const formatItemType = (type: string) =>
    type
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

  const getStockStatusBadge = (status: string) => {
    const configs = {
      out_of_stock: {
        label: 'Out of Stock',
        color: 'text-red-700',
        bgColor: 'bg-red-100',
        icon: XCircle,
      },
      low_stock: {
        label: 'Low Stock',
        color: 'text-orange-700',
        bgColor: 'bg-orange-100',
        icon: AlertTriangle,
      },
      reorder: {
        label: 'Reorder',
        color: 'text-yellow-700',
        bgColor: 'bg-yellow-100',
        icon: AlertTriangle,
      },
      sufficient: {
        label: 'Sufficient',
        color: 'text-green-700',
        bgColor: 'bg-green-100',
        icon: CheckCircle,
      },
    }

    const config = configs[status as keyof typeof configs] || configs.sufficient
    const Icon = config.icon

    return (
      <Badge className={`${config.bgColor} ${config.color} border-0`}>
        <Icon className="h-3 w-3 mr-1" />
        {t(config.label)}
      </Badge>
    )
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Inventory')}</h1>
          <p className="text-muted-foreground">{t('Manage inventory items and stock levels')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory/suppliers">
            <Button variant="outline">
              <Users className="h-4 w-4 mr-2" />
              {t('Suppliers')}
            </Button>
          </Link>
          <Link href="/inventory/transactions">
            <Button variant="outline">
              <TrendingUp className="h-4 w-4 mr-2" />
              {t('Transactions')}
            </Button>
          </Link>
          <Link href="/inventory/reports">
            <Button variant="outline">
              <FileText className="h-4 w-4 mr-2" />{t('ui.reports')}</Button>
          </Link>
          <ExportMenu
            filename="inventory"
            getData={() =>
              items.map((item) => ({
                'Item Code': item.sku,
                Name: item.name,
                Description: item.description || '',
                Type: formatItemType(item.itemType),
                Category: item.categoryName || 'Uncategorized',
                Supplier: item.supplierName || '',
                'Current Stock': item.currentStock,
                'Minimum Stock': item.minimumStock,
                'Reorder Point': item.reorderLevel,
                Unit: item.unit,
                'Unit Price': item.purchasePrice,
                'Selling Price': item.sellingPrice,
                'Stock Status': item.stockStatus,
                Active: item.isActive ? 'Yes' : 'No',
              }))
            }
          />
          <Button variant="outline" onClick={fetchForecast} disabled={forecastLoading}>
            {forecastLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Brain className="h-4 w-4 mr-2" />
            )}
            {t("AI Forecast")}
          </Button>
          <Link href="/inventory/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              {t('New Item')}
            </Button>
          </Link>
        </div>
      </div>

      {/* AI Forecast Section */}
      {showForecast && forecastData && (
        <>
          {/* Forecast Summary Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-4 pb-3">
                <div className="text-2xl font-bold text-red-700">
                  {forecastData.summary?.criticalItems || 0}
                </div>
                <div className="text-xs text-red-600">{t('Critical (stockout \u22647d)')}</div>
              </CardContent>
            </Card>
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="pt-4 pb-3">
                <div className="text-2xl font-bold text-amber-700">
                  {forecastData.summary?.reorderItems || 0}
                </div>
                <div className="text-xs text-amber-600">{t('Need Reorder')}</div>
              </CardContent>
            </Card>
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-4 pb-3">
                <div className="text-2xl font-bold text-green-700">
                  {forecastData.summary?.excessItems || 0}
                </div>
                <div className="text-xs text-green-600">{t('Excess Stock')}</div>
              </CardContent>
            </Card>
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4 pb-3">
                <div className="text-2xl font-bold text-blue-700">
                  {formatCurrency(forecastData.summary?.totalReorderValue || 0)}
                </div>
                <div className="text-xs text-blue-600">{t('Reorder Value')}</div>
              </CardContent>
            </Card>
          </div>

          {/* Forecast Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-purple-600" />
                    {t('AI Demand Forecast')}
                  </CardTitle>
                  <CardDescription>
                    {t('Projected usage and reorder suggestions for next 30/60/90 days')}
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowForecast(false)}>
                  {t('Hide')}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[850px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('ui.item')}</TableHead>
                    <TableHead>{t('ui.current_stock')}</TableHead>
                    <TableHead>{t('Daily Usage')}</TableHead>
                    <TableHead>{t('Trend')}</TableHead>
                    <TableHead>30d / 60d / 90d</TableHead>
                    <TableHead>{t('Stockout In')}</TableHead>
                    <TableHead>{t('ui.suggested_order')}</TableHead>
                    <TableHead>{t('ui.urgency')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(forecastData.forecasts || [])
                    .filter(
                      (f: any) =>
                        f.reorderRecommended || f.urgency === 'CRITICAL' || f.urgency === 'SOON'
                    )
                    .sort((a: any, b: any) => a.daysUntilStockout - b.daysUntilStockout)
                    .map((forecast: any) => (
                      <TableRow key={forecast.itemId}>
                        <TableCell className="font-medium">{forecast.itemName}</TableCell>
                        <TableCell>{forecast.currentStock}</TableCell>
                        <TableCell>{forecast.avgDailyUsage}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {forecast.trend === 'INCREASING' && (
                              <ArrowUp className="h-3 w-3 text-red-500" />
                            )}
                            {forecast.trend === 'DECREASING' && (
                              <ArrowDown className="h-3 w-3 text-green-500" />
                            )}
                            {forecast.trend === 'STABLE' && (
                              <Minus className="h-3 w-3 text-muted-foreground" />
                            )}
                            <span className="text-xs">{forecast.trend}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {forecast.projected30Days} / {forecast.projected60Days} /{' '}
                          {forecast.projected90Days}
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              forecast.daysUntilStockout <= 7
                                ? 'text-red-600 font-bold'
                                : forecast.daysUntilStockout <= 14
                                  ? 'text-amber-600 font-medium'
                                  : ''
                            }
                          >
                            {forecast.daysUntilStockout > 365 ? '365+' : forecast.daysUntilStockout}{' '}
                            {t("days")}
                          </span>
                        </TableCell>
                        <TableCell>
                          {forecast.suggestedOrderQty > 0 && (
                            <div className="flex items-center gap-1">
                              <ShoppingCart className="h-3 w-3" />
                              <span className="font-medium">{forecast.suggestedOrderQty}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              forecast.urgency === 'CRITICAL'
                                ? 'bg-red-100 text-red-700 border-0'
                                : forecast.urgency === 'SOON'
                                  ? 'bg-amber-100 text-amber-700 border-0'
                                  : forecast.urgency === 'NORMAL'
                                    ? 'bg-blue-100 text-blue-700 border-0'
                                    : 'bg-green-100 text-green-700 border-0'
                            }
                          >
                            {forecast.urgency}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('Search by name, item code, or description...')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2">
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder={t('ui.category')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('ui.all_categories')}</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name} ({cat.item_count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder={t('ui.type')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('ui.all_types')}</SelectItem>
                    <SelectItem value="DENTAL_MATERIAL">{t('ui.dental_material')}</SelectItem>
                    <SelectItem value="INSTRUMENT">{t('ui.instrument')}</SelectItem>
                    <SelectItem value="CONSUMABLE">{t('ui.consumable')}</SelectItem>
                    <SelectItem value="MEDICINE">{t('ui.medicine')}</SelectItem>
                    <SelectItem value="OFFICE_SUPPLY">{t('ui.office_supply')}</SelectItem>
                    <SelectItem value="EQUIPMENT">{t('ui.equipment')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder={t('ui.status')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('ui.all_status')}</SelectItem>
                    <SelectItem value="active">{t('ui.active')}</SelectItem>
                    <SelectItem value="inactive">{t('ui.inactive')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="lowStock"
                checked={lowStockOnly}
                onCheckedChange={(checked) => setLowStockOnly(checked === true)}
              />
              <label
                htmlFor="lowStock"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                {t('Show only low stock items')}
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inventory Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[850px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t('ui.item_code')}</TableHead>
                <TableHead>{t('ui.name')}</TableHead>
                <TableHead>{t('ui.category')}</TableHead>
                <TableHead>{t('ui.type')}</TableHead>
                <TableHead>{t('ui.stock')}</TableHead>
                <TableHead>{t('ui.unit_price')}</TableHead>
                <TableHead>{t('Stock Status')}</TableHead>
                <TableHead className="text-right">{t('ui.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
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
                    <TableCell>
                      <Skeleton className="h-4 w-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">{t('No inventory items found')}</p>
                      <Link href="/inventory/new">
                        <Button variant="outline" size="sm">
                          <Plus className="h-4 w-4 mr-2" />
                          {t('Add Item')}
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.sku}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                          <Package className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium">{item.name}</div>
                          {item.description && (
                            <div className="text-sm text-muted-foreground line-clamp-1">
                              {t(item.description)}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{item.categoryName || t("Uncategorized")}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{formatItemType(item.itemType)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">
                          {item.currentStock} {item.unit}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("Min:")} {item.minimumStock}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{formatCurrency(item.purchasePrice)}</div>
                      {item.sellingPrice > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {t("Selling:")} {formatCurrency(item.sellingPrice)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {getStockStatusBadge(item.stockStatus)}
                        {!item.isActive && (
                          <Badge className="bg-muted text-muted-foreground border-0">{t('ui.inactive')}</Badge>
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
                          <DropdownMenuItem onClick={() => router.push(`/inventory/${item.id}`)}>
                            <Eye className="h-4 w-4 mr-2" />{t('ui.view_details')}</DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => router.push(`/inventory/${item.id}/edit`)}
                          >
                            <Edit className="h-4 w-4 mr-2" />{t('ui.edit')}</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => router.push(`/inventory/transactions?item=${item.id}`)}
                          >
                            <TrendingUp className="h-4 w-4 mr-2" />
                            {t('Stock History')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {!loading && pagination.pages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-4">
              <div className="text-sm text-muted-foreground">
                {t("Showing")} {(pagination.page - 1) * pagination.limit + 1} {t("to")}{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} {t("of")}{' '}
                {pagination.total} {t("items")}
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
                  {t("Page")} {pagination.page} {t("of")} {pagination.pages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                  disabled={pagination.page >= pagination.pages}
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
