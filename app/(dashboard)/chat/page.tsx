import { redirect } from 'next/navigation'

/**
 * The independent AI Chat surface was removed — Robot (/ai-companion) is the
 * unified AI interaction surface of DenToRa. This route only preserves old
 * deep links; there is no chat UI here anymore.
 */
export default function ChatPage() {
  redirect('/ai-companion')
}
