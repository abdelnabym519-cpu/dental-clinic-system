import { test as base, expect, Page } from '@playwright/test'

// Test credentials — these MUST stay in sync with prisma/seed.ts.
// Every authenticated spec logs in through these fixtures, so a mismatch fails
// the entire suite at fixture setup rather than in any one test.
// (tests/unit/e2e-fixture-contract.test.ts pins this sync executably.)
// Synced to the seed: admin@dentora-dental.com / doctor@dentora-dental.com /
// reception@dentora-dental.com — the seeded emails use the dentora-dental.com
// domain (the old demo-dental.com addresses match no seeded user, so every
// login failed with invalid credentials).
const TEST_ADMIN = {
  email: 'admin@dentora-dental.com',
  password: 'Admin@123',
}

const TEST_DOCTOR = {
  email: 'doctor@dentora-dental.com',
  password: 'Doctor@123',
}

const TEST_RECEPTIONIST = {
  email: 'reception@dentora-dental.com',
  password: 'Reception@123',
}

/**
 * Login helper — fills the login form and submits, then proves the REAL
 * authentication contract instead of racing client-side redirect timing.
 *
 * Why not waitForURL(/dashboard/): the login page performs signIn() with
 * redirect:false and pushes /dashboard from a fetch callback — engine- and
 * timing-dependent (observed: waitForURL timeouts on firefox/webkit/edge
 * while chromium passed). The actual contract has two engine-independent
 * parts, and BOTH are asserted here:
 *
 *   1. the credentials callback responded OK and the server ISSUED a
 *      session cookie (real server-side authentication — no fake cookies);
 *   2. the middleware — the enforcement point — ACCEPTS that session on a
 *      protected route (a rejected session 307s to /login?callbackUrl=…,
 *      which fails the URL assertion with a clear diff).
 */
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  // Structural locators on purpose: the form's ids and its single submit
  // button are locale-independent. Label-text selectors (getByLabel(/email/i))
  // break on the Arabic-first default rendering (البريد الإلكتروني).
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)

  const credentialsCallback = page.waitForResponse(
    (r) => r.url().includes('/api/auth/callback/credentials') && r.request().method() === 'POST',
    { timeout: 20000 }
  )
  await page.locator('form button[type="submit"]').click()
  const res = await credentialsCallback
  // 200 = redirect:false JSON answer; 302 = redirect-mode answer — both are
  // success transports. Anything else is a real authentication failure.
  if (!res.ok() && res.status() !== 302) {
    // Diagnostic, not a weakening: fail with the actual transaction result.
    throw new Error(
      `Sign-in failed: POST /api/auth/callback/credentials -> ${res.status()}. ` +
        'Verify the seeded users exist in the database (prisma/seed.ts) and ' +
        'that the auth secret is provisioned (npm run setup:dev).'
    )
  }

  // Contract 1: a SERVER-side session exists. The session cookie is issued
  // HttpOnly (@auth/core cookie.ts: sessionToken httpOnly: true) — it is
  // INVISIBLE to document.cookie by design, so the proof must come from the
  // server: GET /api/auth/session through the context's request client
  // (shares the browser cookie jar) must answer with a session containing a
  // user. This proves Credentials -> Session Creation -> Server Session —
  // the real contract, engine-independently.
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/auth/session')
        const session = (await res.json()) as { user?: unknown } | null
        return Boolean(session && session.user)
      },
      { timeout: 15000, message: 'server-side session was never established after the credentials callback' }
    )
    .toBe(true)

  // Contract 2: the middleware accepts the session on a protected route.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)
}

/**
 * Extended test fixture that provides pre-authenticated pages
 */
export const test = base.extend<{
  adminPage: Page
  doctorPage: Page
  receptionistPage: Page
}>({
  adminPage: async ({ page }, use) => {
    await login(page, TEST_ADMIN.email, TEST_ADMIN.password)
    await use(page)
  },
  doctorPage: async ({ page }, use) => {
    await login(page, TEST_DOCTOR.email, TEST_DOCTOR.password)
    await use(page)
  },
  receptionistPage: async ({ page }, use) => {
    await login(page, TEST_RECEPTIONIST.email, TEST_RECEPTIONIST.password)
    await use(page)
  },
})

export { expect, login, TEST_ADMIN, TEST_DOCTOR, TEST_RECEPTIONIST }
