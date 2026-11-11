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

---

## 6. P4/S3 — what to EYEBALL on a real GPU (PATCH 2 and PATCH 6)

Both patches were written and unit-tested, but **neither has ever run on a
GPU**. A unit test cannot tell you whether a tooth looks right, or whether
memory is actually released. These are the things only you can see.

### 6.1 PATCH 2 — `setToothAppearance`, tint by MULTIPLY

Open the 3D route with a patient who has recorded findings
(`?perf=1` optional), then check:

| # | Eyeball this | Pass looks like | Fail looks like |
| --- | --- | --- | --- |
| 1 | A tooth with a finding | The crown is **tinted toward the status colour but still looks like enamel** — you can still see the shading, crevices and specular highlight through the tint | A flat, painted plastic blob with no shading — that means the tint replaced the colour instead of multiplying it |
| 2 | The **roots** of that same tooth | Tinted with the **same status** as the crown | Crown coloured, roots still healthy-looking — the `cementum-`/`dentine-`/`pulp-<fdi>` keys are not being matched |
| 3 | The neighbouring teeth | Untouched | Bleeding onto neighbours — the prefix match is too loose (`tooth-1` would catch `tooth-11`..`tooth-18`) |
| 4 | A tooth you then **clear** | Returns **exactly** to its original colour, opacity and rim | Slightly off / permanently darker — the saved base colour was overwritten before it was stored |
| 5 | Switching light↔dark theme, then clearing | Still returns to the correct colour for that theme | Wrong colour — the base was captured before a theme change and is stale |

Known limitation to watch for: the base colour is captured the **first time**
a tooth is tinted. If the engine re-themes a material afterwards, the stored
base is stale. Symptom = row 5 above.

### 6.2 PATCH 6 — `dispose` actually frees GPU memory

This is the one a unit test **cannot** prove. Procedure:

1. Open the 3D route. Note `JS heap` from the `?perf=1` overlay.
2. Navigate away (unmount). Wait ~10 s for GC.
3. Navigate back. Repeat **5 times**.
4. Compare heap and GPU memory each cycle.

| Symptom | Verdict |
| --- | --- |
| Heap and GPU memory return to (roughly) the same baseline each cycle | **PATCH 6 works** — geometries/materials/textures are released |
| Memory climbs monotonically, ~the same delta each mount | **Still leaking** — upstream `dispose()` drops the renderer but never released geometry/material/texture |
| Memory climbs, then the WebGL context is lost after N mounts | Leak is severe; also confirms the browser's context limit |

To read GPU memory directly: Chrome DevTools → **Memory** → take a heap
snapshot, or open `chrome://gpu` and watch the process memory for the tab.
`?perf=1` reports the **JS heap only**, which is a proxy — GPU buffers live
outside it, so a flat JS heap does **not** by itself prove PATCH 6 works.

### 6.3 Numbers to read from `?perf=1`

Add `?perf=1` to the 3D route URL. The overlay shows:

| Row | What it is | What to look for |
| --- | --- | --- |
| **initial bytes** | Model/decoded-asset bytes fetched before the first frame | With `ASSET_MODE=none` this should be **0** — no model file is fetched. Non-zero here means an asset slipped through the mode gate |
| **time to first frame** | ms from mount to the first rendered frame | Report the number. There is no budget agreed yet; we are establishing the baseline |
| **FPS while orbiting** | Sustained frame rate during a continuous orbit drag | Should stay smooth and, crucially, **not decay the longer you orbit** — a steady decline suggests per-frame work that grows (a leak) |
| **JS heap** | `performance.memory.usedJSHeapSize` | Compare across the 5 mount/unmount cycles in 6.2 |

**Send me:** the four numbers above, once on the ProceduralScene fallback
(`ASSET_MODE=none`, the default) and — only if you later enable assets — once
with `ASSET_MODE=local`.

> `?perf=1` is part of step 3 and lands with the dev route
> `app/(dashboard)/patients/[id]/dental-chart-3d`. It does not exist yet at
> the commit that adds this section.
