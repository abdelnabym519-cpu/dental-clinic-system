import { RobotPanel } from '@/components/robot/robot-panel'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'DenToRa Robot',
  description: 'Robot — the unified AI interaction surface of DenToRa (voice + text)',
}

/**
 * Robot — the unified AI interaction surface (Voice + Text).
 *
 * Auth is enforced by the (dashboard) layout (redirect on missing session;
 * subscription gate + tenant resolution happen there — the single Node
 * choke point). The Robot is PRESENTATION ONLY: all intelligence and every
 * action flow through the existing agent, its Phase 1 action pipeline, and
 * the role-separated approval ledger.
 */
export default function AiCompanionPage() {
  return (
    <div className="min-h-full bg-muted/20">
      <RobotPanel />
    </div>
  )
}
