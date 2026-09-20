# Agenda — Verification & Handoff Guide

The Agenda phase (`feat(agenda): complete clinic scheduling workspace`) is
implemented and pushed. This document maps the phase's runtime-verification
checklist to exact local commands, and records what was verifiable inside the
CI sandbox versus what requires a machine with MySQL.

## Sandbox verification status (what already ran)

| Check | Result |
| --- | --- |
| Full test suite | 4449/4449 (192 files) |
| Agenda unit (date/time/overlap math) | 16/16 |
| Agenda API (RBAC, conflicts, tenant isolation, validation, cancellation, number-collision retry) | 21/21 |
| Agenda components (workspace, dialog, calendar, mobile list) | 6 + 15 + 1 artifact |
| ESLint / TypeScript (touched files) | 0 errors |
| Route registered + auth-gated | `/agenda` → `307 → /login?callbackUrl=/agenda` (live server) |
| Runtime render artifact | `tools/preview/agenda-week.html` (real CalendarView DOM, fixtures) |

**Environment blockers (documented, not code):** the CI sandbox has no MySQL,
no root/Docker, and `binaries.prisma.sh` is network-blocked (the published
`@prisma/engines` npm tarball was pulled and verified to contain no binaries —
only the downloader for the blocked CDN). Therefore no DB-backed or browser
click-through was possible in-sandbox. Do not treat the table above as a
substitute for the browser pass below.

## Automated browser checklist

`tests/e2e/agenda.spec.ts` automates the §28 browser checklist (sidebar
placement, single scheduling entry, day/week/month, navigation, create,
conflict rejection, edit/reschedule, cancel, patient navigation, provider
filter, console hygiene) using the shared authenticated fixtures. With MySQL
running and the app seeded:

```bash
npx playwright install chromium   # once per machine
npm run test:e2e -- agenda        # or: npx playwright test tests/e2e/agenda.spec.ts
```

## Local machine verification (runs the full checklist)

Prerequisites: MySQL reachable at `DATABASE_URL` (see `.env.example`,
`docker-compose.dev.yml`).

```bash
git pull origin arena/01a0b6b5-dental-clinic-system
npm install
npx prisma generate
npx prisma db push        # or your project's migrate workflow
npx tsx prisma/seed.ts    # seeds 2 doctors + 18 appointments (additive)
npm run dev               # http://localhost:3000
```

Login with the standard demo account, then verify:

1. Sidebar: `Dashboard` → **Agenda** directly below it; no Appointments entry
   under Patient Care; exactly one scheduling entry.
2. `/agenda` loads; seeded appointments render (day/week/month, prev/today/next).
3. **New appointment** dialog books a real record; it appears immediately.
4. Block menu → **Edit / Reschedule** persists and re-checks conflicts.
5. Block menu → **Cancel** flips status to Cancelled; legend + block update.
6. Overlap test: book a second appointment overlapping an existing one for the
   same doctor → inline 409 error naming the blocking appointment.
7. Back-to-back bookings (09:00–09:30 then 09:30–10:00) succeed.
8. Provider filter narrows the calendar to one doctor.
9. Patient link opens the real patient context (`/appointments/[id]`).
10. Narrow viewport (<768px): mobile agenda list replaces the time grids
    (no horizontal overflow).
11. Keyboard: appointment blocks are focusable (Tab) and open with Enter.

## Where the code lives

- Page: `app/(dashboard)/agenda/page.tsx`
- Calendar engine (day/week/month + mobile list): `components/appointments/calendar-view.tsx`
- Create/edit dialog: `components/agenda/appointment-dialog.tsx`
- Scheduling primitives: `lib/agenda-utils.ts`
- Conflict service: `lib/services/appointment-conflict.service.ts`
- API: `app/api/appointments/*` (hardened in place — no duplicate routes/models)
- Navigation: `config/nav.ts` (Agenda under Overview, after Dashboard)
- Seed additions: `prisma/seed.ts` (second doctor + appointments, additive)

---

# Phase 2 — complete clinic scheduling domain (runtime checklist)

