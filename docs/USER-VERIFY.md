# docs/USER-VERIFY.md — what only you can run

This sandbox has **no Docker, no MySQL, no Prisma client, no browser and no
`.env`**. Everything below is therefore marked **[LOCAL]**: I can write and test
the code, but only you can prove it against your real machine.

Run everything from the repository root in **Git Bash**.

---

## 0. Two one-command scripts (run these after every one of my pushes)

```bash
./scripts/verify-local.sh              # all code gates; add --pull / --install if wanted
./scripts/verify-ai.sh                 # AI runtime + storage + migrations
```

Each ends with **one line to paste back to me**, for example:

```
branch=merge/fdi52-into-wip HEAD=baf39b2 typecheck=PASS typecheck:vendor=PASS lint=PASS tests=PASS build=PASS no-glb-in-git=PASS
```

Logs go to `.local-logs/verify-local.log` and `.local-logs/verify-ai.log`
(gitignored — they are never committed).

`verify-local.sh` never stops at the first failure: it runs every gate and
prints a final PASS/FAIL table. **Neither script ever prints `.env` values**;
the single exception is `STORAGE_DRIVER`, whose value is printed because it
names a driver, not a credential.

If `verify-ai.sh` reports `model_checksums=FAIL`, that is expected until the
model weights are in place. Generate the manifest once:

```bash
./scripts/generate-model-manifest.sh          # refuses to write an empty manifest
( cd ai-validation && sha256sum -c models.sha256 )
```

---

## 1. Gates I cannot run here

| Gate | Command | Why it is [LOCAL] |
| --- | --- | --- |
| typecheck with Prisma | `npx prisma generate && npx tsc --noEmit` | `npm ci --ignore-scripts` here ⇒ no client. Expect **0** errors on your machine vs **498** here. |
| build | `npm run build` | needs the Prisma client. Must reach `✓ Compiled successfully`. |
| migrations | `npx prisma migrate status` | needs MySQL |
| AI stack | `docker compose -f ai-compose.yml up -d` | needs Docker |

---

## 2. P3 — 2D v2 acceptance screenshots (D2 precondition)

Open `http://localhost:3000/patients/<id>/dental-chart-v2` as a **DOCTOR** and
send me screenshots of:

1. Arabic RTL layout, **no language switcher** visible.
2. Permanent **and** primary teeth visible in the 2D view.
3. Add caries on tooth **36**, wait 1 s, press **F5** → the finding is still there.
4. The **same finding visible on the old chart** (`/patients/<id>/dental-chart`).
5. Edit primary tooth **54** → persists after reload.
6. Log in as **RECEPTIONIST** → cannot edit; the Arabic read-only note shows.
7. Navigate away to another page → **buttons/fonts unchanged** (proves the
   vendored CSS is properly scoped to `.rao-scope`).

Status stays **BUILT** until you confirm these.

---

## 3. P9.1 — prove/disprove the storage `NoSuchKey` hypothesis

The app writes uploads through `lib/storage/index.ts` (defaults to the **local
disk** driver) while the orchestrator reads **MinIO**. Please run and paste:

```bash
# a) which storage variables each worktree actually defines (NAMES only)
grep -c "^STORAGE_DRIVER=" .env

# b) what is actually in the MinIO bucket
docker exec -it <minio-container> mc ls local/<bucket>/ --recursive | head -20

# c) what is on local disk
ls -R uploads | head -20

# d) the value of the driver (not a secret)
grep "^STORAGE_DRIVER=" .env
```

Then: upload one study from the UI with **analyze=true**, and paste the job
status from `GET /api/imaging/studies` plus any orchestrator log line.

---

## 4. P4/P5 — 3D [LOCAL]

- Dev-overlay performance numbers: append `?perf=1` to the chart workspace URL.
- E2E: `npx playwright test`.

---

## 5. Environment facts I need from you (once)

```bash
node -v            # I am on v22.22.3; the programme targets Node 20 for CI
docker --version
npx prisma -v
```

Paste the output of `./scripts/verify-local.sh` and `./scripts/verify-ai.sh`
and I will reconcile them with my sandbox numbers.
