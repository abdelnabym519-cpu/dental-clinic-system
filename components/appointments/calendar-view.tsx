'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  MoreVertical,
  Eye,
  CalendarX,
  RefreshCw,
} from 'lucide-react'
import {
  appointmentStatusConfig,
  formatTime,
  getPatientName,
  getDoctorName,
} from '@/lib/appointment-utils'
import {
  toDateKey,
  startOfWeek,
  startOfMonth,
  addDays,
  timeToMinutes,
  agendaPositionPercent,
  agendaHeightPercent,
  AGENDA_START_MINUTES,
  AGENDA_END_MINUTES,
} from '@/lib/agenda-utils'

interface Appointment {
  id: string
  appointmentNo: string
  scheduledDate: string
  scheduledTime: string
  duration: number
  appointmentType: string
  status: string
  patient: {
    firstName: string
    lastName: string
    phone: string
  }
  doctor: {
    firstName: string
    lastName: string
  }
}

export interface AgendaProvider {
  id: string
  firstName: string
  lastName: string
  specialization?: string | null
}

interface CalendarViewProps {
  initialDate?: Date
  /** Provider (doctor) list for the schedule filter. Omit to hide the filter. */
  providers?: AgendaProvider[]
  /** Increment to force a refetch after external changes (e.g. dialog saved). */
  refreshKey?: number
  /** Hide the built-in toolbar (when embedding under a custom header). */
  hideToolbar?: boolean
}

const HOUR_PX = 64 // day view: pixels per hour
const WEEK_HOUR_PX = 48 // week view: pixels per hour
const DAY_START_H = AGENDA_START_MINUTES / 60
const DAY_END_H = AGENDA_END_MINUTES / 60
const HOURS = Array.from({ length: DAY_END_H - DAY_START_H }, (_, i) => DAY_START_H + i)
const WEEK_TOTAL_PX = (DAY_END_H - DAY_START_H) * WEEK_HOUR_PX

