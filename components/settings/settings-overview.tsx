'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/components/providers/language-provider'
import {
  BookOpen,
  Building2,
  Calendar,
  Database,
  Languages,
  Link2,
  MessageSquare,
  Receipt,
  Settings as SettingsIcon,
  Shield,
  Upload,
  Users,
  Monitor,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react'

/**
 * Icon registry: the server page passes serializable icon NAMES (functions
 * cannot cross the server/client boundary), resolved to components here.
 */
const ICONS: Record<string, LucideIcon> = {
  BookOpen,
  Building2,
  Calendar,
  Database,
  Languages,
  Link2,
  MessageSquare,
  Receipt,
  Settings: SettingsIcon,
  Shield,
  Upload,
  Users,
}

export interface SettingsCategory {
  title: string
  description: string
  icon: string
  href: string
  color: string
}

/**
 * Presentational settings hub. The category list is produced by the server
 * page (filtered by the current role via lib/settings-access.ts), so this
 * component never renders a link the user is not allowed to open.
 */
export function SettingsOverview({ categories }: { categories: SettingsCategory[] }) {
  const { theme, setTheme } = useTheme()
  const { t } = useLanguage()

  // Hydration-safety: next-themes' useTheme() returns `undefined` for `theme`
  // during SSR but a concrete value (localStorage entry or defaultTheme) on
  // the client's hydration render, so deriving the button `variant` from
  // `theme` directly produced different classNames in the server HTML vs the
  // hydrated tree ("attributes didn't match" on the theme buttons). Gate the
  // active highlight behind `mounted`: the first client render is identical
  // to the server HTML, and the correct highlight appears right after mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <SettingsIcon className="w-8 h-8" />
          {t('settings.title')}
        </h1>
        <p className="text-muted-foreground mt-2">{t('settings.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {categories.map((category) => (
          <Link key={category.href} href={category.href}>
            <Card className="h-full card-interactive">
              <CardHeader>
                <div
                  className={`w-12 h-12 rounded-lg flex items-center justify-center ${category.color} mb-3`}
                >
                  {React.createElement(ICONS[category.icon] ?? SettingsIcon, { className: 'w-6 h-6' })}
                </div>
                <CardTitle className="text-xl">{t(category.title)}</CardTitle>
                <CardDescription className="text-sm">{t(category.description)}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      {/* Appearance */}
      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sun className="w-5 h-5" />
              {t('settings.appearance')}
            </CardTitle>
            <CardDescription>{t('settings.appearanceDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              {(
                [
                  { value: 'light', label: 'Light', icon: Sun },
                  { value: 'dark', label: 'Dark', icon: Moon },
                  { value: 'system', label: 'System', icon: Monitor },
                ] as const
              ).map((opt) => (
                <Button
                  key={opt.value}
                  variant={mounted && theme === opt.value ? 'default' : 'outline'}
                  className="flex items-center gap-2"
                  onClick={() => setTheme(opt.value)}
                >
                  <opt.icon className="h-4 w-4" />
                  {t(opt.label)}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Info */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.systemInfo')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('settings.version')}:</span>
              <span className="font-medium">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('settings.database')}:</span>
              <span className="font-medium">MySQL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('settings.environment')}:</span>
              <span className="font-medium">{t('Production')}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.quickTips')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{t("• Regular backups are crucial for data safety")}</p>
            <p>{t("• Review audit logs periodically for security")}</p>
            <p>{t("• Keep clinic information updated")}</p>
            <p>{t("• Configure SMS/Email for automated reminders")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
