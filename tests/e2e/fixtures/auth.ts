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
 * Login helper — fills the login form and submits
 */
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  // Structural locators on purpose: the form's ids and its single submit
  // button are locale-independent. Label-text selectors (getByLabel(/email/i))
  // break on the Arabic-first default rendering (البريد الإلكتروني) whenever
  // the locale cookie is absent — the exact failure that stalled every
  // fixture-dependent suite at beforeEach for 45s each.
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('form button[type="submit"]').click()
  // Wait for navigation away from login page
  await page.waitForURL(/.*(?:dashboard|onboarding)/, { timeout: 15000 })
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