export function CalendarView({
  initialDate = new Date(),
  providers,
  refreshKey = 0,
  hideToolbar = false,
}: CalendarViewProps) {
  const router = useRouter()
  const [currentDate, setCurrentDate] = useState(initialDate)
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('week')
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [doctorId, setDoctorId] = useState<string>('all')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const dateStr = toDateKey(currentDate)
      let url = `/api/appointments?view=${viewMode}&date=${dateStr}`
      if (doctorId && doctorId !== 'all') url += `&doctorId=${doctorId}`
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('Failed to load the schedule')
      }
      const data = await response.json()
      setAppointments(data.appointments)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the schedule')
    } finally {
      setLoading(false)
    }
  }, [currentDate, viewMode, doctorId])

  useEffect(() => {
    fetchAppointments()
  }, [fetchAppointments, refreshKey])

  const navigatePrevious = () => {
    const newDate = new Date(currentDate)
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() - 1)
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() - 7)
    } else {
      newDate.setMonth(newDate.getMonth() - 1)
    }
    setCurrentDate(newDate)
  }

  const navigateNext = () => {
    const newDate = new Date(currentDate)
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() + 1)
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + 7)
    } else {
      newDate.setMonth(newDate.getMonth() + 1)
    }
    setCurrentDate(newDate)
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  const cancelAppointment = async (apt: Appointment) => {
    if (cancellingId) return
    const reason = window.confirm(
      `Cancel appointment ${apt.appointmentNo} for ${getPatientName(apt.patient)}?`
    )
    if (!reason) return
    try {
      setCancellingId(apt.id)
      const res = await fetch(`/api/appointments/${apt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED', cancellationReason: 'Cancelled from Agenda' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to cancel the appointment')
      }
      await fetchAppointments()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel the appointment')
    } finally {
      setCancellingId(null)
      setMenuFor(null)
    }
  }

  const getDateLabel = () => {
    if (viewMode === 'day') {
      return currentDate.toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    } else if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate)
      const weekEnd = addDays(weekStart, 6)
      return `${weekStart.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
      })} - ${weekEnd.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}`
    } else {
      return currentDate.toLocaleDateString('en-IN', {
        month: 'long',
        year: 'numeric',
      })
    }
  }

  const getWeekDays = () => {
    const weekStart = startOfWeek(currentDate)
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  }

  const getMonthDays = () => {
    const days = []
    const monthStart = startOfMonth(currentDate)
    const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

    // Add days from previous month to fill the first week
    const firstDayOfWeek = monthStart.getDay()
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      days.push({ date: addDays(monthStart, -i - 1), isCurrentMonth: false })
    }

    // Add days of current month
    for (let i = 1; i <= monthEnd.getDate(); i++) {
      days.push({ date: new Date(currentDate.getFullYear(), currentDate.getMonth(), i), isCurrentMonth: true })
    }

    // Add days from next month to fill the last week
    const remainingDays = 42 - days.length // 6 weeks * 7 days
    for (let i = 1; i <= remainingDays; i++) {
      days.push({ date: addDays(monthEnd, i), isCurrentMonth: false })
    }

    return days
  }

  /** Local-calendar-day comparison — never shifts across UTC boundaries. */
  const getAppointmentsForDate = (date: Date) => {
    const key = toDateKey(date)
    return appointments.filter((apt) => {
      const [y, m, d] = apt.scheduledDate.split(/[-T]/).map(Number)
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` === key
    })
  }

  const getStatusColor = (status: string) => {
    const config = appointmentStatusConfig[status]
    return config?.bgColor || 'bg-muted'
  }

  /** Render one positioned appointment block. */
  const renderBlock = (
    apt: Appointment,
    options: { hourPx: number; compact?: boolean; withActions?: boolean }
  ) => {
    const startMin = timeToMinutes(apt.scheduledTime)
    const topPct = agendaPositionPercent(apt.scheduledTime)
    const heightPct = agendaHeightPercent(apt.duration)
    const startLabel = formatTime(apt.scheduledTime)
    const cancelled = apt.status === 'CANCELLED'

    return (
      <div
        key={apt.id}
        role="button"
        tabIndex={0}
        aria-label={`Appointment ${apt.appointmentNo}: ${getPatientName(apt.patient)} at ${startLabel}, ${appointmentStatusConfig[apt.status]?.label ?? apt.status}`}
        className={`absolute left-1 right-1 rounded-md px-2 py-1 cursor-pointer overflow-hidden ${getStatusColor(
          apt.status
        )} ${cancelled ? 'opacity-60' : ''} hover:ring-1 hover:ring-primary/40 focus:outline-none focus:ring-2 focus:ring-primary`}
        style={{
          top: `${topPct}%`,
          height: `max(${heightPct}%, 1.75rem)`,
          ...(options.compact ? { paddingLeft: 4, paddingRight: 4 } : {}),
        }}
        onClick={() => router.push(`/appointments/${apt.id}`)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') router.push(`/appointments/${apt.id}`)
        }}
      >
        <div className="flex items-center justify-between gap-1">
          <p className={`font-medium truncate ${options.compact ? 'text-xs' : 'text-sm'}`}>
            {getPatientName(apt.patient)}
          </p>
          {options.withActions && (
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label={`Actions for appointment ${apt.appointmentNo}`}
                className="rounded p-0.5 hover:bg-black/10 focus:outline-none focus:ring-1 focus:ring-primary"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuFor(menuFor === apt.id ? null : apt.id)
                }}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
              {menuFor === apt.id && (
                <div
                  className="absolute right-0 top-5 z-20 w-40 rounded-md border bg-background p-1 shadow-md"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
                    onClick={() => router.push(`/appointments/${apt.id}`)}
                  >
                    <Eye className="h-3.5 w-3.5" /> View details
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
                    onClick={() => router.push(`/appointments/${apt.id}/edit`)}
                    disabled={cancelled}
                  >
                    <Calendar className="h-3.5 w-3.5" /> Edit / Reschedule
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-destructive hover:bg-muted disabled:opacity-50"
                    onClick={() => cancelAppointment(apt)}
                    disabled={cancelled || cancellingId === apt.id}
                  >
                    <CalendarX className="h-3.5 w-3.5" />
                    {cancellingId === apt.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <p className={`text-muted-foreground truncate ${options.compact ? 'text-[10px]' : 'text-xs'}`}>
          {options.compact
            ? startLabel
            : `${startLabel} · ${getDoctorName(apt.doctor)} · ${apt.duration}m`}
        </p>
      </div>
    )
  }

  /**
   * Narrow-viewport representation (§ responsiveness): a grouped agenda list
   * instead of the time grids, so mobile users get a usable schedule rather
   * than horizontal overflow. Shown below the `md` breakpoint only.
   */
  const renderMobileList = (days: Date[]) => {
    const groups = days
      .map((day) => ({ day, appts: getAppointmentsForDate(day) }))
      .filter(({ appts }) => appts.length > 0)

    return (
      <div className="space-y-4 rounded-lg border p-3" data-testid="agenda-mobile-list">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Calendar className="h-8 w-8" />
            <p className="text-sm">No appointments in this period</p>
          </div>
        ) : (
          groups.map(({ day, appts }) => (
            <div key={day.toISOString()}>
              <p className="mb-2 text-sm font-semibold">
                {day.toLocaleDateString('en-IN', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'short',
                })}
              </p>
              <ul className="space-y-2">
                {appts.map((apt) => (
                  <li key={apt.id}>
                    <button
                      type="button"
                      className={`w-full rounded-md border p-2 text-left ${getStatusColor(
                        apt.status
                      )} ${apt.status === 'CANCELLED' ? 'opacity-60' : ''}`}
                      onClick={() => router.push(`/appointments/${apt.id}`)}
                      aria-label={`Appointment ${apt.appointmentNo}: ${getPatientName(
                        apt.patient
                      )} at ${formatTime(apt.scheduledTime)}, ${
                        appointmentStatusConfig[apt.status]?.label ?? apt.status
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {formatTime(apt.scheduledTime)} · {getPatientName(apt.patient)}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wide">
                          {appointmentStatusConfig[apt.status]?.label ?? apt.status}
                        </span>
                      </span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {getDoctorName(apt.doctor)} · {apt.duration}m ·{' '}
                        {apt.appointmentType.replace('_', ' ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    )
  }

  const renderDayView = () => {
    const dayAppointments = getAppointmentsForDate(currentDate)
    const totalPx = (DAY_END_H - DAY_START_H) * HOUR_PX

    return (
      <div className="rounded-lg border overflow-hidden" data-testid="day-view">
        <div className="grid grid-cols-[80px_1fr] divide-x">
          {/* Time column */}
          <div className="bg-muted/30">
            {HOURS.map((h) => (
              <div key={h} className="px-2 text-xs text-muted-foreground" style={{ height: HOUR_PX }}>
                {formatTime(`${String(h).padStart(2, '0')}:00`)}
              </div>
            ))}
          </div>

          {/* Appointment column */}
          <div className="relative" style={{ height: totalPx }}>
            {HOURS.map((h) => (
              <div key={h} className="border-b" style={{ height: HOUR_PX }} />
            ))}

            {dayAppointments.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Calendar className="h-8 w-8" />
                <p className="text-sm">No appointments scheduled for this day</p>
              </div>
            )}

            {dayAppointments.map((apt) => renderBlock(apt, { hourPx: HOUR_PX, withActions: true }))}
          </div>
        </div>
      </div>
    )
  }

  const renderWeekView = () => {
    const weekDays = getWeekDays()

    return (
      <div className="rounded-lg border overflow-hidden" data-testid="week-view">
        {/* Header */}
        <div className="grid grid-cols-[80px_repeat(7,1fr)] divide-x bg-muted/30">
          <div className="p-2" />
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={`p-2 text-center ${
                day.toDateString() === new Date().toDateString() ? 'bg-primary/10' : ''
              }`}
            >
              <p className="text-xs text-muted-foreground">
                {day.toLocaleDateString('en-IN', { weekday: 'short' })}
              </p>
              <p className="font-semibold">{day.getDate()}</p>
            </div>
          ))}
        </div>

        {/* Time grid */}
        <div className="grid grid-cols-[80px_repeat(7,1fr)] divide-x overflow-x-auto">
          {/* Time column */}
          <div className="bg-muted/30">
            {HOURS.map((h) => (
              <div
                key={h}
                className="px-2 text-xs text-muted-foreground"
                style={{ height: WEEK_HOUR_PX }}
              >
                {formatTime(`${String(h).padStart(2, '0')}:00`)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day) => {
            const dayAppointments = getAppointmentsForDate(day)

            return (
              <div key={day.toISOString()} className="relative" style={{ height: WEEK_TOTAL_PX }}>
                {HOURS.map((h) => (
                  <div key={h} className="border-b" style={{ height: WEEK_HOUR_PX }} />
                ))}

                {dayAppointments.map((apt) =>
                  renderBlock(apt, { hourPx: WEEK_HOUR_PX, compact: true })
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const renderMonthView = () => {
    const monthDays = getMonthDays()

    return (
      <div className="rounded-lg border overflow-hidden" data-testid="month-view">
        {/* Header */}
        <div className="grid grid-cols-7 bg-muted/30">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="p-2 text-center text-sm font-medium">
              {day}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7">
          {monthDays.map(({ date, isCurrentMonth }, index) => {
            const dayAppointments = getAppointmentsForDate(date)
            const isToday = date.toDateString() === new Date().toDateString()
            const key = toDateKey(date)

            return (
              <div
                key={key + '-' + index}
                className={`min-h-24 border-b border-r p-1 ${
                  !isCurrentMonth ? 'bg-muted/20' : ''
                } ${isToday ? 'bg-primary/5' : ''}`}
              >
                <p
                  className={`text-sm mb-1 ${
                    !isCurrentMonth
                      ? 'text-muted-foreground'
                      : isToday
                        ? 'font-bold text-primary'
                        : ''
                  }`}
                >
                  {date.getDate()}
                </p>
                <div className="space-y-1">
                  {dayAppointments.slice(0, 3).map((apt) => (
                    <div
                      key={apt.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Appointment ${apt.appointmentNo} on ${key}`}
                      className={`text-xs p-1 rounded cursor-pointer truncate ${getStatusColor(
                        apt.status
                      )}`}
                      onClick={() => router.push(`/appointments/${apt.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') router.push(`/appointments/${apt.id}`)
                      }}
                    >
                      {formatTime(apt.scheduledTime)} {apt.patient.firstName}
                    </div>
                  ))}
                  {dayAppointments.length > 3 && (
                    <p className="text-xs text-muted-foreground pl-1">
                      +{dayAppointments.length - 3} more
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Calendar Header */}
      {!hideToolbar && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" onClick={navigatePrevious} aria-label="Previous period">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={navigateNext} aria-label="Next period">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToToday}>
              Today
            </Button>
            <h2 className="text-lg font-semibold ml-2">{getDateLabel()}</h2>
          </div>

          <div className="flex items-center gap-2">
            {providers && providers.length > 0 && (
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger className="w-[190px]" aria-label="Filter by provider">
                  <SelectValue placeholder="All providers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All providers</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      Dr. {p.firstName} {p.lastName}
                      {p.specialization ? ` — ${p.specialization}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={viewMode} onValueChange={(value) => setViewMode(value as 'day' | 'week' | 'month')}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="week">Week</SelectItem>
                <SelectItem value="month">Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Calendar Content */}
      {loading ? (
        <div className="flex items-center justify-center h-96" role="status" aria-live="polite">
          <RefreshCw className="h-5 w-5 mr-2 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Loading calendar...</span>
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <Calendar className="h-10 w-10 text-destructive/60" />
            <p className="text-sm font-medium text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground">
              The schedule could not be loaded. Check your connection and try again.
            </p>
            <Button variant="outline" size="sm" onClick={fetchAppointments}>
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {viewMode === 'day' && (
            <>
              <div className="hidden md:block">{renderDayView()}</div>
              <div className="md:hidden">{renderMobileList([currentDate])}</div>
            </>
          )}
          {viewMode === 'week' && (
            <>
              <div className="hidden md:block">{renderWeekView()}</div>
              <div className="md:hidden">{renderMobileList(getWeekDays())}</div>
            </>
          )}
          {viewMode === 'month' && renderMonthView()}
        </>
      )}

      {/* Legend — status is communicated by label + tone, not color alone */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Status legend</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {Object.entries(appointmentStatusConfig).map(([key, config]) => (
              <div key={key} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded border ${config.bgColor}`} />
                <span>{config.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Accessibility: live region announcing loaded count */}
      <p className="sr-only" role="status" aria-live="polite">
        {`${appointments.length} appointments loaded`}
      </p>
    </div>
  )
}
