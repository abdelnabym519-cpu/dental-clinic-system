import { Page, expect } from '@playwright/test'

/**
 * Open a patient's detail page from the patients list (by row index).
 *
 * Rows in app/(dashboard)/patients/page.tsx are not links — they navigate
 * via router.push() from a per-row Radix dropdown, and the only <a> inside
 * the table is the "Add Patient" button (/patients/new) in the empty state.
 * Clicking blindly therefore lands on the creation form instead of a
 * patient, where none of the detail tabs exist.
 *
 * Engine-robust contract (observed WebKit/Firefox failures with the old
 * blind pattern):
 *  - the menu trigger is the Radix trigger BUTTON (aria-haspopup="menu") —
 *    additional row buttons can never shift which control we open, and the
 *    trigger now carries an accessible name (aria-label, "Actions");
 *  - we assert the Radix portal menu (role="menu") is OPEN before clicking
 *    the item instead of racing its mount (WebKit can drop the first
 *    pointer event while the portal mounts);
 *  - the destination is verified with a function predicate on pathname —
 *    a real /patients/<id> route, never /patients/new — with no per-engine
 *    regex escaping.
 */
export async function openPatientDetailByRow(page: Page, rowIndex: number) {
  await page.goto('/patients')

  const row = page.locator('tbody tr').nth(rowIndex)
  await expect(row).toBeVisible({ timeout: 15000 })

  const trigger = row.locator('button[aria-haspopup="menu"]')
  await expect(trigger).toHaveCount(1)
  await trigger.click()

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: /view details/i }).click()

  await page.waitForURL((u) => /\/patients\/(?!new)[^/]+/.test(u.pathname), { timeout: 15000 })
}

/** Open the FIRST patient's detail page (the most common fixture need). */
export async function openFirstPatientDetail(page: Page) {
  await openPatientDetailByRow(page, 0)
}
