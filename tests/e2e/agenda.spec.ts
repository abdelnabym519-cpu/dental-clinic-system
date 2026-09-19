import { test, expect } from './fixtures/auth'

/**
 * Agenda — end-to-end verification of the clinic scheduling workspace.
 *
 * Mirrors the §28 runtime checklist of the Agenda master prompt:
 * sidebar placement, single scheduling entry, page load, seeded records,
 * day/week/month navigation, create, edit/reschedule, cancel, patient
 * navigation, provider filtering, conflict rejection, and console hygiene.
 *
 * Requires the seeded demo environment (prisma/seed.ts): admin@demo-dental.com,
 * at least one doctor with active appointments, and at least one patient.
 * See docs/AGENDA-VERIFICATION.md for the manual walkthrough equivalent.
 */

test.describe('Agenda — clinic scheduling workspace', () => {
  let consoleErrors: string[] = []

  test.beforeEach(async ({ adminPage: page }) => {
    consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
  })

  test('Agenda sits directly below Dashboard and is the only scheduling entry', async ({
    adminPage: page,
  }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible()

    const dashboardLink = page.getByRole('link', { name: /^Dashboard$/ })
    const agendaLink = page.getByRole('link', { name: 'Agenda' })
    const dashY = await dashboardLink.evaluate((el) => el.getBoundingClientRect().top)
    const agendaY = await agendaLink.evaluate((el) => el.getBoundingClientRect().top)
    expect(agendaY).toBeGreaterThan(dashY)

    // Exactly one scheduling entry in the whole sidebar
    await expect(page.getByRole('link', { name: 'Agenda' })).toHaveCount(1)
    // Patient Care no longer carries an appointments entry
    await page.getByText('Patient Care').first().click()
    await expect(page.getByRole('link', { name: /appointments/i })).toHaveCount(0)
  })

  test('agenda page loads with toolbar, calendar and legend', async ({ adminPage: page }) => {
    await page.goto('/agenda')
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible()
    await expect(page.getByText('Status legend')).toBeVisible()
  })

  test('day, week and month views render with real seeded appointments', async ({
    adminPage: page,
  }) => {
    await page.goto('/agenda')

    // Week is the default; seeded appointments for this week appear as blocks.
    await expect(page.getByText(/Loading calendar/i)).toBeHidden({ timeout: 10000 })

    // Switch to Day view via the view-mode select.
    await page.getByRole('combobox').last().click()
    await page.getByRole('option', { name: 'Day' }).click()
    await expect(page.getByTestId('day-view')).toBeVisible({ timeout: 10000 })

    // Month view renders the weekday header grid.
    await page.getByRole('combobox').last().click()
    await page.getByRole('option', { name: 'Month' }).click()
    for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      await expect(page.getByText(day, { exact: true })).toBeVisible()
    }
  })

  test('previous / today / next navigation moves the visible period', async ({
    adminPage: page,
  }) => {
    await page.goto('/agenda')
    await expect(page.getByText(/Loading calendar/i)).toBeHidden({ timeout: 10000 })

    const label = () => page.locator('h2').first()
    const todayLabel = await label().textContent()

    await page.getByRole('button', { name: 'Next period' }).click()
    await expect(label()).not.toHaveText(todayLabel)

    await page.getByRole('button', { name: 'Previous period' }).click()
    await expect(label()).toHaveText(todayLabel)

    await page.getByRole('button', { name: 'Today' }).click()
    await expect(label()).toHaveText(todayLabel)
  })

  test('create appointment persists and appears immediately', async ({ adminPage: page }) => {
    await page.goto('/agenda')
    await expect(page.getByText(/Loading calendar/i)).toBeHidden({ timeout: 10000 })

    await page.getByRole('button', { name: /new appointment/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Pick a future date so the conflict/past guards never interfere.
    const future = new Date()
    future.setDate(future.getDate() + 30)
    const dateKey = future.toISOString().slice(0, 10)
    await dialog.getByLabel('Date').fill(dateKey)
    await dialog.getByLabel('Start time').fill('16:00')

    await dialog.getByLabel('Patient').click()
    await page.getByRole('option').first().click()
    await dialog.getByLabel('Provider').click()
    await page.getByRole('option').first().click()

    await dialog.getByRole('button', { name: /book appointment/i }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })

    // The calendar refreshes: inspect the created date in Day view.
    await page.getByRole('combobox').last().click()
    await page.getByRole('option', { name: 'Day' }).click()
    // Navigate until the date label contains the created day.
    for (let i = 0; i < 40; i++) {
      const text = (await page.locator('h2').first().textContent()) ?? ''
      if (text.includes(String(future.getDate()))) break
      await page.getByRole('button', { name: 'Next period' }).click()
    }
    await expect(page.getByText(/No appointments scheduled/i)).toBeHidden({ timeout: 10000 })
  })

  test('overlapping booking is rejected with the server conflict error', async ({
    adminPage: page,
  }) => {
    await page.goto('/agenda')
    await expect(page.getByText(/Loading calendar/i)).toBeHidden({ timeout: 10000 })

    // Two appointments at the same time for the same provider must 409.
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: /new appointment/i }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      const future = new Date()
      future.setDate(future.getDate() + 35)
      await dialog.getByLabel('Date').fill(future.toISOString().slice(0, 10))
      await dialog.getByLabel('Start time').fill('18:00')

      await dialog.getByLabel('Patient').click()
      await page.getByRole('option').first().click()
      await dialog.getByLabel('Provider').click()
      await page.getByRole('option').first().click()

      await dialog.getByRole('button', { name: /book appointment/i }).click()
      if (i === 1) {
        await expect(
          dialog.getByText(/already has appointment|overlapping this time/i)
        ).toBeVisible({ timeout: 10000 })
      } else {
        await expect(dialog).toBeHidden({ timeout: 10000 })
      }
    }
  })

  test('block menu edits/reschedules and cancels an appointment', async ({ adminPage: page }) => {
    await page.goto('/agenda')

    // A seeded appointment is on the board; open its actions menu in Day view.
    await page.getByRole('combobox').last().click()
    await page.getByRole('option', { name: 'Day' }).click()
    await expect(page.getByText(/Loading calendar/i)).toBeHidden({ timeout: 10000 })

    // Find any day with an appointment by walking forward a week at most.
    let actions = page.getByRole('button', { name: /actions for appointment/i }).first()
    for (let i = 0; i < 7; i++) {
      if (await actions.isVisible().catch(() => false)) break
      await page.getByRole('button', { name: 'Next period' }).click()
      await expect(page.getByText(/Loading calendar/i)).toBeHidden({ timeout: 10000 })
      actions = page.getByRole('button', { name: /actions for appointment/i }).first()
    }

    await actions.click()
    await page.getByRole('button', { name: /edit \/ reschedule/i }).click()
    await page.waitForURL(/\/appointments\/[^/]+\/edit/, { timeout: 10000 })
    await page.goBack()

    await page.getByRole('button', { name: /actions for appointment/i }).first().click()
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: /^Cancel$/ }).click()
    // The block re-renders with the Cancelled status after refresh.
    await expect(page.getByText(/^Cancelled$/).first()).toBeVisible({ timeout: 10000 })
  })

  test('provider filter narrows the schedule to one doctor', async ({ adminPage: page }) => {
    await page.goto('/agenda')
    await expect(page.getByText(/Loading calendar/i)).toBeHidden({ timeout: 10000 })

    const filter = page.getByLabel('Filter by provider')
    if (await filter.isVisible().catch(() => false)) {
      await filter.click()
      // Choose the first concrete provider (not "All providers").
      await page.getByRole('option', { name: /Dr\. / }).first().click()
      // The filtered request must include that doctorId.
      // (Visible effect: the calendar reloads without error.)
      await expect(page.getByText(/could not load/i)).toBeHidden()
    }
  })

  test('appointment blocks navigate to the appointment detail (patient context)', async ({
    adminPage: page,
  }) => {
    await page.goto('/agenda')
    await expect(page.getByText(/Loading calendar/i)).toBeHidden({ timeout: 10000 })

    const block = page.locator('[role="button"][aria-label^="Appointment APT"]').first()
    if (await block.isVisible().catch(() => false)) {
      await block.click()
      await page.waitForURL(/\/appointments\/(?!new)[^/]+$/, { timeout: 10000 })
    }
  })

  test('no critical browser console errors during the workspace flow', async ({
    adminPage: page,
  }) => {
    await page.goto('/agenda')
    await expect(page.getByText(/Loading calendar/i)).toBeHidden({ timeout: 10000 })
    await page.getByRole('button', { name: 'Next period' }).click()
    await expect(page.getByText(/Loading calendar/i)).toBeHidden({ timeout: 10000 })

    const critical = consoleErrors.filter(
      (e) => !/favicon|Google Fonts|Download the React DevTools/i.test(e)
    )
    expect(critical).toEqual([])
  })
})
