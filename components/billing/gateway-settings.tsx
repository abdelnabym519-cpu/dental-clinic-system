'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { CreditCard, Save, Loader2, Copy, Check, Shield, ExternalLink } from 'lucide-react'

interface GatewayConfig {
  provider: string
  isEnabled: boolean
  isLiveMode: boolean
  fawryMerchantCode: string | null
  fawrySecretKey: string | null
  paymobApiKey: string | null
  paymobIntegrationId: string | null
  paymobIframeId: string | null
  instapayHandle: string | null
  webhookUrl: string | null
}

export function GatewaySettings() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const [provider, setProvider] = useState('')
  const [isEnabled, setIsEnabled] = useState(false)
  const [isLiveMode, setIsLiveMode] = useState(false)

  // Fawry
  const [fawryMerchantCode, setFawryMerchantCode] = useState('')
  const [fawrySecretKey, setFawrySecretKey] = useState('')

  // Paymob
  const [paymobApiKey, setPaymobApiKey] = useState('')
  const [paymobIntegrationId, setPaymobIntegrationId] = useState('')
  const [paymobIframeId, setPaymobIframeId] = useState('')

  // InstaPay
  const [instapayHandle, setInstapayHandle] = useState('')

  const [webhookUrl, setWebhookUrl] = useState('')

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/settings/billing/gateway')
      if (!res.ok) return
      const data = await res.json()

      if (data.config) {
        const c = data.config as GatewayConfig
        setProvider(c.provider || '')
        setIsEnabled(c.isEnabled)
        setIsLiveMode(c.isLiveMode)
        setFawryMerchantCode(c.fawryMerchantCode || '')
        setFawrySecretKey(c.fawrySecretKey || '')
        setPaymobApiKey(c.paymobApiKey || '')
        setPaymobIntegrationId(c.paymobIntegrationId || '')
        setPaymobIframeId(c.paymobIframeId || '')
        setInstapayHandle(c.instapayHandle || '')
        setWebhookUrl(c.webhookUrl || '')
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!provider) {
      toast({
        title: 'Error',
        description: 'Please select a payment provider',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/settings/billing/gateway', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          isEnabled,
          isLiveMode,
          fawryMerchantCode,
          fawrySecretKey,
          paymobApiKey,
          paymobIntegrationId,
          paymobIframeId,
          instapayHandle,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save')
      }

      const data = await res.json()
      setWebhookUrl(data.config?.webhookUrl || '')

      toast({
        title: 'Success',
        description: 'Payment gateway settings saved',
      })

      // Refresh to get masked secrets
      fetchConfig()
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save settings',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const copyWebhookUrl = () => {
    if (webhookUrl) {
      navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Payment Gateway
            </CardTitle>
            <CardDescription>
              Connect your own Fawry, Paymob, or InstaPay account to accept online payments
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {isEnabled && (
              <Badge variant="default" className="bg-green-100 text-green-700 border-0">
                Active
              </Badge>
            )}
            {isLiveMode && (
              <Badge variant="default" className="bg-blue-100 text-blue-700 border-0">
                Live
              </Badge>
            )}
            {!isLiveMode && provider && <Badge variant="secondary">Test Mode</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Provider Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Payment Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FAWRY">Fawry</SelectItem>
                <SelectItem value="PAYMOB">Paymob</SelectItem>
                <SelectItem value="INSTAPAY">InstaPay</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Use your own merchant account credentials
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="gateway-enabled">Enable Online Payments</Label>
              <Switch id="gateway-enabled" checked={isEnabled} onCheckedChange={setIsEnabled} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="gateway-live">
                Live Mode
                <span className="text-xs text-muted-foreground ml-1">
                  (uncheck for test/sandbox)
                </span>
              </Label>
              <Switch id="gateway-live" checked={isLiveMode} onCheckedChange={setIsLiveMode} />
            </div>
          </div>
        </div>

        {/* Fawry Credentials */}
        {provider === 'FAWRY' && (
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium text-sm">Fawry Credentials</h4>
            <p className="text-xs text-muted-foreground">
              Get these from your{' '}
              <a
                href="https://fawry.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline inline-flex items-center gap-1"
              >
                Fawry Dashboard <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="fawry-merchant">Merchant Code</Label>
                <Input
                  id="fawry-merchant"
                  value={fawryMerchantCode}
                  onChange={(e) => setFawryMerchantCode(e.target.value)}
                  placeholder="e.g. 1AbCdEfGhIjK"
                />
              </div>
              <div>
                <Label htmlFor="fawry-secret">
                  Secure Key
                  <Shield className="h-3 w-3 inline ml-1 text-muted-foreground" />
                </Label>
                <Input
                  id="fawry-secret"
                  type="password"
                  value={fawrySecretKey}
                  onChange={(e) => setFawrySecretKey(e.target.value)}
                  placeholder="Enter secure key"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Stored encrypted. Leave unchanged to keep existing.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Paymob Credentials */}
        {provider === 'PAYMOB' && (
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium text-sm">Paymob (Accept) Credentials</h4>
            <p className="text-xs text-muted-foreground">
              Get these from your{' '}
              <a
                href="https://accept.paymob.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline inline-flex items-center gap-1"
              >
                Paymob Dashboard <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="paymob-api-key">
                  API Key
                  <Shield className="h-3 w-3 inline ml-1 text-muted-foreground" />
                </Label>
                <Input
                  id="paymob-api-key"
                  type="password"
                  value={paymobApiKey}
                  onChange={(e) => setPaymobApiKey(e.target.value)}
                  placeholder="Enter API key"
                />
              </div>
              <div>
                <Label htmlFor="paymob-integration">Integration ID</Label>
                <Input
                  id="paymob-integration"
                  value={paymobIntegrationId}
                  onChange={(e) => setPaymobIntegrationId(e.target.value)}
                  placeholder="e.g. 123456"
                />
              </div>
              <div>
                <Label htmlFor="paymob-iframe">Iframe ID</Label>
                <Input
                  id="paymob-iframe"
                  value={paymobIframeId}
                  onChange={(e) => setPaymobIframeId(e.target.value)}
                  placeholder="e.g. 789012"
                />
              </div>
            </div>
          </div>
        )}

        {/* InstaPay Credentials */}
        {provider === 'INSTAPAY' && (
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium text-sm">InstaPay Handle</h4>
            <p className="text-xs text-muted-foreground">
              The clinic&apos;s InstaPay address (IPA) patients transfer to — e.g. dentora@instapay
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="instapay-handle">InstaPay Handle</Label>
                <Input
                  id="instapay-handle"
                  value={instapayHandle}
                  onChange={(e) => setInstapayHandle(e.target.value)}
                  placeholder="clinic@instapay"
                />
              </div>
            </div>
          </div>
        )}

        {/* Webhook URL */}
        {provider && webhookUrl && (
          <div className="border-t pt-4">
            <Label>Webhook URL</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Configure this URL in your {provider.charAt(0) + provider.slice(1).toLowerCase()}{' '}
              dashboard to receive payment notifications
            </p>
            <div className="flex items-center gap-2">
              <Input value={webhookUrl} readOnly className="font-mono text-xs bg-muted" />
              <Button variant="outline" size="icon" onClick={copyWebhookUrl}>
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Save */}
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving || !provider}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {saving ? 'Saving...' : 'Save Gateway Settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
