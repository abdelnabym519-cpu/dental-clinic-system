/**
 * Robot identity — the single source of truth for the user-facing Robot
 * surface (DenToRa's unified AI interaction layer).
 *
 * The canonical ARABIC greeting is a HARD PRODUCT REQUIREMENT: wording,
 * order, emoji, punctuation and identity statement must match exactly.
 * Never paraphrase it, never prepend anything before it. The English
 * greeting is an implementation equivalent (NOT a previously agreed
 * canonical phrase) used when a session explicitly operates in English.
 */

export const ROBOT_GREETING_AR =
  'أهلًا دكتور 👋 أنا الروبوت الذكي الخاص بالعيادة. تم تطويري بواسطة بشمهندس محمد. أنا جاهز. 🤖'

export const ROBOT_GREETING_EN =
  'Welcome, Doctor 👋 I am the clinic\'s smart robot, developed by Eng. Mohamed. I am ready. 🤖'

export type RobotLocale = 'ar-EG' | 'en-US'

/** The canonical opening greeting for the given session locale. */
export function robotGreeting(locale: RobotLocale): string {
  return locale === 'ar-EG' ? ROBOT_GREETING_AR : ROBOT_GREETING_EN
}