Phase 2 extends the same Agenda (no new nav entries, no duplicate screens) with
rooms, booking-window enforcement, recurrence, check-in/queue, waiting list,
analytics and reminder infrastructure. New code: `lib/agenda-availability.ts`,
`components/agenda/agenda-panels.tsx`, `components/agenda/appointment-drawer.tsx`,
`app/api/appointments/{analytics,reminders,availability}`,
`app/api/rooms`, `app/api/appointments/waitlist/[id]/promote`,
`lib/appointment-number.ts`. Schema deltas are additive (Room model,
`Appointment.roomId`/`recurrenceGroupId`, `AppointmentReminder.hospitalId`) with
migration `prisma/migrations/20260920000000_agenda_phase2_rooms_recurrence`.

After `npx prisma generate && npx prisma db push && npx tsx prisma/seed.ts`:

1. **Rooms** — as ADMIN: rooms CRUD via `POST /api/rooms` (seeded: Chair 1,
   Chair 2, Consultation); booking dialog shows a Room/chair selector; booking
   the same room at the same time twice → 409 naming the blocking appointment.
2. **Room filter** — calendar toolbar (when rooms exist) narrows to one room;
   room name appears on blocks in day view.
3. **Booking window** — select a provider, try booking 23:00 → inline 409
   `OUTSIDE_WORKING_HOURS`; booking 13:15 (default lunch) → 409 `DURING_BREAK`;
   booking on a configured-closed weekday → 409.
4. **Availability overlay** — with a provider selected, day/week views shade
   outside-hours (hatching) and the lunch band; a provider on approved leave or
   a clinic holiday shows a red ribbon on that day.
5. **Recurrence** — New appointment → "Repeat as a series" (daily/weekly/
   bi-weekly/monthly, max 60); each occurrence becomes a REAL appointment with
   a shared `recurrenceGroupId`; overlapping occurrence → 409 naming its date.
6. **Series edit scope** — edit one occurrence of a series → scope prompt
   (this / future / all); `future` moves later occurrences by the same delta.
7. **Check-in** — as RECEPTIONIST/ADMIN: Today's queue panel (under the
   calendar) + block menu show **Check in**; status flips to Checked in.
8. **Queue flow** — Start (checked-in) and Complete (in-progress) actions for
   DOCTOR/ADMIN; block color + legend follow the status.
9. **No-show** — mark a no-show (DOCTOR/ADMIN); the patient profile's
   Appointments tab shows an "N no-shows" badge computed from real records.
10. **Waiting list** — panel lists ACTIVE entries (seeded one); **Book next
    slot** books the first genuinely free slot (server-side search honoring
    hours/leaves/holidays/conflicts) and marks the entry BOOKED.
11. **Analytics** — Analytics tab (ADMIN/DOCTOR): totals, completion /
    cancellation / no-show rates, clinic occupancy and per-doctor utilization
    computed from live records (numbers change as appointments change).
12. **Reminders (infrastructure only)** — appointment drawer → Reminders:
    queue a WhatsApp/SMS/Email reminder (stored PENDING for the reminder job;
    nothing is sent from the UI), cancel a pending one; SENT reminders refuse
    cancellation. (Live sending is Phase 3 / Egyptianization.)
13. **Clinical links** — drawer links: Patient file (`?tab=appointments`),
    Odontogram (`?tab=dental-chart`) — the patient profile opens directly on
    the requested tab; drawer also lists complaint/notes/recurrence group.
14. **RBAC (spot-check)** — DOCTOR sees no Check-in button; RECEPTIONIST sees
    no Start/Complete; every endpoint re-checks server-side (client hiding is
    cosmetic only).
15. **Patient search** — the toolbar search box filters by patient name/number.

> In-sandbox this checklist could not be executed (no MySQL, no browser, and
> the Prisma engine cannot be downloaded — see the Phase 1 report). The suite
> covers each behavior with real numbers: `tests/api/agenda-phase2.test.ts`
> (28 tests), `tests/unit/agenda-availability.test.ts` (24),
> `tests/components/agenda-panels.test.tsx` (6).
