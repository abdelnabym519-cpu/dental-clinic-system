/**
 * Tests the network layer of scripts/verify-phase9.ts (the acceptance script
 * that runs on a developer machine) against a mock server that mimics the
 * next-auth + Phase 9 API contracts:
 *   - /api/auth/csrf, /api/auth/callback/credentials (307 + session cookie)
 *   - /super-admin, /dashboard (session + subscription-status redirects)
 *   - /api/super-admin/hospitals, PATCH .../subscription
 *   - /api/cron/subscription-check (Bearer auth)
 *
 * The mock implements exactly the statuses/headers/JSON shapes the real app
 * produces (verified against the route code), so the script's cookie jar,
 * redirect capture and check sequence are proven end to end without a DB.
 *
 * Note: tests/setup.ts stubs the global fetch, so these tests inject a real
 * node:http-backed FetchImpl into the Client instead of relying on it.
 */
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, login, type FetchImpl } from '../../scripts/verify-phase9'

const SUPERADMIN_EMAIL = 'superadmin@dentora.com'
const SUPERADMIN_PASSWORD = 'SuperAdmin@123'
const ADMIN_EMAIL = 'admin@dentora-dental.com'
const ADMIN_PASSWORD = 'Admin@123'
const CRON_SECRET = 'test-cron-secret'

/** Minimal real HTTP fetch (node:http) satisfying the script's FetchImpl. */
const httpFetch: FetchImpl = (url, init) => {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const data = init?.body ?? null
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: `${u.pathname}${u.search}`,
        method: init?.method ?? 'GET',
        headers: {
          ...(init?.headers ?? {}),
          ...(data !== null ? { 'content-length': String(Buffer.byteLength(data)) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const raw = res.headers
          const flat: Record<string, string> = {}
          for (const [k, v] of Object.entries(raw)) {
            if (v !== undefined) flat[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
          }
          const setCookie: string[] = raw['set-cookie'] ?? []
          resolve({
            status: res.statusCode ?? 0,
            headers: {
              get: (name: string) => flat[name.toLowerCase()] ?? null,
              getSetCookie: () => setCookie,
            },
            text: async () => text,
          })
        })
      }
    )
    req.on('error', reject)
    if (data !== null) req.write(data)
    req.end()
  })
}

let server: http.Server
let base: string
let suspended: boolean

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}

function sessionRole(req: http.IncomingMessage): string | null {
  const m = (req.headers.cookie ?? '').match(/session-token=(sess-\w+)/)
  return m ? m[1] : null
}

