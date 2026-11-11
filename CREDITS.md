# CREDITS — third-party components

This file records what this product owes to other people's work. It is the
source of truth behind the (Arabic-only) credits UI and is maintained
alongside, not instead of, each vendored component's own licence file.

| Component | Licence | Where | Status |
| --- | --- | --- | --- |
| **React Advanced Odontogram** (2D chart engine) | MIT | `vendor/react-advanced-odontogram/` | In use |
| **dental-scope** (3D engine, code only) | MIT | `vendor/dental-scope-engine/` | Vendored; integration in progress |
| **BodyParts3D / DBCLS** tooth meshes | CC BY-SA 2.1 JP per upstream `CREDITS.md`; the DBCLS site states CC BY 4.0 (updated 2025-02-27) — **UNRESOLVED** | not committed | **Blocked by decision D1** |

## Rules this project follows for vendored work

1. **The licence file travels with the code.** Each vendored tree keeps its
   upstream `LICENSE` verbatim, and an upstream `CREDITS.md` is never edited —
   our notes go in that tree's `VENDOR.md` and here.
2. **Code licence ≠ content licence ≠ asset licence.** They are tracked
   separately, and the strictest one governs.
3. **Default is to ship nothing third-party.** `ASSET_MODE=none` is the default
   (see `lib/dental-chart/3d/asset-mode.ts`); models are loaded only after the
   user records decision **D1** in `docs/legal/3D-ASSETS-DECISION.md`.
4. **Deletion is not erasure.** Removing a file from the working tree leaves it
   in git history, which matters for any licence that turns on distribution.
   The CC BY-SA 4.0 content tree removed in P4/S1 is still in history at
   commits up to `0152c65f1f0664dd29daaa6d0b3f5bde0a94fb22`; see
   `docs/dental-chart/ASSETS.md`.

## dental-scope — specifics

* Upstream: https://github.com/Yoosseph/dental-scope
* Pinned commit: `e34d4b986d5439501f23c91cde593f69a3b180b0`
* Vendored: **source code only** — 115 files, 1.5 MB, **0 model files**
  (`git ls-files | grep -Eic '\.glb$'` → `0`).
* The upstream `src/content/` tree (CC BY-SA 4.0 educational prose + unapproved
  `canal-counts.json`) was **removed** and replaced by the empty-data stub
  `vendor/dental-scope-engine/src/stubs/educational-text.ts`.
* `neurovascular.glb` (CC BY-SA 4.0, Z-Anatomy) is **never** fetched or loaded.
* Provenance, exclusions and the S3 hazard list: `vendor/dental-scope-engine/VENDOR.md`.

## Attribution still owed

Attribution text for the credits UI is deliberately **not written yet**: it is
part of P4/S7 and is gated on the user confirming M2. Nothing here should be
read as final attribution wording.
