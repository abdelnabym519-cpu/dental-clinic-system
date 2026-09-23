'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Receipt, Save } from 'lucide-react'
import { GatewaySettings } from '@/components/billing/gateway-settings'

export default function BillingSettingsPage() {
  const { t } = useLanguage()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  // The seeded defaults are localized on first render (the saved values come
  // from /api/settings and are shown verbatim). Without this the Arabic UI
  // showed the English placeholder defaults as editable text in the boxes.
  const [settings, setSettings] = useState(() => ({
    cgstRate: '14',
    sgstRate: '0',
    defaultPaymentTerms: '30',
    invoicePrefix: 'INV',
    receiptPrefix: 'REC',
    invoiceStartingNumber: '1001',
    invoiceNotes: t('Thank you for choosing our services.'),
    termsAndConditions: t('settings.billing.defaultTerms'),
    currencySymbol: 'EGP ',
    currencyCode: 'EGP',
    enableAutoInvoice: 'true',
    lateFeePercentage: '2',
    minimumDueAmount: '100',
  }))

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings?category=billing')
      const result = await response.json()

      if (result.success && result.data) {
        const settingsMap: any = {}
        result.data.forEach((s: any) => {
          const key = s.key.replace('billing.', '')
          settingsMap[key] = s.value
        })

        setSettings((prev) => ({ ...prev, ...settingsMap }))
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    }
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      const settingsArray = Object.entries(settings).map(([key, value]) => ({
        key: `billing.${key}`,
        value: value.toString(),
        category: 'billing',
      }))

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsArray }),
      })

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Billing settings saved successfully',
        })
      } else {
        throw new Error('Failed to save settings')
      }
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

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Receipt className="w-8 h-8" />
          {t('Billing Settings')}
        </h1>
        <p className="text-muted-foreground">
          {t('Configure invoicing, tax rates, and payment settings')}
        </p>
      </div>

      <div className="space-y-6">
        {/* Payment Gateway */}
        <GatewaySettings />

        {/* Tax Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>{t('Tax Configuration')}</CardTitle>
            <CardDescription>{t('VAT (ضريبة القيمة المضافة) rate for invoicing')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cgstRate">{t("VAT Rate (%)")}</Label>
                <Input
                  id="cgstRate"
                  type="number"
                  step="0.01"
                  value={settings.cgstRate}
                  onChange={(e) => setSettings({ ...settings, cgstRate: e.target.value })}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  {t("Egyptian standard VAT rate is 14% (medical services may be exempt)")}
                </p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>{t("Applied VAT rate:")}</strong> {settings.cgstRate}%
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Invoice Format */}
        <Card>
          <CardHeader>
            <CardTitle>{t('Invoice Format')}</CardTitle>
            <CardDescription>{t('Customize invoice and receipt numbering')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="invoicePrefix">{t('Invoice Prefix')}</Label>
                <Input
                  id="invoicePrefix"
                  value={settings.invoicePrefix}
                  onChange={(e) => setSettings({ ...settings, invoicePrefix: e.target.value })}
                  placeholder={t('INV')}
                />
              </div>

              <div>
                <Label htmlFor="receiptPrefix">{t('Receipt Prefix')}</Label>
                <Input
                  id="receiptPrefix"
                  value={settings.receiptPrefix}
                  onChange={(e) => setSettings({ ...settings, receiptPrefix: e.target.value })}
                  placeholder={t('REC')}
                />
              </div>

              <div>
                <Label htmlFor="invoiceStartingNumber">{t('Starting Number')}</Label>
                <Input
                  id="invoiceStartingNumber"
                  type="number"
                  value={settings.invoiceStartingNumber}
                  onChange={(e) =>
                    setSettings({ ...settings, invoiceStartingNumber: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="bg-muted/50 border rounded-lg p-3">
              <p className="text-sm text-muted-foreground">
                <strong>{t("Preview:")}</strong> {settings.invoicePrefix}
                {settings.invoiceStartingNumber}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Payment Terms */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ui.payment_terms')}</CardTitle>
            <CardDescription>{t('Default payment policies')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="defaultPaymentTerms">{t("Payment Due (days)")}</Label>
                <Input
                  id="defaultPaymentTerms"
                  type="number"
                  value={settings.defaultPaymentTerms}
                  onChange={(e) =>
                    setSettings({ ...settings, defaultPaymentTerms: e.target.value })
                  }
                />
                <p className="text-sm text-muted-foreground mt-1">{t('Days until payment is due')}</p>
              </div>

              <div>
                <Label htmlFor="lateFeePercentage">{t("Late Fee (%)")}</Label>
                <Input
                  id="lateFeePercentage"
                  type="number"
                  step="0.01"
                  value={settings.lateFeePercentage}
                  onChange={(e) => setSettings({ ...settings, lateFeePercentage: e.target.value })}
                />
                <p className="text-sm text-muted-foreground mt-1">{t('Late payment penalty')}</p>
              </div>

              <div>
                <Label htmlFor="minimumDueAmount">{t('Minimum Due Amount')}</Label>
                <Input
                  id="minimumDueAmount"
                  type="number"
                  value={settings.minimumDueAmount}
                  onChange={(e) => setSettings({ ...settings, minimumDueAmount: e.target.value })}
                />
                <p className="text-sm text-muted-foreground mt-1">{t('Minimum invoice amount')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Currency */}
        <Card>
          <CardHeader>
            <CardTitle>{t('Currency Settings')}</CardTitle>
            <CardDescription>{t('Configure currency display')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="currencyCode">{t('Currency Code')}</Label>
                <Input
                  id="currencyCode"
                  value={settings.currencyCode}
                  onChange={(e) => setSettings({ ...settings, currencyCode: e.target.value })}
                  placeholder={t('EGP')}
                />
              </div>

              <div>
                <Label htmlFor="currencySymbol">{t('Currency Symbol')}</Label>
                <Input
                  id="currencySymbol"
                  value={settings.currencySymbol}
                  onChange={(e) => setSettings({ ...settings, currencySymbol: e.target.value })}
                  placeholder={t('EGP ')}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Invoice Notes */}
        <Card>
          <CardHeader>
            <CardTitle>{t('Invoice Footer')}</CardTitle>
            <CardDescription>{t('Default notes and terms for invoices')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="invoiceNotes">{t('Invoice Notes')}</Label>
              <Textarea
                id="invoiceNotes"
                value={settings.invoiceNotes}
                onChange={(e) => setSettings({ ...settings, invoiceNotes: e.target.value })}
                rows={2}
                placeholder={t('Thank you for choosing our services.')}
              />
              <p className="text-sm text-muted-foreground mt-1">
                {t('Appears at the bottom of invoices')}
              </p>
            </div>

            <div>
              <Label htmlFor="termsAndConditions">{t('Terms and Conditions')}</Label>
              <Textarea
                id="termsAndConditions"
                value={settings.termsAndConditions}
                onChange={(e) => setSettings({ ...settings, termsAndConditions: e.target.value })}
                rows={4}
                placeholder={t('Payment is due within 30 days...')}
              />
              <p className="text-sm text-muted-foreground mt-1">{t('Payment terms and conditions')}</p>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSaveSettings} disabled={saving} size="lg">
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : t("Save Billing Settings")}
          </Button>
        </div>
      </div>
    </div>
  )
}
