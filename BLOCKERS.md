# BLOCKERS.md — things this environment cannot do

Each entry: what is blocked, the proof, and the **exact command the user must run**.
Nothing here is faked or mocked.

---

## B1 — Cannot check out `wip/realistic-teeth-anatomy`

**Proof:** session is pinned to `arena/91dddda0-dental-clinic-system`; branch switching/creation is
not permitted for this session. The branch itself exists on origin:

```
$ git ls-remote --heads origin wip/realistic-teeth-anatomy
d8c28ae58cb18c76026c04cf72e8b2153f427be7	refs/heads/wip/realistic-teeth-anatomy
```

**User action:** start a new Arena session on `wip/realistic-teeth-anatomy`, or run from `C:/Projects/dental-erp-dental-chart`.
Consequence of staying here: the WIP tooth-anatomy rewrite at `d8c28ae` is absent, so WP1 H1/H4
cannot be tested.

---

## B2 — Docker is not installed (blocks WP2 entirely)

**Proof:** `docker --version` → `command not found`.

**User action (Windows, PowerShell, in `C:/Projects/dental-erp-dental-chart`):**
```powershell
docker --version
docker compose -f ai-compose.yml up -d --force-recreate
docker compose -f ai-compose.yml ps
curl http://localhost:8000/health
for ($p=8001; $p -le 8005; $p++) { curl "http://localhost:$p/health" }
```

---

## B3 — AI model files are absent (blocks WP2 step 1 checksums)

**Proof:**
```
$ ls ai-validation/*/model/
ai-validation/dentalgemma/model/:  README.md
ai-validation/liodon/model/:       README.md
ai-validation/meshsegnet/model/:   README.md  source
```
No `.onnx`, `.pt`, `.pth` or `.zip` present, so **no SHA-256 can be computed or compared**.
Models are gitignored, matching the master prompt's note.

**User action (Windows, Git Bash, from `C:/Projects/dental-erp`):**
```bash
cd /c/Projects/dental-erp
sha256sum ai-validation/liodon/model/best.onnx \
          ai-validation/yolov8-8024/model/8024.pt \
          ai-validation/cldetection2023/model/model_pretrained_on_train_and_val.pth \
          ai-validation/meshsegnet/model/MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip \
          ai-validation/meshsegnet/model/MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip
```
Compare against the five checksums in the master prompt §2. **A mismatch = stop, do not proceed.**
Note `ai-validation/yolov8-8024/` and `ai-validation/cldetection2023/` do not exist in this clone.

To make models available in the chart worktree without committing them:
```bash
cp -r /c/Projects/dental-erp/ai-validation/liodon/model/best.onnx \
      /c/Projects/dental-erp-dental-chart/ai-validation/liodon/model/
cp -r /c/Projects/dental-erp/ai-validation/yolov8-8024/model/8024.pt \
      /c/Projects/dental-erp-dental-chart/ai-validation/yolov8-8024/model/
```

---

## B4 — Prisma client cannot be generated

**Proof:** `postinstall: prisma generate` reaches `binaries.prisma.sh`, which is outside the network
allowlist. `node_modules/.prisma/client` is absent. This is why `tsc` reports 498 errors and why
`tests/api/imaging-review.test.ts` and `tests/unit/dev-start-env.test.ts` fail.

**User action:**
```bash
npx prisma generate
```
Then re-run `npx tsc --noEmit` to get a true type-error baseline.

---

## B5 — `npm run build` not yet measured

Next.js build runs type checking, which currently fails on the 498 Prisma-derived errors.
Expect a non-zero exit until B4 is resolved.

---

## B6 — CS-RESTO-007: **RESOLVED 2026-10-27** (was: decision needed)

Root cause is established and pasted in `PROGRESS.md`: the old validator was a range check
(`11 <= n <= 48`) that wrongly accepted `30`; FDI-52 replaced it with set membership, so `30` is
now correctly rejected and the agent asks for a tooth instead of completing.

**Resolved under an explicit, scoped user directive** (neither "change agent behaviour" nor "just
relax it" — a third course): the golden's `expected.status` was corrected to
`["CLARIFICATION_REQUIRED"]` and `mustContain` to `["Which tooth"]`, with the full justification
written into the case's `description` (the only field that survives — the Zod schema is non-strict and
strips unknown keys, and **there is no `comment` key** in this dataset). A new case `CS-FDI-021`
("Assess the restoration on tooth 19") pins the same guarantee: an invalid tooth must produce
`CLARIFICATION_REQUIRED` + the honesty marker, never a fabricated finding. Committed as `8fba370`.

