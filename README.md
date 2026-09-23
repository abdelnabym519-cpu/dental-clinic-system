# Dentora - Free Open Source Dental Clinic Management Software for Egypt

A comprehensive, AI-powered **dental hospital management system** built with Next.js 16, designed for **dental clinics and multi-branch hospital chains in Egypt**. Includes VAT-compliant billing, Fawry/Paymob/InstaPay payments, bilingual Arabic/English UI, patient portal, tele-dentistry, 16 AI skills, and more — completely **free and open source**.

> **Looking for dental practice management software in Egypt?** Dentora is a free alternative to expensive proprietary dental software. Self-host it on your own server with full control over your patient data.

## Features

### Core Modules

- **Patient Management** — Records, medical history, dental charting, document uploads
- **Appointment Scheduling** — Calendar view, slot management, reminders, no-show prediction
- **Treatment Plans** — Treatment tracking, procedure catalog, AI-assisted treatment advice
- **Billing & Invoicing** — VAT-compliant (14%) invoicing, payment tracking, payment plans (EMI)
- **Prescriptions** — Digital prescriptions, medication database, print/PDF export
- **Inventory Management** — Stock tracking, low-stock alerts, AI-powered demand forecasting
- **Lab Integration** — Lab order management, status tracking, work coordination
- **Staff Management** — Roles & permissions, attendance, doctor schedules

### Advanced Features

- **AI Skills (16 built-in)** — Treatment advisor, smart scheduler, billing agent, patient intake, inventory forecaster, cashflow forecaster, patient segmentation, claim analyzer, consent generator, dynamic pricing, and more
- **Patient Portal** — Online booking, medical records access, digital intake forms
- **Insurance & Claims** — Insurance verification, claim submission, auto-adjudication
- **CRM & Loyalty** — Patient segmentation, loyalty points, referral tracking
- **Communications** — SMS/Email/WhatsApp messaging, campaign management, marketing automation
- **Tele-Dentistry** — Video consultations via Jitsi Meet integration
- **Sterilization Tracking** — Instrument management, sterilization logs, compliance reporting
- **Dental Imaging** — Interactive SVG dental arch viewer with condition mapping
- **IoT Device Integration** — Medical device data logging and monitoring
- **Payment Gateways** — Fawry, Paymob (Accept), InstaPay integration (encrypted credentials)
- **Reports & Analytics** — Revenue, appointments, treatment stats, exportable to Excel
- **Audit Logging** — Full audit trail for compliance
- **Multi-branch Support** — Hospital-scoped data isolation via NextAuth

## Tech Stack

