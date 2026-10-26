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

## B6 — CS-RESTO-007: mechanism proven, **decision needed** (was: root cause unknown)

Root cause is established and pasted in `PROGRESS.md`: the old validator was a range check
(`11 <= n <= 48`) that wrongly accepted `30`; FDI-52 replaced it with set membership, so `30` is
now correctly rejected and the agent asks for a tooth instead of completing.

**The golden file has NOT been edited** (user rule 6: never weaken or edit a golden / clinical-safety
test to get green). Until you decide, these 3 tests fail:

- `CS-RESTO-007: … no invented association`
- `global invariants hold across ALL cases`
- `writes the machine-readable clinical-safety results artifact`

**Options:**
1. Update the golden: `expected.status` → `["COMPLETED", "CLARIFICATION_REQUIRED"]` and relax/replace
   `mustContain: ["Identity:"]`. *I will not do this without explicit sign-off — it edits a protected gate.*
2. Keep the golden and instead make the agent still surface patient identity when it must ask for a
   tooth (behaviour change in `lib/ai/agent/loop.ts:826-827`, no golden edit).

Note: the clarification string also hardcodes `(11–48)` and `:827` is English — both stale
independently of this decision.

---

## B7 — Node version mismatch

`.nvmrc` = **20**; CI (`ci.yml:32,70,110`, `e2e.yml:50`) = **20**; sandbox has **v22.22.3**.
`engines` is not declared in `package.json`, so nothing enforces this. No version manager
(nvm/n/fnm/volta) is installed and `nodejs.org` is not in the network allowlist.
All local test results therefore come from Node 22; **CI on Node 20 is authoritative.**
