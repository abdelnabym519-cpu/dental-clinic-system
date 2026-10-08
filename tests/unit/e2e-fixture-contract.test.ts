/**
 * Executable contract between the Playwright harness and the application.
 *
 * The E2E suite once failed 1917 specs at fixture setup with three stacked,
 * independent root causes; none of them were visible without a browser run:
 *
 *   RC1 — locale: the app is Arabic-first (defaultLocale ar-EG); the harness
 *         asserted English label text (getByLabel(/email/i) etc.), which can
 *         never match Arabic SSR output. Fix: the suite pins the app's OWN
 *         locale cookie (dentora-locale=en-EG, what LanguageToggle writes) as
 *         the default storageState, and the login fixture uses structural
 *         selectors (#email/#password/submit button).
 *   RC2 — credentials: the fixture logged in as *@demo-dental.com while
 *         prisma/seed.ts creates *@dentora-dental.com — every login failed.
 *   RC3 — secret: next-auth v5 reads only AUTH_SECRET while the documented
 *         contract provisions NEXTAUTH_SECRET — every signIn 500'd with
 *         MissingSecret. Fix: lib/auth.ts maps AUTH_SECRET ?? NEXTAUTH_SECRET.
 *
 * These tests pin all three seams so a regression fails HERE (fast, no
 * browser) instead of silently abandoning 1917 E2E specs. They read sources
 * as text — they never assert secret VALUES anywhere.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCALE_COOKIE, locales } from '../../lib/i18n/config'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

const FIXTURE = 'tests/e2e/fixtures/auth.ts'
const SEED = 'prisma/seed.ts'
const LOGIN_PAGE = 'app/(auth)/login/page.tsx'

const fixtureAccounts: Array<{ email: string; password: string }> = [
  { email: 'admin@dentora-dental.com', password: 'Admin@123' },
  { email: 'doctor@dentora-dental.com', password: 'Doctor@123' },
  { email: 'reception@dentora-dental.com', password: 'Reception@123' },
]

describe('RC2 — fixture credentials stay in sync with prisma/seed.ts', () => {
  it('every fixture account exists in the seed with the same email', () => {
    const seed = read(SEED)
    const fixture = read(FIXTURE)
    for (const account of fixtureAccounts) {
      expect(fixture).toContain(account.email)
      expect(seed).toContain(account.email)
    }
  })

  it('no stale demo-dental.com fixture ADDRESSES remain (comments may document the history)', () => {
    const seed = read(SEED)
    // the @-prefixed form = an actual address; prose in comments may mention
    // the old domain name without it being an account.
    expect(seed).not.toContain('@demo-dental.com')
    expect(read(FIXTURE)).not.toContain('@demo-dental.com')
  })

  it('every fixture password equals the seeded credential constant', () => {
    const seed = read(SEED)
    for (const account of fixtureAccounts) {
      expect(seed).toContain(`'${account.password}'`)
    }
  })
})

describe('RC1 — locale-robust harness (Arabic-first app)', () => {
  it('the login fixture uses structural, locale-independent selectors', () => {
    const fixture = read(FIXTURE)
    expect(fixture).toContain("page.locator('#email')")
    expect(fixture).toContain("page.locator('#password')")
    expect(fixture).toContain('form button[type="submit"]')
    // the defect class itself must not return to the login seam as a CALL
    // (comments may name it; `.getByLabel(` is the call-site signature)
    expect(fixture).not.toContain('.getByLabel(')
  })

  it('the login page actually renders those structural hooks', () => {
    const page = read(LOGIN_PAGE)
    expect(page).toContain('id="email"')
    expect(page).toContain('id="password"')
    expect(page).toContain('type="submit"')
    // and the labels are bound to the inputs (accessibility contract)
    expect(page).toContain('htmlFor="email"')
    expect(page).toContain('htmlFor="password"')
  })

  it('the default E2E storage state pins the app locale cookie to a supported locale', () => {
    const state = JSON.parse(read('tests/e2e/locale-state.json'))
    expect(state.cookies).toHaveLength(1)
    const cookie = state.cookies[0]
    expect(cookie.name).toBe(LOCALE_COOKIE)
    expect(locales as readonly string[]).toContain(cookie.value)
    expect(cookie.domain).toBe('localhost')
  })

  it('playwright.config actually loads the locale storage state', () => {
    const config = read('playwright.config.ts')
    expect(config).toContain('storageState')
    expect(config).toContain('tests/e2e/locale-state.json')
  })
})

describe('RC3 — NextAuth secret follows the documented env contract', () => {
  it('the shared authConfig maps AUTH_SECRET with a NEXTAUTH_SECRET fallback', () => {
    // Canonical location: lib/auth.config.ts — BOTH NextAuth instances inherit
    // it (lib/auth.ts spreads ...authConfig; proxy.ts/middleware.ts construct
    // NextAuth(authConfig) directly for the edge runtime).
    expect(read('lib/auth.config.ts')).toContain(
      'process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET'
    )
  })

  it('no NextAuth instance escapes the shared config (both use authConfig)', () => {
    expect(read('lib/auth.ts')).toContain('...authConfig')
    // middleware.ts is the edge instance (Next 16 surfaces it as "proxy" in
    // request logs); it must keep constructing from the shared config so the
    // secret mapping reaches the edge runtime.
    expect(read('middleware.ts')).toContain('NextAuth(authConfig)')
  })

  it('the documented setup provisions NEXTAUTH_SECRET (never a hardcoded value here)', () => {
    // .env.example must DOCUMENT the variable; no real secret value may exist
    // in the repository — presence/missing only, never values.
    expect(read('.env.example')).toMatch(/^NEXTAUTH_SECRET="/m)
    expect(read('scripts/lib/setup-dev.ts')).toContain('NEXTAUTH_SECRET')
  })
})

describe('E2E harness contracts — engine-independent authentication + navigation', () => {
  it('the login fixture proves the AUTH CONTRACT, not client-side redirect timing', () => {
    const fixture = read(FIXTURE)
    // the brittle pattern that timed out on firefox/webkit/edge is banned:
    expect(fixture).not.toContain('waitForURL(/.*(?:dashboard|onboarding)/')
    // contract 1: the credentials callback is observed + a session cookie is required
    expect(fixture).toContain('/api/auth/callback/credentials')
    expect(fixture).toContain('(?:authjs|next-auth)\\.session-token')
    // contract 2: the middleware (enforcement point) must accept the session
    expect(fixture).toContain("toHaveURL(/\\/dashboard/)")
  })

  it('the patient-nav fixture uses the Radix menu contract, not blind button indices', () => {
    const nav = read('tests/e2e/fixtures/patients.ts')
    // trigger = the Radix trigger button (cannot be shifted by other row buttons)
    expect(nav).toContain('button[aria-haspopup=')
    // the portal menu must be OPEN before the item click (WebKit mount race)
    expect(nav).toContain("getByRole('menu')")
    // destination predicate excludes /patients/new via a function on pathname
    expect(nav).toContain('/\\/patients\\/(?!new)[^/]+/')
  })

  it('production: the patient row menu trigger exposes an accessible name (a11y)', () => {
    const page = read('app/(dashboard)/patients/page.tsx')
    expect(page).toContain("aria-label={t('ui.actions')}")
  })
})

describe('product navigation contracts — no 404 menu targets', () => {
  it('the Medical History menu item deep-links to the existing overview tab section', () => {
    const list = read('app/(dashboard)/patients/page.tsx')
    // the old push target had no route (404):
    expect(list).not.toContain('/medical-history`')
    // it deep-links to the overview tab section instead:
    expect(list).toContain('tab=overview#medical-history')
    // and the anchor target exists in the patient file:
    const detail = read('app/(dashboard)/patients/[id]/page.tsx')
    expect(detail).toContain('id="medical-history"')
  })

  it('the E2E tooth selection centers before clicking (mobile hit-test contract)', () => {
    const spec = read('tests/e2e/dental-chart-3d.spec.ts')
    expect(spec).toContain("scrollIntoView({ block: 'center', inline: 'center' })")
    // the defect class — a bare edge-tooth click without centering — is gone:
    expect(spec).not.toContain("getByRole('button').first().click()")
  })
})
