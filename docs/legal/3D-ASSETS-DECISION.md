# D1 — Distribution of the 3D tooth models: DECISION TEMPLATE

> **STATUS: TEMPLATE — NO DECISION HAS BEEN RECORDED.**
>
> This file is the record of decision **D1**. Until the user fills it in and it
> contains the marker `D1-DECISION-RECORDED`, the build refuses
> `ASSET_MODE=bundled` (enforced by `lib/dental-chart/3d/asset-mode.ts` and
> pinned by `tests/unit/asset-mode.test.ts`).
>
> **Default in the meantime: `ASSET_MODE=none`** — no third-party mesh is
> shipped and the 3D view uses the procedural fallback.

## Why a decision is needed

The engine code is MIT and is vendored. The **meshes are a different work**
with different terms, and the sources disagree about what those terms are:

| Source | States | Where |
| --- | --- | --- |
| dental-scope `CREDITS.md` (upstream, vendored) | **CC BY-SA 2.1 Japan** for the tooth meshes (BodyParts3D, DBCLS) | `vendor/dental-scope-engine/CREDITS.md` |
| DBCLS licence page, last updated **2025-02-27** | **CC BY 4.0** (no ShareAlike) | https://dbcls.rois.ac.jp |
| dental-scope `CREDITS.md` | Written content **CC BY-SA 4.0** | same file |
| `neurovascular.glb` | **CC BY-SA 4.0** (Z-Anatomy) — **never loaded by us, in any mode** | same file |

The DBCLS **download page serves only BodyParts3D 4.0**, while the meshes used
here are attributed to **Release 3.0**. The 2025 CC BY 4.0 statement postdates
Release 3.0 by roughly 13.5 years and Release 4.0 by about 11.7 years, and is
not version-scoped.

Full research trail: `docs/dental-chart/ASSETS.md`.

## The questions for counsel

1. Does **CC BY-SA 2.1 JP** on the model files extend to an application that
   loads them as **separate data** at runtime (not compiled or linked into the
   binary), or does it attach only to the files themselves?
2. Is **meshopt-compressing or restructuring a GLB** an *adaptation* under that
   licence, and if so, who must be attributed for the adaptation?
3. Is publishing the model pack **separately**, under the same licence and with
   attribution, sufficient to satisfy ShareAlike for an app that merely loads
   it — or does ShareAlike reach the application?
4. Which licence governs **BodyParts3D Release 3.0** specifically, given the
   DBCLS site's CC BY 4.0 statement dated 2025-02-27 is **not version-scoped**
   and postdates Release 3.0 by ~13.5 years?

## How to record the decision

Answer the four questions above, then append:

```
D1-DECISION-RECORDED
Decision: <ship | do not ship> 3D models with the product.
Decided by: <name, role>
Date: <YYYY-MM-DD>
Basis: <counsel's answers, or a short reference to them>
Mode permitted: <bundled | local | none>
```

Once that marker is present, `ASSET_MODE=bundled` becomes available. Nothing
else in the build changes — the mode gate reads this file and nothing more.

## Notes

* `ASSET_MODE=local` (models in `.local-assets/3d/`, served by an
  authenticated route, never from `/public`) does **not** require D1: nothing
  is distributed to a third party.
* Even with D1 recorded, `neurovascular.glb` is **never** fetched or loaded.
* The Arabic credits page must be shown whenever `ASSET_MODE != none`.
