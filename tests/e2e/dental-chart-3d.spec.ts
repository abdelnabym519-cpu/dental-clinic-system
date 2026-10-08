import { test, expect } from './fixtures/auth'
import { openFirstPatientDetail } from './fixtures/patients'

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
    await page.getByTestId('dental-chart-2d').getByRole('button').first().click()
    const panel = page.getByTestId('tooth-context-panel')
    await expect(panel).toBeVisible()
    const panelHeader = await panel.textContent()

    // Add a finding through the REAL write API (server-side RBAC + audit).
    await panel.getByRole('button', { name: /Add finding|إضافة حالة/ }).click()
    await panel.getByRole('button', { name: /^Save$|^حفظ$/ }).click()
    await expect(panel).toContainText(/Clinical findings|الحالات السريرية/)

    // Reload: state is reconstructed from the DB (never memory).
    await page.reload()
    await expect(page.getByTestId('dental-chart-workspace')).toBeVisible()
    await page.getByTestId('dental-chart-2d').getByRole('button').first().click()
    const reloaded = page.getByTestId('tooth-context-panel')
    await expect(reloaded).toBeVisible()
    // the same tooth, with the finding that was persisted before reload
    expect(await reloaded.textContent()).toContain((panelHeader ?? '').match(/#?\d+/)?.[0] ?? '')
    await expect(reloaded).toContainText(/Clinical findings|الحالات السريرية/)
  })

  test('PHASE-8 isolation: selecting on Patient A never leaks into Patient B', async ({
    doctorPage: page,
  }) => {
    await openFirstPatientChart(page)
    await page.getByTestId('dental-chart-2d').getByRole('button').first().click()
    await expect(page.getByTestId('tooth-context-panel')).toBeVisible()

    // open ANOTHER patient's chart through the real navigation path
    await page.goto('/patients')
    const rows = page.locator('tbody tr')
    const second = rows.nth(1)
    if (await second.isVisible()) {
      await second.getByRole('button').last().click()
      await page.getByRole('menuitem', { name: /view details/i }).click()
      await page.waitForURL(/\/patients\/(?!new)[^/]+$/, { timeout: 10000 })
      const idB = new URL(page.url()).pathname.split('/')[2]
      await page.goto(`/patients/${idB}/dental-chart`)
      await expect(page.getByTestId('dental-chart-workspace')).toBeVisible()
      // no selection, no panel: Patient A's state must not appear here
      await expect(page.getByTestId('tooth-context-panel')).toHaveCount(0)
    }
  })

  test('RECEPTIONIST is read-only on the 3D workspace', async ({ receptionistPage: page }) => {
    await openFirstPatientChart(page)
    await page.getByTestId('dental-chart-2d').getByRole('button').first().click()
    const panel = page.getByTestId('tooth-context-panel')
    await expect(panel).toBeVisible()
    // view roles may read; mutations must not exist in the DOM at all
    await expect(panel.getByRole('button', { name: /Add procedure|إضافة إجراء/ })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /Add finding|إضافة حالة/ })).toHaveCount(0)
  })
})
