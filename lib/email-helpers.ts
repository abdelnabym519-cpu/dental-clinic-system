/**
 * Email helper functions for system emails (invites, verification, etc.)
 * These wrap the email service with graceful failure — if SMTP is not
 * configured, the calling operation still succeeds.
 */

import { emailService } from '@/lib/services/email.service'

const APP_NAME = 'Dentora'

function baseUrl(): string {
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

function wrapHTML(content: string): string {
  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; background: #f4f4f5; }
    .wrapper { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .logo { font-size: 20px; font-weight: 700; color: #0284c7; margin-bottom: 24px; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    p { margin: 0 0 16px; color: #4a4a4a; font-size: 15px; }
    .btn { display: inline-block; padding: 12px 28px; background: #0284c7; color: #fff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; }
    .btn:hover { background: #0369a1; }
    .muted { font-size: 13px; color: #71717a; }
    .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #a1a1aa; }
    .divider { border: none; border-top: 1px solid #e4e4e7; margin: 24px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      ${content}
    </div>
    <div class="footer">
      <p dir="rtl">هذه رسالة آلية من ${APP_NAME}. يرجى عدم الرد عليها.</p>
    </div>
  </div>
</body>
</html>`.trim()
}

/**
 * Send a staff invitation email.
 * Non-blocking — logs errors but does not throw.
 */
export async function sendInviteEmail(params: {
  to: string
  inviteeName: string
  hospitalName: string
  role: string
  inviterName: string
  token: string
}): Promise<boolean> {
  const { to, inviteeName, hospitalName, role, inviterName, token } = params
  const link = `${baseUrl()}/invite/accept?token=${token}`
  // Issue 6 — canonical Arabic role names (same terms as role.DOCTOR etc.
  // in the i18n dictionary); the raw enum is data and never shown.
  const ROLE_AR: Record<string, string> = {
    ADMIN: 'مدير',
    DOCTOR: 'طبيب',
    RECEPTIONIST: 'موظف استقبال',
    ACCOUNTANT: 'محاسب',
    LAB_TECH: 'فني معمل',
    NURSE: 'ممرض',
  }
  const roleLabel = ROLE_AR[role] ?? role

  const html = wrapHTML(`
    <div class="logo">${APP_NAME}</div>
    <h1 dir="rtl">تمت دعوتك للانضمام إلى ${hospitalName}</h1>
    <p dir="rtl">مرحبًا ${inviteeName}،</p>
    <p dir="rtl">دعاك <strong>${inviterName}</strong> للانضمام إلى <strong>${hospitalName}</strong> بدور <strong>${roleLabel}</strong>.</p>
    <p dir="rtl">اضغط على الزر أدناه لقبول الدعوة وإنشاء حسابك:</p>
    <p style="text-align:center; margin: 28px 0;">
      <a href="${link}" class="btn">قبول الدعوة</a>
    </p>
    <hr class="divider">
    <p class="muted" dir="rtl">تنتهي صلاحية هذه الدعوة بعد 7 أيام. إذا لم تكن تتوقع هذه الرسالة يمكنك تجاهلها بأمان.</p>
    <p class="muted" dir="rtl">أو انسخ الرابط: ${link}</p>
  `)

  try {
    await emailService.sendEmail({
      to,
      subject: `دعوة للانضمام إلى ${hospitalName} على ${APP_NAME}`,
      body: html,
    })
    return true
  } catch (err) {
    console.error(`[email-helpers] Failed to send invite email to ${to}:`, err)
    return false
  }
}

/**
 * Send an email verification link after signup.
 * Non-blocking — logs errors but does not throw.
 */
export async function sendVerificationEmail(params: {
  to: string
  userName: string
  hospitalName: string
  token: string
}): Promise<boolean> {
  const { to, userName, hospitalName, token } = params
  const link = `${baseUrl()}/verify-email?token=${token}`

  const html = wrapHTML(`
    <div class="logo">${APP_NAME}</div>
    <h1 dir="rtl">تأكيد بريدك الإلكتروني</h1>
    <p dir="rtl">مرحبًا ${userName}،</p>
    <p dir="rtl">شكرًا لتسجيل <strong>${hospitalName}</strong> على ${APP_NAME}. يرجى تأكيد بريدك الإلكتروني لتفعيل حسابك:</p>
    <p style="text-align:center; margin: 28px 0;">
      <a href="${link}" class="btn">تأكيد البريد الإلكتروني</a>
    </p>
    <hr class="divider">
    <p class="muted" dir="rtl">تنتهي صلاحية هذا الرابط بعد 24 ساعة. إذا لم تنشئ هذا الحساب يمكنك تجاهل هذه الرسالة بأمان.</p>
    <p class="muted" dir="rtl">أو انسخ الرابط: ${link}</p>
  `)

  try {
    await emailService.sendEmail({
      to,
      subject: `تأكيد بريدك الإلكتروني — ${APP_NAME}`,
      body: html,
    })
    return true
  } catch (err) {
    console.error(`[email-helpers] Failed to send verification email to ${to}:`, err)
    return false
  }
}
