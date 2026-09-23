/**
 * Phase 9 (Licensing) end-to-end acceptance — runs on a developer machine.
 *
 *   npx tsx scripts/verify-phase9.ts
 *
 * What it does, in order:
 *   1. Ensures .env exists (created from .env.example if missing) with a
 *      working DATABASE_URL (docker-compose.dev.yml defaults) and the three
 *      required secrets (NEXTAUTH_SECRET, ENCRYPTION_KEY, CRON_SECRET).
 *      Existing non-empty values are never overwritten.
 *   2. Starts the dev backing services (mysql + redis) via
 *      docker-compose.dev.yml and waits for both to be healthy.
 *   3. Runs `prisma migrate deploy` and `prisma db seed`.
 *   4. Starts the dev server (next dev, port 3000) and waits for it.
 *   5. Runs the four acceptance checks over real HTTP with real sessions:
 *        A. superadmin@dentora.com logs in and can open /super-admin
 *        B. admin@dentora-dental.com logs in and gets a normal /dashboard
 *        C. SUSPENDED via the super-admin API -> the clinic admin's
 *           /dashboard request is redirected to /subscription-expired, the
 *           page renders, and restoring the previous status brings the
 *           dashboard back
 *        D. /api/cron/subscription-check rejects an unauthenticated call
 *           (401) and succeeds with Bearer CRON_SECRET
 *   6. Prints a PASS/FAIL table. Exit code: 0 = all pass, 1 = a check
 *      failed, 2 = setup failed. The dev server is always stopped again;
 *      the docker services are left running.
 *
 * Idempotent: if a previous partial run left the demo subscription
 * suspended/expired, it is restored to ACTIVE before the checks.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, copyFileSync, createWriteStream } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 3000
const BASE = `http://127.0.0.1:${PORT}`
const COMPOSE = path.join(ROOT, 'docker-compose.dev.yml')
const ENV_PATH = path.join(ROOT, '.env')
const ENV_EXAMPLE = path.join(ROOT, '.env.example')

const SUPERADMIN_EMAIL = 'superadmin@dentora.com'
const SUPERADMIN_PASSWORD = 'SuperAdmin@123'
const ADMIN_EMAIL = 'admin@dentora-dental.com'
const ADMIN_PASSWORD = 'Admin@123'

let failures = 0
const results: Array<{ name: string; pass: boolean; detail: string }> = []

function log(msg: string): void {
  console.log(msg)
}

function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail })
  log(`${pass ? '[PASS] ' : '[FAIL] '}${name} — ${detail}`)
  if (!pass) failures++
}

function setupFailed(msg: string): never {
  log(`[SETUP-FAILURE] ${msg}`)
  process.exit(2)
}

// ── tiny cookie-jar HTTP client (Node 18+ global fetch by default; a
//    compatible implementation can be injected — the test suite stubs the
//    global fetch, so it injects a node:http-backed one) ──────────────────
export type FetchImpl = (
  url: string,
  init?: {
    method?: string
    redirect?: string
    body?: string
    headers?: Record<string, string>
    signal?: AbortSignal
  }
) => Promise<{
  status: number
  headers: { get(name: string): string | null; getSetCookie?(): string[] }
  text(): Promise<string>
}>

export class Client {
  private cookies = new Map<string, string>()
  private fetchImpl: FetchImpl

  constructor(fetchImpl?: FetchImpl) {
    this.fetchImpl = fetchImpl ?? (fetch as unknown as FetchImpl)
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  private storeCookies(headers: {
    get(name: string): string | null
    getSetCookie?(): string[]
  }): void {
    const setCookie =
      headers.getSetCookie?.() ?? (headers.get('set-cookie') ? [headers.get('set-cookie')!] : [])
    for (const c of setCookie) {
      const pair = c.split(';')[0]
      const eq = pair.indexOf('=')
      if (eq > 0) this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1))
    }
  }

  async request(
    method: string,
    url: string,
    opts: { body?: string; headers?: Record<string, string> } = {}
  ): Promise<{
    status: number
    location: string | null
    body: string
    headers: { get(name: string): string | null; getSetCookie?(): string[] }
  }> {
    const res = await this.fetchImpl(url, {
      method,
      redirect: 'manual',
      body: opts.body,
      headers: {
        ...(opts.headers ?? {}),
        ...(this.cookieHeader() ? { cookie: this.cookieHeader() } : {}),
      },
    })
    this.storeCookies(res.headers)
    const body = await res.text()
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    return { status: res.status, location, body, headers: res.headers }
  }

  async get(url: string): Promise<{ status: number; location: string | null; body: string }> {
    return this.request('GET', url)
  }

  async postForm(
    url: string,
    form: Record<string, string>
  ): Promise<{ status: number; location: string | null }> {
    const body = new URLSearchParams(form).toString()
    return this.request('POST', url, {
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
  }

  async postJson(url: string, json: unknown): Promise<{ status: number; body: string }> {
    return this.request('POST', url, {
      body: JSON.stringify(json),
      headers: { 'content-type': 'application/json' },
    })
  }

  async patchJson(url: string, json: unknown): Promise<{ status: number; body: string }> {
    return this.request('PATCH', url, {
      body: JSON.stringify(json),
      headers: { 'content-type': 'application/json' },
    })
  }
}

export async function login(
  client: Client,
  email: string,
  password: string,
  callbackUrl: string,
  base: string = BASE
) {
  const csrfRes = await client.get(`${base}/api/auth/csrf`)
  if (csrfRes.status !== 200) throw new Error(`csrf fetch returned ${csrfRes.status}`)
  const csrf = (JSON.parse(csrfRes.body) as { csrfToken: string }).csrfToken
  const res = await client.postForm(`${base}/api/auth/callback/credentials`, {
    csrfToken: csrf,
    email,
    password,
    callbackUrl,
  })
  return res
}

// ── step 0: .env ──────────────────────────────────────────────────────────
function ensureEnv(): void {
  log('── Step 0/6: .env ──')
  if (!existsSync(ENV_EXAMPLE)) setupFailed('.env.example not found')

  if (!existsSync(ENV_PATH)) {
    copyFileSync(ENV_EXAMPLE, ENV_PATH)
    log('  .env not found — created from .env.example')
  } else {
    log('  .env exists — keeping your values, only filling empty required ones')
  }

  let content = readFileSync(ENV_PATH, 'utf8')
  const setVar = (key: string, value: string): boolean => {
    const re = new RegExp(`^${key}=(.*)$`, 'm')
    const m = content.match(re)
    if (m && m[1].replace(/"/g, '').trim() !== '') return false // keep existing
    if (m) content = content.replace(re, `${key}="${value}"`)
    else content = `${content.trimEnd()}\n${key}="${value}"\n`
    return true
  }

  const changed: string[] = []
  const dbUrl = 'mysql://root:dental@localhost:3306/dental_erp' // docker-compose.dev.yml defaults
  const exampleDb = 'mysql://root:password@localhost:3306/dental_erp'
  const mDb = content.match(/^DATABASE_URL=(.*)$/m)
  const dbVal = (mDb?.[1] ?? '').replace(/"/g, '').trim()
  if (dbVal === '' || dbVal === exampleDb) {
    const re = /^DATABASE_URL=(.*)$/m
    if (mDb) content = content.replace(re, `DATABASE_URL="${dbUrl}"`)
    else content += `\nDATABASE_URL="${dbUrl}"\n`
    changed.push('DATABASE_URL')
  }
  if (setVar('NEXTAUTH_SECRET', crypto.randomBytes(32).toString('base64')))
    changed.push('NEXTAUTH_SECRET')
  if (setVar('ENCRYPTION_KEY', crypto.randomBytes(32).toString('hex')))
    changed.push('ENCRYPTION_KEY')
  if (setVar('CRON_SECRET', crypto.randomBytes(16).toString('hex'))) changed.push('CRON_SECRET')
  if (changed.length) {
    writeFileSync(ENV_PATH, content, 'utf8')
    log(`  wrote: ${changed.join(', ')}`)
  } else {
    log('  nothing to change')
  }

  const cron = content
    .match(/^CRON_SECRET=(.*)$/m)?.[1]
    ?.replace(/"/g, '')
    .trim()
  if (!cron) setupFailed('CRON_SECRET could not be resolved')
  process.env.CRON_SECRET = cron
  process.env.DATABASE_URL = dbVal || 'mysql://root:dental@localhost:3306/dental_erp'
}

// ── docker helpers ────────────────────────────────────────────────────────
function composeCmd(): string[] {
  try {
    execSync('docker compose version', { stdio: 'pipe' })
    return ['docker', 'compose']
  } catch {
    try {
      execSync('docker-compose version', { stdio: 'pipe' })
      return ['docker-compose']
    } catch {
      setupFailed('docker (with compose v2) or docker-compose is required')
    }
  }
  return []
}

function run(cmd: string[], cwd: string = ROOT, inherit = true): string {
  log(`  $ ${cmd.join(' ')}`)
  const out = execSync(cmd.join(' '), {
    cwd,
    stdio: inherit ? 'inherit' : 'pipe',
    timeout: 900_000,
  })
  return out.toString()
}

function waitFor(cond: () => boolean, what: string, timeoutMs: number): void {
  const sleep = process.platform === 'win32' ? 'timeout /t 2 /nobreak > nul' : 'sleep 2'
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (cond()) {
      log(`  ${what}: ready`)
      return
    }
    process.stdout.write('.')
    execSync(sleep, { stdio: 'ignore' })
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function main(): Promise<void> {
  log('DenToRa Phase 9 (Licensing) acceptance\n')

  ensureEnv()

  // ── Step 1: backing services ──
  log('── Step 1/6: backing services (mysql + redis) ──')
  const compose = composeCmd()
  run([...compose, '-f', COMPOSE, 'up', '-d', 'mysql', 'redis'])

  const mysqlUp = () => {
    try {
      execSync(
        `${compose[0]} ${compose[1] ?? ''} -f ${COMPOSE} exec -T mysql mysqladmin ping -h 127.0.0.1 -u root -pdental --silent`.trim(),
        { stdio: 'pipe', timeout: 10_000 }
      )
      return true
    } catch {
      return false
    }
  }
  const redisUp = () => {
    try {
      const out = execSync(
        `${compose[0]} ${compose[1] ?? ''} -f ${COMPOSE} exec -T redis redis-cli ping`.trim(),
        { stdio: 'pipe', timeout: 10_000 }
      ).toString()
      return out.includes('PONG')
    } catch {
      return false
    }
  }
  try {
    waitFor(mysqlUp, 'mysql', 180_000)
    waitFor(redisUp, 'redis', 60_000)
  } catch (e) {
    setupFailed((e as Error).message)
  }

  // ── Step 2: schema + seed ──
  log('── Step 2/6: prisma migrate deploy + db seed ──')
  try {
    run(['npx', 'prisma', 'migrate', 'deploy'])
    run(['npx', 'prisma', 'db', 'seed'])
  } catch {
    setupFailed('prisma migrate deploy or db seed failed (see output above)')
  }

  // ── Step 3: dev server ──
  log('── Step 3/6: dev server ──')
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
  if (!existsSync(nextBin)) setupFailed('node_modules missing — run `npm install` first')
  const devLogPath = path.join(ROOT, '.phase9-dev-server.log')
  const devLog = createWriteStream(devLogPath, { flags: 'w' })
  let server: ChildProcess
  try {
    server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
  } catch (e) {
    setupFailed(`could not start the dev server: ${(e as Error).message}`)
  }
  server.stdout?.on('data', (d: Buffer) => devLog.write(d))
  server.stderr?.on('data', (d: Buffer) => devLog.write(d))
  log(`  starting next dev (log: ${devLogPath})`)

  let serverReady = false
  try {
    serverReady = await new Promise<boolean>((resolve) => {
      const start = Date.now()
      const tick = async () => {
        if (Date.now() - start > 300_000) return resolve(false)
        try {
          const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(60_000) })
          if (res.status === 200) return resolve(true)
        } catch {
          // not up yet
        }
        setTimeout(tick, 4000)
      }
      void tick()
    })
  } catch {
    // fall through
  }
  if (!serverReady) {
    killServer(server)
    setupFailed(`dev server did not become ready on port ${PORT} within 300s (see ${devLogPath})`)
  }
  log('  dev server ready')

  try {
    // ── Step 4: check A — super-admin login -> /super-admin ──
    log('── Step 4/6: checks ──')
    const superAdmin = new Client()
    const a = await login(superAdmin, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, '/super-admin')
    const aPage =
      a.status >= 300 && a.status < 400 && a.location === '/super-admin'
        ? await superAdmin.get(`${BASE}/super-admin`)
        : { status: 0, body: `login redirected to ${a.location} (expected /super-admin)` }
    record(
      'A: superadmin login reaches /super-admin',
      aPage.status === 200 && aPage.body.includes('Subscription overview'),
      aPage.status === 200 && aPage.body.includes('Subscription overview')
        ? 'logged in, panel rendered'
        : `status=${aPage.status}, redirect=${a.location}`
    )

    // ── find the demo hospital (the seeded clinic owns a subscription) ──
    const hospitalsRes = await superAdmin.get(`${BASE}/api/super-admin/hospitals`)
    const hospitals =
      hospitalsRes.status === 200
        ? (JSON.parse(hospitalsRes.body) as Array<{
            id: string
            name: string
            subscription: { status: string } | null
          }>)
        : []
    const demo = hospitals.find((h) => h.subscription !== null)
    if (!demo) {
      record(
        'B: clinic admin gets a normal /dashboard',
        false,
        'no hospital with a subscription found in /api/super-admin/hospitals'
      )
      record(
        'C: SUSPEND redirects clinic admin to /subscription-expired',
        false,
        'no demo hospital to suspend'
      )
    } else {
      const prevStatus = demo.subscription!.status

      // self-heal from a previous partial run
      if (prevStatus !== 'ACTIVE' && prevStatus !== 'TRIAL') {
        log(`  note: demo subscription was ${prevStatus} — restoring to ACTIVE first`)
        await superAdmin.patchJson(`${BASE}/api/super-admin/hospitals/${demo.id}/subscription`, {
          status: 'ACTIVE',
        })
      }

      // ── Step 5: check B — clinic admin normal dashboard ──
      const admin = new Client()
      const b = await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD, '/dashboard')
      const bPage =
        b.status >= 300 && b.status < 400 && b.location === '/dashboard'
          ? await admin.get(`${BASE}/dashboard`)
          : { status: 0, body: `login redirected to ${b.location} (expected /dashboard)` }
      record(
        'B: clinic admin gets a normal /dashboard',
        bPage.status === 200 && bPage.body.includes('Dashboard'),
        bPage.status === 200 && bPage.body.includes('Dashboard')
          ? 'dashboard rendered'
          : `status=${bPage.status}, redirect=${b.location}`
      )

      // ── Step 6: check C — SUSPEND -> /subscription-expired ──
      const suspend = await superAdmin.patchJson(
        `${BASE}/api/super-admin/hospitals/${demo.id}/subscription`,
        {
          status: 'SUSPENDED',
        }
      )
      const suspendedOk =
        suspend.status === 200 &&
        (JSON.parse(suspend.body) as { status: string }).status === 'SUSPENDED'
      const cBlocked = await admin.get(`${BASE}/dashboard`)
      const cPage =
        cBlocked.status >= 300 &&
        cBlocked.status < 400 &&
        cBlocked.location === '/subscription-expired'
          ? await admin.get(`${BASE}/subscription-expired`)
          : {
              status: 0,
              body: `dashboard returned status=${cBlocked.status}, location=${cBlocked.location}`,
            }
      record(
        'C: SUSPEND redirects clinic admin to /subscription-expired',
        suspendedOk &&
          cBlocked.location === '/subscription-expired' &&
          cPage.status === 200 &&
          cPage.body.includes('Subscription expired'),
        suspendedOk
          ? cBlocked.location === '/subscription-expired' && cPage.status === 200
            ? 'redirected, expired page rendered'
            : `redirect=${cBlocked.location}, pageStatus=${cPage.status}`
          : `PATCH status=${suspend.status}`
      )

      // restore previous status and verify the dashboard is back
      const restore = await superAdmin.patchJson(
        `${BASE}/api/super-admin/hospitals/${demo.id}/subscription`,
        {
          status: prevStatus === 'SUSPENDED' ? 'ACTIVE' : prevStatus,
        }
      )
      const cAfter = await admin.get(`${BASE}/dashboard`)
      record(
        'C2: restoring the subscription brings /dashboard back',
        restore.status === 200 && cAfter.status === 200,
        `status restored to ${prevStatus === 'SUSPENDED' ? 'ACTIVE' : prevStatus}; dashboard status=${cAfter.status}`
      )
    }

    // ── check D — cron endpoint auth ──
    const cronClient = new Client()
    const anonCron = await cronClient.get(`${BASE}/api/cron/subscription-check`)
    const authedCron = await cronClient.request('GET', `${BASE}/api/cron/subscription-check`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
    let dBody = { success: false }
    if (authedCron.status === 200) {
      try {
        dBody = JSON.parse(authedCron.body) as { success: boolean }
      } catch {
        dBody = { success: false }
      }
    }
    record(
      'D: /api/cron/subscription-check requires Bearer CRON_SECRET',
      anonCron.status === 401 && authedCron.status === 200 && dBody.success === true,
      `anon=${anonCron.status} (want 401), authed=${authedCron.status} (want 200), success=${dBody.success}`
    )
  } finally {
    killServer(server)
  }

  // ── report ──
  log('\n════════════ ACCEPTANCE SUMMARY ════════════')
  for (const r of results) log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  const passed = results.filter((r) => r.pass).length
  log(`─────────────────────────────────────────────`)
  log(`${passed}/${results.length} checks passed`)
  log('docker services (mysql, redis) are still running. Stop them with:')
  log(`  ${compose.join(' ')} -f ${path.basename(COMPOSE)} stop`)
  process.exitCode = failures === 0 ? 0 : 1
}

function killServer(server: ChildProcess): void {
  try {
    if (server.exitCode === null && !server.killed) {
      if (process.platform === 'win32') {
        try {
          execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
        } catch {
          server.kill('SIGTERM')
        }
      } else {
        process.kill(-server.pid!, 'SIGTERM')
      }
    }
  } catch {
    // already gone
  }
  log('  dev server stopped')
}

// Auto-runs only when executed directly (`npx tsx scripts/verify-phase9.ts`).
// Vitest sets VITEST=true, so tests can import Client/login without side effects.
if (!process.env.VITEST) {
  main().catch((e) => {
    console.error('unhandled error:', e)
    process.exit(2)
  })
}
