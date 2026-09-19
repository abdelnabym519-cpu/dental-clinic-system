'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { CalendarDays, List, Plus, Clock, Loader2 } from 'lucide-react'
import { CalendarView, type AgendaProvider } from '@/components/appointments/calendar-view'
import { AppointmentDialog } from '@/components/agenda/appointment-dialog'

interface AgendaWorkspaceProps {
  /** Whether the signed-in role may mutate the schedule (server enforces authoritatively). */
  canSchedule: boolean
}

interface PatientOption {
  id: string
  patientId: string
  firstName: string
  lastName: string
}

/**
 * Agenda — the clinic's primary scheduling workspace.
 *
 * Day / week / month calendar over the real Appointment records
 * (tenant-scoped server-side), with create, edit/reschedule and cancellation.
 * Existing appointment screens (list, detail, waitlist, queue) stay reachable
 * from here; this page does not duplicate them.
 */
export function AgendaWorkspace({ canSchedule }: AgendaWorkspaceProps) {
  const [providers, setProviders] = useState<AgendaProvider[]>([])
  const [patients, setPatients] = useState<PatientOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [doctorsRes, patientsRes] = await Promise.all([
          fetch('/api/staff/doctors'),
          fetch('/api/patients?all=true'),
        ])
        if (cancelled) return
        if (doctorsRes.ok) {
          const data = await doctorsRes.json()
          const list = Array.isArray(data) ? data : data.doctors ?? []
          setProviders(list)
        }
        if (patientsRes.ok) {
          const data = await patientsRes.json()
          const list: PatientOption[] = Array.isArray(data) ? data : data.patients ?? []
          setPatients(list)
        }
      } catch {
        // Options load is progressive: the calendar still works without them,
        // and the dialog shows its own error if the lists are unavailable.
      } finally {
        if (!cancelled) setLoadingOptions(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSaved = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agenda</h1>
          <p className="text-muted-foreground">
            The clinic schedule — view, book, reschedule and manage appointments
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSchedule && (
            <Button
              onClick={() => setDialogOpen(true)}
              disabled={loadingOptions && !patients.length}
            >
              {loadingOptions && !patients.length ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              New appointment
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href="/appointments/waitlist">
              <Clock className="h-4 w-4 mr-2" /> Waitlist
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/appointments">
              <List className="h-4 w-4 mr-2" /> Full list
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/appointments/queue">
              <CalendarDays className="h-4 w-4 mr-2" /> Today&apos;s queue
            </Link>
          </Button>
        </div>
      </div>

      {/* Schedule workspace */}
      <CalendarView providers={providers} refreshKey={refreshKey} canSchedule={canSchedule} />

      {canSchedule && (
        <AppointmentDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
          patients={patients}
          doctors={providers}
        />
      )}
    </div>
  )
}
