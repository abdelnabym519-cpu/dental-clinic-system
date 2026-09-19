import { auth } from '@/lib/auth'
import { AgendaWorkspace } from '@/components/agenda/agenda-workspace'
import { canScheduleRole } from '@/lib/agenda-utils'

/**
 * Agenda — the clinic's primary scheduling workspace.
 *
 * Server wrapper: resolves the session role and derives scheduling rights
 * (same role set the appointment API enforces server-side) so the workspace
 * renders the correct capabilities. Viewing the schedule stays available to
 * every authenticated role.
 */
export default async function AgendaPage() {
  const session = await auth()
  const canSchedule = canScheduleRole(session?.user?.role)

  return <AgendaWorkspace canSchedule={canSchedule} />
}
