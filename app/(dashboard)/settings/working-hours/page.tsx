'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/components/providers/language-provider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { Clock, Loader2, Save } from 'lucide-react'

// Issue 2 — doctor working-hours management (ADMIN).
// Days are the Egyptian work week (السبت…الجمعة displayed RTL); each day has
// start/end times and an active toggle. Saving writes StaffShift rows — an
// inactive day means the doctor is OFF (the slot generator treats it as
// closed instead of falling back to clinic hours).

const DAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

interface DayRow {
  dayOfWeek: number
  startTime: string
  endTime: string
  isActive: boolean
  configured: boolean
}

interface Doctor {
  id: string
  firstName: string
  lastName: string
  specialization: string | null
}

export default function WorkingHoursPage() {
  const { t } = useLanguage()
  const { toast } = useToast()
  const [doctors, setDoctors] = useState<Doctor[] | null>(null)
  const [doctorId, setDoctorId] = useState<string>('')
  const [days, setDays] = useState<DayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/staff/doctors')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((data) => {
        setDoctors(data.doctors ?? [])
        if (data.doctors?.length) setDoctorId(data.doctors[0].id)
      })
      .catch(() => setDoctors([]))
  }, [])

  useEffect(() => {
    if (!doctorId) return
    setLoading(true)
    fetch(`/api/settings/working-hours?doctorId=${doctorId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((data) => setDays(data.days ?? []))
      .catch(() => setDays([]))
      .finally(() => setLoading(false))
  }, [doctorId])

  const updateDay = (dayOfWeek: number, patch: Partial<DayRow>) => {
    setDays((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)))
  }

  const save = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/settings/working-hours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId, days }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast({ title: data.error || 'حدث خطأ في حفظ ساعات العمل', variant: 'destructive' })
        return
      }
      toast({ title: 'تم حفظ ساعات العمل بنجاح' })
    } catch {
      toast({ title: 'حدث خطأ في حفظ ساعات العمل', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (doctors === null) {
    return <div className="container mx-auto p-6">{t('ui.loading')}</div>
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Clock className="w-8 h-8" />
          {t('ساعات العمل')}
        </h1>
        <p className="text-muted-foreground">
          {t('حدد ساعات عمل كل طبيب — الأيام غير المفعلة يعتبرها النظام إجازة ولا تظهر مواعيدها')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('اختر الطبيب')}</CardTitle>
          <CardDescription>{t('ساعات العمل الأسبوعية لكل طبيب على حدة')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {doctors.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('لا يوجد أطباء مسجلين بعد')}</p>
          ) : (
            <>
              <div className="space-y-2 max-w-sm">
                <Label>{t('الطبيب')}</Label>
                <Select value={doctorId} onValueChange={setDoctorId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('اختر طبيبًا')} />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.firstName} {d.lastName}
                        {d.specialization ? ` — ${d.specialization}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {loading ? (
                <div className="flex items-center gap-2 p-4 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('ui.loading')}
                </div>
              ) : (
                <div className="space-y-3">
                  {days.map((day) => (
                    <div
                      key={day.dayOfWeek}
                      className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 rounded-lg border p-4"
                    >
                      <div className="w-24 font-medium">{DAY_NAMES_AR[day.dayOfWeek]}</div>
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          type="time"
                          value={day.startTime}
                          onChange={(e) => updateDay(day.dayOfWeek, { startTime: e.target.value })}
                          disabled={!day.isActive}
                          className="w-32"
                          aria-label={`${DAY_NAMES_AR[day.dayOfWeek]} — من`}
                        />
                        <span className="text-muted-foreground">—</span>
                        <Input
                          type="time"
                          value={day.endTime}
                          onChange={(e) => updateDay(day.dayOfWeek, { endTime: e.target.value })}
                          disabled={!day.isActive}
                          className="w-32"
                          aria-label={`${DAY_NAMES_AR[day.dayOfWeek]} — إلى`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {day.isActive ? t('مفعّل') : t('إجازة')}
                        </span>
                        <Switch
                          checked={day.isActive}
                          onCheckedChange={(checked) => updateDay(day.dayOfWeek, { isActive: checked })}
                          aria-label={`${DAY_NAMES_AR[day.dayOfWeek]} — تفعيل`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {days.length > 0 && (
                <div className="flex justify-end">
                  <Button onClick={save} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t('حفظ ساعات العمل')}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
