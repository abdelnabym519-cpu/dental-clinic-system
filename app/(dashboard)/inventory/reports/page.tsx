'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function InventoryReportsPage() {
  const { locale } = useLanguage()
  const { t } = useLanguage()
  const [activeReport, setActiveReport] = useState('summary')
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState<any>(null)
  const [reportParams, setReportParams] = useState({
    days: 30,
  })

  useEffect(() => {
    fetchReport()
  }, [activeReport, reportParams])

  const fetchReport = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        type: activeReport,
        days: String(reportParams.days),
      })

      const response = await fetch(`/api/inventory/reports?${params}`)
      const data = await response.json()

      if (data.success) {
        setReportData(data.data)
      }
    } catch (error) {
      console.error('Error fetching report:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: 0,
    }).format(amount)
  }

  const renderSummaryReport = () => {
    if (!reportData) return null

    return (
      <div>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">{t('Total Items')}</h3>
            <p className="text-3xl font-bold mt-2">{reportData.summary.totalItems}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {reportData.summary.activeItems} {t("active")}
            </p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">{t('Out of Stock')}</h3>
            <p className="text-3xl font-bold mt-2 text-red-600">
              {reportData.summary.outOfStockItems}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{t('Items need restock')}</p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">{t('Low Stock')}</h3>
            <p className="text-3xl font-bold mt-2 text-orange-600">
              {reportData.summary.lowStockItems}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{t('Items below minimum')}</p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">{t('Inventory Value')}</h3>
            <p className="text-3xl font-bold mt-2 text-green-600">
              {formatCurrency(reportData.summary.totalInventoryValue || 0)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">{t('Total stock value')}</p>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="bg-background p-6 rounded-lg shadow mb-6">
          <h3 className="text-lg font-bold mb-4">{t('Inventory by Category')}</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.category')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.item_count')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    {t('Category Value')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-background divide-y divide-border">
                {reportData.categoryBreakdown.map((cat: any, index: number) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {cat.category || t("Uncategorized")}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {cat.itemCount}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {formatCurrency(cat.categoryValue || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Type Breakdown */}
        <div className="bg-background p-6 rounded-lg shadow">
          <h3 className="text-lg font-bold mb-4">{t('Inventory by Type')}</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.type')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.item_count')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    {t('Type Value')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-background divide-y divide-border">
                {reportData.typeBreakdown.map((type: any, index: number) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {type.itemType.replace('_', ' ').toUpperCase()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {type.itemCount}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {formatCurrency(type.typeValue || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  const renderLowStockReport = () => {
    if (!reportData || !Array.isArray(reportData)) return null

    return (
      <div className="bg-background rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.item_code')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.item_name')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.current_stock')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.minimum_stock')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.urgency')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.suggested_order')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.supplier')}</th>
              </tr>
            </thead>
            <tbody className="bg-background divide-y divide-border">
              {reportData.map((item: any) => (
                <tr key={item.id} className="hover:bg-muted/50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                    {item.sku}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                    {item.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                    {item.currentStock} {item.unit}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                    {item.minimumStock} {item.unit}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        item.urgency === 'out_of_stock'
                          ? 'bg-red-100 text-red-800'
                          : item.urgency === 'critical'
                            ? 'bg-orange-100 text-orange-800'
                            : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {item.urgency.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                    {item.suggestedOrderQuantity} {item.unit}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                    {item.supplierName || '-'}
                    {item.supplierPhone && (
                      <div className="text-xs text-muted-foreground">{item.supplierPhone}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const renderExpiringReport = () => {
    if (!reportData) return null

    return (
      <div>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">{t('Expired Batches')}</h3>
            <p className="text-3xl font-bold mt-2 text-red-600">
              {reportData.summary.expiredBatches || 0}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("Value:")} {formatCurrency(reportData.summary.expiredValue || 0)}
            </p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">{t('Expiring Soon')}</h3>
            <p className="text-3xl font-bold mt-2 text-orange-600">
              {reportData.summary.expiringSoonBatches || 0}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("Value:")} {formatCurrency(reportData.summary.expiringSoonValue || 0)}
            </p>
          </div>
        </div>

        {/* Items Table */}
        <div className="bg-background rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.item')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    {t('Batch Number')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.expiry_date')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    {t('Days to Expiry')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.quantity')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    {t('Value at Risk')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.status')}</th>
                </tr>
              </thead>
              <tbody className="bg-background divide-y divide-border">
                {reportData.items.map((item: any, index: number) => (
                  <tr key={index} className="hover:bg-muted/50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {item.name}
                      <br />
                      <span className="text-xs text-muted-foreground">{item.sku}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {item.batchNumber}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {new Date(item.expiryDate).toLocaleDateString(locale)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {item.daysToExpiry} {t("days")}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {item.remainingQty} {item.unit}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {formatCurrency(item.valueAtRisk || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          item.urgency === 'expired'
                            ? 'bg-red-100 text-red-800'
                            : item.urgency === 'critical'
                              ? 'bg-orange-100 text-orange-800'
                              : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {item.urgency.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  const renderStockValuationReport = () => {
    if (!reportData) return null

    return (
      <div>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">{t('Total Stock Value')}</h3>
            <p className="text-3xl font-bold mt-2 text-green-600">
              {formatCurrency(reportData.totals.totalValue || 0)}
            </p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">{t('Items in Stock')}</h3>
            <p className="text-3xl font-bold mt-2">{reportData.totals.itemsInStock || 0}</p>
          </div>

          <div className="bg-background p-6 rounded-lg shadow">
            <h3 className="text-sm font-medium text-muted-foreground">{t('Average Item Value')}</h3>
            <p className="text-3xl font-bold mt-2">
              {formatCurrency(reportData.totals.averageItemValue || 0)}
            </p>
          </div>
        </div>

        {/* Items Table */}
        <div className="bg-background rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.item_code')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.item_name')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.category')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.stock')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('ui.unit_price')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    {t('Stock Value')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-background divide-y divide-border">
                {reportData.items.map((item: any) => (
                  <tr key={item.id} className="hover:bg-muted/50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {item.sku}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {item.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {item.categoryName || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {item.currentStock} {item.unit}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {formatCurrency(item.purchasePrice)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {formatCurrency(item.stockValue || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{t('Inventory Reports')}</h1>
        <Link
          href="/inventory"
          className="px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/80"
        >{t('ui.back_to_inventory')}</Link>
      </div>

      {/* Report Tabs */}
      <div className="bg-background rounded-lg shadow mb-6">
        <div className="border-b border-border">
          <nav className="flex space-x-8 px-6" aria-label={t('Tabs')}>
            {[
              { id: 'summary', label: 'Summary' },
              { id: 'low_stock', label: 'Low Stock' },
              { id: 'expiring', label: 'Expiring Items' },
              { id: 'stock_valuation', label: 'Stock Valuation' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveReport(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeReport === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                {t(tab.label)}
              </button>
            ))}
          </nav>
        </div>

        {/* Report Parameters */}
        {activeReport === 'expiring' && (
          <div className="p-6 bg-muted/50">
            <label className="block text-sm font-medium text-foreground mb-2">{t('Days Ahead')}</label>
            <select
              value={reportParams.days}
              onChange={(e) => setReportParams({ ...reportParams, days: parseInt(e.target.value) })}
              className="px-4 py-2 border border-border rounded-lg"
            >
              <option value="7">{t("7 days")}</option>
              <option value="15">{t("15 days")}</option>
              <option value="30">{t("30 days")}</option>
              <option value="60">{t("60 days")}</option>
              <option value="90">{t("90 days")}</option>
            </select>
          </div>
        )}
      </div>

      {/* Report Content */}
      <div className="mt-6">
        {loading ? (
          <div className="bg-background rounded-lg shadow p-8 text-center">{t('ui.loading')}</div>
        ) : (
          <>
            {activeReport === 'summary' && renderSummaryReport()}
            {activeReport === 'low_stock' && renderLowStockReport()}
            {activeReport === 'expiring' && renderExpiringReport()}
            {activeReport === 'stock_valuation' && renderStockValuationReport()}
          </>
        )}
      </div>
    </div>
  )
}