beforeAll(async () => {
  suspended = false
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://test')
    const p = url.pathname
    const role = sessionRole(req)
    const json = (obj: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    const redirect = (to: string, cookie?: string) => {
      const headers: Record<string, string> = { location: to }
      if (cookie) headers['set-cookie'] = cookie
      res.writeHead(307, headers)
      res.end()
    }

    if (p === '/api/auth/csrf') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'csrf-token=tok123; Path=/; HttpOnly',
      })
      res.end(JSON.stringify({ csrfToken: 'tok123' }))
      return
    }

    if (p === '/api/auth/callback/credentials' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req))
      const okCsrf =
        (req.headers.cookie ?? '').includes('csrf-token=tok123') &&
        form.get('csrfToken') === 'tok123'
      const cred =
        (form.get('email') === SUPERADMIN_EMAIL && form.get('password') === SUPERADMIN_PASSWORD) ||
        (form.get('email') === ADMIN_EMAIL && form.get('password') === ADMIN_PASSWORD)
      if (!okCsrf || !cred) {
        redirect(`${form.get('callbackUrl') ?? '/'}?error=CredentialsSignin`)
        return
      }
      const who = form.get('email') === SUPERADMIN_EMAIL ? 'super' : 'admin'
      redirect(form.get('callbackUrl') ?? '/', `session-token=sess-${who}; Path=/; HttpOnly`)
      return
    }

    if (p === '/super-admin') {
      if (role !== 'sess-super') return redirect('/login')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><title>Super Admin</title><h1>Subscription overview</h1></html>')
      return
    }

    if (p === '/dashboard') {
      if (role !== 'sess-admin') return redirect('/login')
      if (suspended) return redirect('/subscription-expired')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><h1>Dashboard</h1></html>')
      return
    }

    if (p === '/subscription-expired') {
      if (role !== 'sess-admin') return redirect('/login')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(
        '<html><h1>Subscription expired</h1><p>Logged in as admin@dentora-dental.com</p></html>'
      )
      return
    }

    if (p === '/api/super-admin/hospitals' && req.method === 'GET') {
      if (role !== 'sess-super') return json({ error: 'Forbidden' }, 403)
      return json([
        {
          id: 'h1',
          name: 'Demo Clinic',
          subscription: {
            id: 's1',
            plan: 'PROFESSIONAL',
            status: suspended ? 'SUSPENDED' : 'ACTIVE',
            currentPeriodStart: '2026-09-01T00:00:00.000Z',
            currentPeriodEnd: '2026-10-01T00:00:00.000Z',
            gracePeriodDays: 7,
            autoRenew: false,
            notes: null,
          },
          _count: { users: 1, patients: 3 },
        },
      ])
    }

    if (p === '/api/super-admin/hospitals/h1/subscription' && req.method === 'PATCH') {
      if (role !== 'sess-super') return json({ error: 'Forbidden' }, 403)
      const body = JSON.parse(await readBody(req)) as { status: string }
      suspended = body.status === 'SUSPENDED'
      return json({ id: 's1', status: body.status })
    }

    if (p === '/api/cron/subscription-check' && req.method === 'GET') {
      const auth = req.headers.authorization ?? ''
      if (auth !== `Bearer ${CRON_SECRET}`) return json({ error: 'Unauthorized' }, 401)
      return json({ success: true, timestamp: new Date().toISOString(), results: [] })
    }

    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no port')
  base = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('verify-phase9.ts network layer', () => {
  it('login: correct credentials land on the callback URL with a working session', async () => {
    const client = new Client(httpFetch)
    const res = await login(client, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, '/super-admin', base)
    expect(res.location).toBe('/super-admin')
    const page = await client.get(`${base}/super-admin`)
    expect(page.status).toBe(200)
    expect(page.body).toContain('Subscription overview')
  })

  it('login: wrong password is redirected to the callback URL with ?error=CredentialsSignin', async () => {
    const client = new Client(httpFetch)
    const res = await login(client, ADMIN_EMAIL, 'wrong-password', '/dashboard', base)
    expect(res.location).toBe('/dashboard?error=CredentialsSignin')
    const page = await client.get(`${base}/dashboard`)
    expect(page.location).toBe('/login') // session was never established
  })

  it('check C sequence: SUSPEND redirects /dashboard to /subscription-expired; restore brings it back', async () => {
    const superAdmin = new Client(httpFetch)
    const admin = new Client(httpFetch)
    expect(
      (await login(superAdmin, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, '/super-admin', base))
        .location
    ).toBe('/super-admin')
    expect((await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD, '/dashboard', base)).location).toBe(
      '/dashboard'
    )

    const normal = await admin.get(`${base}/dashboard`)
    expect(normal.status).toBe(200)
    expect(normal.body).toContain('Dashboard')

    const hospitals = await superAdmin.get(`${base}/api/super-admin/hospitals`)
    expect(hospitals.status).toBe(200)
    const list = JSON.parse(hospitals.body) as Array<{
      id: string
      subscription: { status: string } | null
    }>
    const demo = list.find((h) => h.subscription !== null)
    expect(demo).toBeDefined()

    const suspend = await superAdmin.patchJson(
      `${base}/api/super-admin/hospitals/${demo!.id}/subscription`,
      {
        status: 'SUSPENDED',
      }
    )
    expect(suspend.status).toBe(200)
    expect((JSON.parse(suspend.body) as { status: string }).status).toBe('SUSPENDED')

    const blocked = await admin.get(`${base}/dashboard`)
    expect(blocked.status).toBe(307)
    expect(blocked.location).toBe('/subscription-expired')

    const expiredPage = await admin.get(`${base}/subscription-expired`)
    expect(expiredPage.status).toBe(200)
    expect(expiredPage.body).toContain('Subscription expired')

    const restore = await superAdmin.patchJson(
      `${base}/api/super-admin/hospitals/${demo!.id}/subscription`,
      {
        status: 'ACTIVE',
      }
    )
    expect(restore.status).toBe(200)
    const back = await admin.get(`${base}/dashboard`)
    expect(back.status).toBe(200)
  })

  it('check D: cron endpoint is 401 without Bearer and 200 {success:true} with it', async () => {
    const client = new Client(httpFetch)
    const anon = await client.get(`${base}/api/cron/subscription-check`)
    expect(anon.status).toBe(401)
    const authed = await client.request('GET', `${base}/api/cron/subscription-check`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
    expect(authed.status).toBe(200)
    expect(JSON.parse(authed.body) as { success: boolean }).toEqual(
      expect.objectContaining({ success: true })
    )
  })
})
