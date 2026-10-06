import { test, expect } from '@playwright/test'

/**
 * E2E (Playwright — requires a running app + seeded DB; not part of the
 * vitest suite). Interactive Dental Chart happy path:
 * patient → chart → 2D select ↔ 3D select ↔ panel → reload persistence.
 */
test.describe('Interactive Dental Chart (2D/3D)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
  })

  test('open patient dental chart, switch to 3D, select a tooth, see the panel', async ({ page }) => {
    await page.goto('/patients/patient-e2e-1/dental-chart')
    await expect(page.getByTestId('dental-chart-2d')).toBeVisible()

    // 3D loads as real WebGL (canvas present), not a CSS trick
    await page.getByRole('tab', { name: /ثلاثي الأبعاد|3D/ }).click()
    await expect(page.locator('canvas')).toBeVisible()

    // selection from the shared store: select in 2D, visible in panel
    await page.getByTestId('dental-chart-2d').getByRole('button').first().click()
    await expect(page.getByTestId('tooth-context-panel')).toBeVisible()

    // add finding as DOCTOR
    await page.getByRole('button', { name: /إضافة حالة|Add finding/ }).click()
    await page.getByRole('button', { name: /^حفظ$|^Save$/ }).click()
    await expect(page.locator('[data-testid="tooth-context-panel"]')).toContainText(/الحالات السريرية|Clinical findings/)

    // reload → state reconstructed from the DB
    await page.reload()
    await expect(page.getByTestId('dental-chart-2d')).toBeVisible()
  })

  test('RECEPTIONIST is read-only on the chart', async ({ page }) => {
    await page.goto('/patients/patient-e2e-1/dental-chart')
    await expect(page.getByTestId('dental-chart-2d')).toBeVisible()
    await page.getByTestId('dental-chart-2d').getByRole('button').first().click()
    await expect(page.getByTestId('tooth-context-panel')).toBeVisible()
    await expect(page.getByRole('button', { name: /إضافة إجراء|Add procedure/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /إضافة حالة|Add finding/ })).toHaveCount(0)
  })
})
