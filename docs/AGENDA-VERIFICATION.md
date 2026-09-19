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
