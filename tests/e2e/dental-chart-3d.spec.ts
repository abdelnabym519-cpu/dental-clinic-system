import { test, expect } from './fixtures/auth'
import { openFirstPatientDetail, openPatientDetailByRow } from './fixtures/patients'

/**
 * E2E (Playwright — requires a running app + seeded DB; not part of the
 * vitest suite). Interactive 3D Dental Chart critical path.
 *
 * Harness contract (matches the repaired suite architecture):
 *  - authentication ALWAYS through the shared fixtures (doctorPage mutator,
 *    receptionistPage read-only) — this spec never bypasses auth;
 *  - the patient id comes from the REAL navigation path (patients list →
 *    detail), never a hard-coded id;
 *  - the 3D assertion is honest: a real WebGL canvas OR the explicit
 *    localized fallback testid — never a fake chart.
 *
 * Pointer-level picking inside the WebGL canvas is intentionally not driven
 * here (screen-coordinate clicks on a 3D scene are machine-dependent); the
 * 3D picking handlers share the same store the 2D view exercises below, and
 * R3F event wiring is verified on the real machine run.
 */
test.describe('Interactive Dental Chart (3D workspace)', () => {
  // Clinical-workstation context: the shared patients-list navigation helper
  // (fixtures/patients.ts) drives the desktop table layout, and the dental
  // chart is a clinician desktop workflow. All six ENGINE projects still run
  // (chromium/firefox/webkit/edge/mobile-chrome/mobile-safari) — only the
  // viewport is pinned so mobile-emulated engines exercise the same layout.
  test.use({ viewport: { width: 1366, height: 768 } })

  /**
   * Select the first 2D tooth the way a human does on any viewport.
   *
   * Why the explicit centering scroll: the odontogram board is a fixed-size
   * (~760px) grid inside `overflow-x-auto` — the correct responsive contract
   * (32 teeth must keep tappable sizes on phones). Playwright's MINIMAL
   * auto-scroll reveals only part of an edge tooth, so the click point can
   * hit-test through the transparent scroll containers to <main> ("main
   * intercepts pointer events" — observed on mobile projects). A human
   * centers the tooth in view before tapping; scrollIntoView with
   * block/inline center does exactly that across ALL ancestor scroll
   * containers, deterministically, engine-uniformly. No force, no
   * coordinates, no sleeps; the click itself is a genuine one.
   */
  async function selectFirstTooth(page: import('@playwright/test').Page) {
    const tooth = page.getByTestId('dental-chart-2d').getByRole('button').first()
    await tooth.scrollIntoViewIfNeeded()
    await tooth.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }))
    await tooth.click()
  }

  async function openFirstPatientChart(page: import('@playwright/test').Page) {
    await openFirstPatientDetail(page)
    const id = new URL(page.url()).pathname.split('/')[2]
    await page.goto(`/patients/${id}/dental-chart`)
    await expect(page.getByTestId('dental-chart-workspace')).toBeVisible()
    return id
  }

  test('doctor: 3D canvas loads, tooth selection drives the clinical panel, finding persists across reload', async ({
    doctorPage: page,
  }) => {
    await openFirstPatientChart(page)

    // Split view: real 3D canvas AND the 2D chart share one store.
    await page.getByRole('tab', { name: /3D|ثلاثي الأبعاد/ }).click()
    await page.getByRole('tab', { name: /Split|مقسوم/ }).click()

    // Honest 3D-or-fallback: real WebGL renders a canvas; unsupported
    // devices show the explicit localized fallback (never a fake chart).
    await expect(
      page.locator('canvas').or(page.getByTestId('dental-chart-webgl-fallback')).first()
    ).toBeVisible({ timeout: 20000 })

    // Shared-store selection: pick the first 2D tooth — the panel must open
    // for that exact tooth (the same selection the 3D meshes write).
    await selectFirstTooth(page)
    const panel = page.getByTestId('tooth-context-panel')
    await expect(panel).toBeVisible()
    const panelHeader = await panel.textContent()

    // the panel names the SELECTED FDI tooth in its header ("Tooth <n>") —
    // capture it as the identity that must survive the reload.
    const selectedTooth = (panelHeader ?? '').match(/\d+/)?.[0]
    expect(selectedTooth).toBeTruthy()

    // Add a finding through the REAL write API (server-side RBAC + audit).
    await panel.getByRole('button', { name: /Add finding|إضافة حالة/ }).click()
    await panel.getByRole('button', { name: /^Save$|^حفظ$/ }).click()
    await expect(panel).toContainText(/Clinical findings|الحالات السريرية/)

    // Reload: state is reconstructed from the DB (never memory).
    await page.reload()
    await expect(page.getByTestId('dental-chart-workspace')).toBeVisible()
    await selectFirstTooth(page)
    const reloaded = page.getByTestId('tooth-context-panel')
    await expect(reloaded).toBeVisible()
    // the SAME FDI tooth, with the finding persisted before the reload
    expect((await reloaded.textContent()) ?? '').toContain(selectedTooth ?? 'NEVER')
    await expect(reloaded).toContainText(/Clinical findings|الحالات السريرية/)
  })

  test('PHASE-8 isolation: selecting on Patient A never leaks into Patient B', async ({
    doctorPage: page,
  }) => {
    await openFirstPatientChart(page)
    await selectFirstTooth(page)
    await expect(page.getByTestId('tooth-context-panel')).toBeVisible()

    // open ANOTHER patient's chart through the REAL navigation path with the
    // shared engine-robust helper. The seed guarantees 10 patients, so the
    // second row is asserted — a vacuous isolation test protects nobody.
    await openPatientDetailByRow(page, 1)
    const idB = new URL(page.url()).pathname.split('/')[2]
    expect(idB).toBeTruthy()
    await page.goto(`/patients/${idB}/dental-chart`)
    await expect(page.getByTestId('dental-chart-workspace')).toBeVisible()
    // no selection, no panel: Patient A's state must not appear here
    await expect(page.getByTestId('tooth-context-panel')).toHaveCount(0)
  })

  test('RECEPTIONIST is read-only on the 3D workspace', async ({ receptionistPage: page }) => {
    await openFirstPatientChart(page)
    await selectFirstTooth(page)
    const panel = page.getByTestId('tooth-context-panel')
    await expect(panel).toBeVisible()
    // view roles may read; mutations must not exist in the DOM at all
    await expect(panel.getByRole('button', { name: /Add procedure|إضافة إجراء/ })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /Add finding|إضافة حالة/ })).toHaveCount(0)
  })
})