All 3 previously-failing tests now pass; `tests/evaluation/clinical-safety-eval.test.ts` is
**25/25**. Case count 20 → 21; the results artifact was regenerated through the project's own
`DENTORA_WRITE_BENCH=1` path.

**Correction to the record:** a later report described the CS-RESTO-007 case definition as "printed
before any edit". That was **wrong** — the text printed was read from the post-edit working tree and
already contained the `EXPECTATION UPDATED` paragraph. The pre-edit state is recoverable from
`git show 8fba370^:tests/evaluation/golden/clinical-safety.golden.json`; see the golden audit.

The stale `(11–48)` wording noted below was fixed in `8413911` (Arabic + English clarification
strings and the classifier `missingInfo` string now name the primary range).

---

## B7 — Node version mismatch

`.nvmrc` = **20**; CI (`ci.yml:32,70,110`, `e2e.yml:50`) = **20**; sandbox has **v22.22.3**.
`engines` is not declared in `package.json`, so nothing enforces this. No version manager
(nvm/n/fnm/volta) is installed and `nodejs.org` is not in the network allowlist.
All local test results therefore come from Node 22; **CI on Node 20 is authoritative.**

---

## B8 — Primary teeth need root/canal counts that may NOT be invented

`ToothViewModel.rootCount` and `ToothViewModel.canalCount`
(`components/dental-chart/types/odontogram.ts:84-85`) are **required, non-nullable `number`s**.

Consequence: building a view model for a primary tooth (51-85) forces us to supply root and canal
counts for it. `getToothRootCanalCounts` (adapter `:148`) has **no primary branch** — it derives
`isUpper` from `Math.floor(n / 10) <= 2`, which for every primary tooth returns `false`, so it would
silently assign mandibular permanent values to deciduous teeth.

Per the standing safeguards (no invented primary root/canal counts; gate them behind clinical
review) this cannot be guessed in code. **Needs clinically reviewed primary root/canal counts.**

---

## B9 — `getToothSpecificType` mis-types every primary tooth

`components/dental-chart/geometry/tooth-paths.ts:1464` —

```
const d = toothNumber % 10
const upper = Math.floor(toothNumber / 10) <= 2
```

For all primary teeth (51-85) `upper` is `false`, so every primary tooth is typed
**mandibular**. Additionally the index map sends `4 → first_premolar` and `5 → second_premolar`,
but in the primary dentition indices **4 and 5 are the first and second MOLARS** (there are no
primary premolars). `ToothSpecificType` has **no primary members at all**.

Fixing this is a clinical/anatomy content decision (new type members + corrected mapping), not a
pure refactor.

---

## B10 — `ToothViewModel.quadrant` cannot hold 5-8

`components/dental-chart/types/odontogram.ts:83` declares `quadrant: 1 | 2 | 3 | 4`. Primary
quadrants are 5-8 (Q5 upper-right … Q8 lower-right), so the model cannot represent a primary
tooth's quadrant without widening this union — a data-model change.

---

## B11 — Opt-in mixed dentition is SPIKED and STOPPED, not implemented

`dentition?: 'permanent' | 'mixed'` was added to `OdontogramProps` and threaded through
`Odontogram.tsx` → `ArchGrid.tsx` (primary Q5-Q8 block renders only when `'mixed'`), with
`Quadrant`'s `id` union widened to Q1-Q8. All additive; the default path is byte-identical.

But `dentition='mixed'` **does not fully render primary teeth** — the tooth cells need view models,
which is blocked by **B8–B10**. 2 of 3 new tests pass (proving the default path is unchanged); the
`mixed` test fails on exactly this.

**User directive 2026-10-27: STOP. Do not modify Phase-3 protected types/Odontogram for primary
teeth.** The work is preserved on branch **`spike/odontogram-mixed-dentition`** (commit `7d1800f`,
pushed, verification greps recorded) and is **NOT for merge**. The session branch's tree was
restored to clean.

Resolving B8–B10 requires a data-model + clinical-content decision (primary anatomy, molar vs
premolar mapping, clinically reviewed root/canal counts), not a code change.