| Layer     | Technology                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| Framework | [Next.js 16](https://nextjs.org/) (App Router)                                                                           |
| Language  | [TypeScript 5](https://www.typescriptlang.org/)                                                                          |
| Database  | [MySQL 8](https://www.mysql.com/) via [Prisma 5](https://www.prisma.io/) ORM                                             |
| Auth      | [NextAuth v5](https://authjs.dev/) (beta) with credentials provider                                                      |
| UI        | [Tailwind CSS 3](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| Charts    | [Recharts](https://recharts.org/)                                                                                        |
| Forms     | [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/) validation                                     |
| AI        | [OpenRouter](https://openrouter.ai/) (multi-model gateway)                                                               |
| Email     | Nodemailer (SMTP)                                                                                                        |
| Testing   | [Vitest](https://vitest.dev/) + [Playwright](https://playwright.dev/) + [Testing Library](https://testing-library.com/)  |
| CI/CD     | GitHub Actions                                                                                                           |

## Prerequisites

- **Node.js** 20 or later
- **npm** 10 or later
- **Docker** with Compose v2 — recommended, but [optional](#alternative-setup-without-docker)

## Getting Started

```bash
git clone https://github.com/abinauv/dental-erp.git
cd dental-erp
npm install
cp .env.example .env
# Fill in NEXTAUTH_SECRET, ENCRYPTION_KEY and CRON_SECRET (each has a
# generator command beside it in .env.example), and set:
#   DATABASE_URL="mysql://root:dental@localhost:3306/dental_erp"

npm run dev:start
```

`npm run dev:start` is the **normal development startup**. It:

1. starts the core dependencies — MySQL and Redis — via `docker compose -f docker-compose.dev.yml up -d mysql redis` (idempotent — running containers are reused). The optional MinIO / createbuckets / Mailpit development services are deliberately not started here, so a broken optional image can never block the core startup,
2. waits until MySQL **actually** accepts connections — a live query through the Prisma client, polled until it succeeds or a 3-minute timeout fails loudly,
3. applies pending migrations with `npx prisma migrate deploy` (a no-op when the database is already in sync),
4. seeds the database **only if it has never been initialized** — an existing database is never re-seeded and never touched,
5. starts the Next.js dev server.

It never resets or deletes anything, so it is also what you run after a
laptop or Docker restart — see [Restarting and data persistence](#restarting-and-data-persistence).
Use `npm run dev:start -- --db-only` to do steps 1–4 without starting the app.

<details>
<summary>Manual equivalent, step by step</summary>

```bash
docker compose -f docker-compose.dev.yml up -d mysql redis   # wait until the MySQL container is healthy
npx prisma migrate deploy                        # create/refresh the schema
npx prisma db seed                               # sample data — only for a fresh, empty database
npm run dev                                      # raw Next.js dev server
```

</details>

Open [http://localhost:3000](http://localhost:3000).

You still need to fill in `NEXTAUTH_SECRET`, `ENCRYPTION_KEY` and `CRON_SECRET`
in `.env` — the app will not start without them. Each one has a
`node -e "..."` command beside it in `.env.example` that prints a valid value.

**The app runs on your machine, not in Docker.** Compose brings up the backing
services only. Bind-mounting `node_modules` into a container is slow enough on
Windows and macOS to spoil the edit-reload loop, and native hot reload is
better. `docker-compose.dev.yml` is a convenience for contributors and is
**never** suitable for production — every credential in it is weak and public.

### What Compose gives you

| Service | Port       | What it is for                                                    |
| ------- | ---------- | ----------------------------------------------------------------- |
| MySQL   | 3306       | The application database                                          |
| Redis   | 6379       | Reserved for caching and queues; nothing uses it yet              |
| MinIO   | 9000, 9001 | S3-compatible storage; reserved for Phase 3. Console on 9001      |
| Mailpit | 1025, 8025 | Captures every outbound email. Read them at http://localhost:8025 |

Mailpit is the useful one right away. Point the `SMTP_*` variables at it (the
values are commented into `.env.example`) and you can exercise password resets,
invitations and reminders with no credentials and no risk of emailing a real
person.

`createbuckets` runs once, creates the MinIO bucket and exits. Seeing it as
`Exited (0)` in `docker compose ps` is success, not a failure.

Useful commands:

```bash
docker compose -f docker-compose.dev.yml logs -f      # tail the services
docker compose -f docker-compose.dev.yml down         # stop, keep the data
docker compose -f docker-compose.dev.yml down -v      # stop and wipe the data
```

**Port 3306 already in use?** You have MySQL installed locally. Either stop it,
or change the host port in `docker-compose.dev.yml` to `'3307:3306'` and update
`DATABASE_URL` to match.

> **If you were running this stack before August 2026**, its compose project was
> renamed from `dental-erp` to `dental-erp-dev`, so that a production stack on
> the same machine cannot end up sharing volumes with it. Your old containers
> and volumes are still there under the previous name; clean them up once with:
>
> ```bash
> docker compose -p dental-erp -f docker-compose.dev.yml down -v
> ```

### Alternative setup: without Docker

<details>
<summary>Install MySQL 8 yourself</summary>

Docker is not a requirement. With MySQL 8.0+ installed locally:

```bash
# Verify MySQL is accessible
mysql -u root -p -e "SELECT 1"

# Create the database
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS dental_erp"
```

Then set `DATABASE_URL` in `.env` to your own credentials and continue from
`npx prisma migrate deploy` above.

</details>

### About the database setup

`prisma migrate deploy` is the recommended path — it is repeatable and safe to
re-run when you upgrade. `npx prisma db push` also works and is handy while
developing, but it applies the schema without recording it in
`prisma/_prisma_migrations`, so later `migrate deploy` runs will fail against
that database.

<details>
<summary>Upgrading a database that was created with <code>prisma db push</code></summary>

Tell Prisma the existing migrations are already reflected in your schema, then
deploy as normal from that point on:

```bash
npx prisma migrate resolve --applied 20260127152236_multi_tenancy
npx prisma migrate resolve --applied 20260728120000_sync_schema_with_models
npx prisma migrate resolve --applied 20260801150000_inventory_lab_prisma_models
npx prisma migrate deploy
```

</details>

### Restarting and data persistence

Your development data lives in the Docker **named volume**
`dental-erp-dev_mysql-data`. It survives container restarts, Docker Desktop
restarts and laptop reboots — nothing is ever re-created from scratch when
you turn the machine back on.

To bring the development environment up after any kind of restart, run:

```bash
npm run dev:start
```

For a database that already contains data this:

- starts (or reuses) the core MySQL and Redis containers,
- waits for MySQL to accept a real connection before doing anything else,
- runs `prisma migrate deploy`, which applies **pending** migrations and does
  nothing when the schema is already in sync,
- detects that the database was already seeded and **skips the seed entirely**
  — no record is written, changed or re-created,
- starts the app with the same accounts as before
  (e.g. `admin@dentora-dental.com`).

The seed runs only against a database that has never been initialized — a
fresh volume on a fresh machine. It is not re-run on subsequent startups, so
it can never duplicate sample rows or overwrite accounts you changed.

MinIO and Mailpit are **optional** development infrastructure (S3-compatible
storage for a future phase, and an SMTP catcher). They are not required by
the database startup path, so `dev:start` does not start them — deliberately,
so an optional service's image pull can never block core startup. If you need
them, the ordinary full-stack command reuses the running MySQL/Redis
containers and adds the optional ones:

```bash
docker compose -f docker-compose.dev.yml up -d
```

> **`npx prisma migrate reset --force` is a destructive operation and is NOT
> part of the normal startup.** It drops and recreates the database, deleting
> every patient, appointment, invoice and other record in
> `dental-erp-dev_mysql-data`. (The "stop and wipe the data" command above,
> `docker compose -f docker-compose.dev.yml down -v`, does the same.) Use it
> only when you deliberately want a clean-slate development database — never
> to fix a failed login or a "database looks stale" feeling after a restart.
> If a startup fails, fix the reported step and re-run `npm run dev:start`;
> it is safe to re-run at any time.

### Intentionally initialising a fresh database

To deliberately start over from an empty, seeded database, you must perform
the destructive step yourself, then let the normal startup do the rest:

```bash
npx prisma migrate reset --force    # DESTRUCTIVE — you are choosing this
npm run dev:start                   # migrate deploy + seed (runs once) + app
```

`dev:start` alone will **never** do the destructive part. On a database that
already has data it only migrates and skips the seed.

### Proving data survives a restart

```bash
npm run verify:persistence -- --restart
```

This takes a snapshot (row counts of users, hospitals, patients, appointments,
invoices, plus the seeded-admin and a single sentinel record), stops the stack
(`docker compose down` — volumes are kept), runs the **real** safe startup
(`dev:start`'s database path), and re-verifies: no table lost rows, the
sentinel and the seeded admin survived, and the seed was **not** re-run on the
populated database. It exits non-zero if anything regressed. Nothing is ever
deleted. Without `--restart` it only snapshots and creates the sentinel.

### Login stopped working because the admin password drifted?

If the seeded admin row exists (active, linked to an active hospital) but
`bcrypt.compare()` of the documented password against the stored hash is
`false`, the database is fine and the fix is a **separate, explicit** command
— it is deliberately _not_ part of the normal startup, which must never modify
an existing database:

```bash
npm run db:restore-dev-admin
```

It sets the documented development password on the seeded admin account only
(one row, one column), reports the result without printing the secret, and
warns (without acting) if the account is currently inactive. It never resets,
deletes, drops or re-seeds.

### Default Credentials (after seeding)

| Role        | Email                   | Password    |
| ----------- | ----------------------- | ----------- |
| Super Admin | `admin@dentora-dental.com` | `Admin@123` |

> **Warning**: Change the default password immediately in production.

## Environment Variables

See [`.env.example`](.env.example) for all available variables. Key ones:

| Variable                                    | Required | Description                                   |
| ------------------------------------------- | -------- | --------------------------------------------- |
| `DATABASE_URL`                              | Yes      | MySQL connection string                       |
| `NEXTAUTH_URL`                              | Yes      | App URL (e.g., `http://localhost:3000`)       |
| `NEXTAUTH_SECRET`                           | Yes      | Random secret for session encryption          |
| `ENCRYPTION_KEY`                            | Yes      | 64-char hex string for AES-256-GCM encryption |
| `CRON_SECRET`                               | Yes      | Secret for securing cron job endpoints        |
| `OPENROUTER_API_KEY`                        | No       | Required for AI features                      |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | No       | Required for email features                   |
| `SMS_API_KEY`                               | No       | Required for SMS features                     |

## Available Scripts

```bash
npm run dev          # Start development server (raw Next.js; assumes the database is ready)
npm run dev:start    # Safe development startup: services -> readiness -> migrations -> seed only if empty -> dev
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
npm run test         # Run unit/integration tests (Vitest)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run test:e2e     # Run end-to-end tests (Playwright)
npm run test:all     # Run all tests

# Database
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema without recording a migration (dev only)
npm run db:migrate   # Create a migration from schema changes (development)
npm run db:migrate:deploy  # Apply pending migrations (setup and deploys)
npm run db:seed      # Seed sample data (only for a fresh database — dev:start handles this)
npm run db:restore-dev-admin  # One-off: restore the documented dev admin password (never part of startup)
npm run verify:persistence    # Prove existing data survives stop -> start (add --restart for the full cycle)
npm run db:studio    # Open Prisma Studio (DB GUI)
```

## Project Structure

```
dental-erp/
├── app/                    # Next.js App Router
│   ├── (auth)/             # Authentication pages (login, signup, etc.)
│   ├── (dashboard)/        # Dashboard pages (all modules)
│   └── api/                # API routes
├── components/             # Reusable React components
│   ├── layout/             # Dashboard shell, sidebar, header
│   ├── ui/                 # shadcn/ui components
│   └── imaging/            # Dental imaging components
├── config/                 # App configuration (navigation, etc.)
├── lib/                    # Utilities, helpers, AI skills
│   ├── ai/                 # AI skill definitions
│   ├── api-helpers.ts      # Auth & API utilities
│   └── prisma.ts           # Prisma client singleton
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── seed.ts             # Database seeder
├── __tests__/              # Test files
│   ├── unit/               # Unit tests
│   ├── integration/        # Integration tests (API routes)
│   ├── components/         # Component tests
│   ├── e2e/                # Playwright E2E tests
│   └── accessibility/      # Accessibility tests
├── .github/
│   └── workflows/ci.yml    # CI pipeline
└── public/                 # Static assets
```

## Testing

The project has comprehensive test coverage:

- **Unit tests** — Business logic, utilities, AI skills
- **Integration tests** — API route handlers with mocked Prisma
- **Component tests** — React components with Testing Library
- **E2E tests** — Full user flows with Playwright
- **Accessibility tests** — WCAG 2.1 compliance with axe-core

```bash
# Run all unit/integration tests
npm test

# Run with coverage
npm run test:coverage

# Run E2E tests (requires running server)
npm run test:e2e
```

## Deployment

**[SELF_HOSTING.md](SELF_HOSTING.md) is the full guide** — the short version is
that you do not need a checkout, Node.js, or a build step:

```bash
mkdir -p /opt/dental-erp && cd /opt/dental-erp
curl -fsSLO https://raw.githubusercontent.com/abinauv/dental-erp/main/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/abinauv/dental-erp/main/.env.production.example -o .env
# fill in .env, then
docker compose up -d
```

That pulls a published multi-architecture image (`linux/amd64` and
`linux/arm64`) from `ghcr.io/abinauv/dental-erp`, waits for MySQL, runs the
database migrations as a one-shot container, and starts the app. Add
`-f docker-compose.caddy.yml` for HTTPS with automatic certificates.

SELF_HOSTING.md also covers backups and restores, upgrading, and what to do
when something is wrong.

### Running the image directly

```bash
docker run -p 3000:3000 --env-file .env -v dental-uploads:/app/uploads   ghcr.io/abinauv/dental-erp:latest
```

> **Mount a volume at `/app/uploads`.** On the default `STORAGE_DRIVER=local`,
> uploaded files — patient documents, scans, signed consent forms — are written
> to the container filesystem. Without a volume they are destroyed the moment
> the container is replaced, which is every single redeploy. The `-v` flag above
> is not optional in any deployment you care about.
>
> **Already running without one?** Copy your files out before you next redeploy:
>
> ```bash
> docker cp <container>:/app/uploads ./uploads-backup
> ```
>
> then recreate the container with the volume mounted and copy them back.
> Setting `STORAGE_DRIVER=s3` removes this whole class of problem by getting
> uploads off the container filesystem — see [docs/STORAGE.md](docs/STORAGE.md).

Running the image this way does not migrate the database. The image carries the
Prisma CLI so it can do that itself:

```bash
docker run --rm --env-file .env ghcr.io/abinauv/dental-erp:latest   node node_modules/prisma/build/index.js migrate deploy
```

### Health checks

Two endpoints, and the distinction between them matters:

| Endpoint      | Purpose   | Checks the database | Use for                             |
| ------------- | --------- | ------------------- | ----------------------------------- |
| `/api/health` | Liveness  | No                  | "Is this process alive?"            |
| `/api/ready`  | Readiness | Yes                 | "Should this instance get traffic?" |

Point liveness probes at `/api/health` and readiness probes at `/api/ready`.
Pointing a liveness probe at `/api/ready` means a brief database outage will
make your orchestrator kill and restart otherwise-healthy containers, turning a
short blip into a restart loop. `/api/ready` returns `503` when the database is
unreachable — it never throws.

The image carries a `HEALTHCHECK` against `/api/health`, so `docker ps` reports
container health with no extra configuration.

### Manual

```bash
npm run build
npm start
```

### Environment Requirements

Deploying from the published image, all you need is Docker Engine 24+ with the
Compose plugin. Building or developing from source needs:

- Node.js 20+
- MySQL 8.0+ (with a dedicated database)
- Reverse proxy (nginx/Caddy) for HTTPS in production —
  [`docker-compose.caddy.yml`](docker-compose.caddy.yml) is a working example
- A persistent volume mounted at `/app/uploads`

## Documentation

- [Self-hosting](SELF_HOSTING.md) — running Dentora on your own server from a published image, with backups, TLS and upgrades.
- [Infrastructure Roadmap](docs/INFRASTRUCTURE.md) — how Dentora is packaged and deployed, and what is planned next. Feedback welcome, especially on the phases not yet built.
- [File storage](docs/STORAGE.md) — local disk vs S3, and how to move between them without losing files.
- [Localization](docs/LOCALIZATION.md) — locale support and the message catalogue.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

If you discover a security vulnerability, please follow our [Security Policy](SECURITY.md). Do **not** open a public issue for security vulnerabilities.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Next.js](https://nextjs.org/) by Vercel
- [Prisma](https://www.prisma.io/) for database ORM
- [shadcn/ui](https://ui.shadcn.com/) for UI components
- [Radix UI](https://www.radix-ui.com/) for accessible primitives
- [OpenRouter](https://openrouter.ai/) for AI model access
