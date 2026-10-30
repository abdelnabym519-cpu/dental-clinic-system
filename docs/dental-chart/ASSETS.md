# Dental-chart 3D assets — license research (P1)

**Status: RESEARCH ONLY. No third-party asset has been downloaded, imported or
committed.** This file exists to satisfy rule 1 (license evidence) and to record
the gate decision. Nothing here is committed assets — only findings.

User constraint (2026-10-28): assets must be **100% free, no purchase**.
Re-verified from source on the day of writing (2026-10-30).

---

## Summary: no candidate passes. Recommendation = default plan (procedural).

| #   | Candidate                            | License (verified from source)                                 | Commercial use                      | Actual meshes?                                             | One mesh per tooth class?                                                                                                       | Primary teeth                      | Crown/root separable                                | Verdict                                |
| --- | ------------------------------------ | -------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- | -------------------------------------- |
| 1   | **BodyParts3D 4.0** (DBCLS)          | **CC BY 4.0** — official license page, last updated 2025/02/27 | **Yes** (no NC term)                | Yes (OBJ, reduced + high poly)                             | Tooth concepts exist individually, but the published tooth artifact is **one merged dentition** (`BP22611`, concept `FMA12516`) | **No** — adult male reference only | No — each concept is a single mesh (roots included) | Partial: permanent only, not separable |
| 2   | **Open-Full-Jaw** (diku-dk)          | **CC BY-NC-SA 4.0** — from the repository `LICENSE` file       | **NO — NonCommercial + ShareAlike** | Yes (surface + volume, 17 patients / 29 jaws, teeth + PDL) | Yes (per-tooth meshes + principal axes)                                                                                         | No — adult CBCT                    | Yes (teeth and PDL shipped separately)              | **DISQUALIFIED**                       |
| 3   | **STS-Tooth** (Zenodo 10597292)      | CC BY 4.0 (Zenodo record)                                      | Yes, but consent scope contested    | **No — CBCT volumes + masks, not meshes**                  | n/a                                                                                                                             | Children + adults (2D images)      | n/a                                                 | Unsuitable (not meshes)                |
| 4   | Sketchfab "Human teeth" (A. Antipov) | CC Attribution, **version not shown**                          | Unclear                             | ~15.6k tris                                                | Unlikely — character-mouth asset                                                                                                | No                                 | No                                                  | Unsuitable                             |
| 5   | Meshy community "Tooth"              | CC0                                                            | Yes                                 | AI-generated                                               | No                                                                                                                              | No                                 | No                                                  | Unsuitable — no anatomical validation  |

---

## Finding that changes the decision: Open-Full-Jaw is NonCommercial

The session-2 brief recorded Open-Full-Jaw's license as "NOT verified". It is
now verified, and it is **worse than the paper suggests**:

- The **paper PDF** (arXiv 2209.07576) states `License: CC BY 4.0`.
- The **repository `LICENSE` file** — the artifact that actually governs the
  dataset — is
  **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International**.

Verified by fetching `https://raw.githubusercontent.com/diku-dk/Open-Full-Jaw/main/LICENSE`
directly; it opens with "Attribution-NonCommercial-ShareAlike 4.0 International"
and defines `NonCommercial` in Section 1(k). GitHub's own repo metadata also
reports the license as `other`, i.e. not a standard permissive OSI license.

Consequences:

- **NonCommercial** excludes use in a commercial dental practice-management
  product. This alone is disqualifying.
- **ShareAlike** would additionally require derivative works to be licensed on
  the same terms, which is incompatible with the product's licensing.

Open-Full-Jaw was the only candidate with real CBCT-derived, per-tooth,
crown-and-root-capable meshes. With it disqualified, no remaining candidate
covers the requirement.

## BodyParts3D — license verified as clean, coverage is not

License verified from the official page
(`https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html`, last updated
2025/02/27):

> The license for this database is specified in the Creative Commons Attribution
> 4.0 International. […] If you use data from this database, please be sure
> attribute this database as follows: "BodyParts3D, © The Database Center for
> Life Science licensed under CC Attribution 4.0 International"

Permits access, redistribution and derivative works; requires attribution;
**no NonCommercial term, so commercial use is allowed**.

Caveats that matter here:

- **Legacy license contamination.** Older releases and derived artifacts carry
  **CC BY-SA 2.1 Japan** (share-alike) — e.g. the Wikimedia Commons
  `BodyParts3D Tooth.stl` is tagged `CC-BY-SA-2.1-jp`, and BodyParts3D 3.0 OBJ
  files carry that text in their comments. Only the current **4.0** release from
  the official source is safe, and the version used must be recorded.
- **Adult male only.** BodyParts3D is a whole-body adult reference, so it cannot
  supply the **20 primary (baby) teeth** at all.
- **Not separable.** The published tooth artifact is a single merged dentition
  mesh (representation `BP22611`, concept `FMA12516`), and per-concept meshes
  include crown and root in one object. Clinical state colouring needs crown and
  root as separable parts.
- **Reduced-polygon** variants are the practical download; quality unverified.

Net: at best 32 of 52 ids, no primary teeth, no crown/root separation.

## STS-Tooth

Zenodo record 10597292 states `License: cc-by-4.0`. But it ships **CBCT volumes
and segmentation masks, not surface meshes**, so it cannot be dropped into a
glTF pipeline without building a segmentation→mesh extraction pipeline. The
paper describes participant consent for non-commercial academic communication
use, which conflicts with commercial deployment even where the Zenodo license
says CC BY 4.0. Treat as unsuitable.

---

## Recommendation

**Adopt the default plan: improved procedural geometry.** It is 100% free,
requires no attribution, has no license contamination risk, and can cover all 52
ids including primary teeth, with crown and root as separate objects by
construction.

The honest caveat that must accompany it (rule 2): procedural geometry is
**stylized-realistic, not scan-realistic**. It will not look like a scanned or
professionally modelled tooth. It must never be described as photorealistic or
clinically accurate.

## Free-only fallbacks (no purchase, no commission)

- **(a) User-supplied set carrying a free license.** If the user can supply
  per-tooth meshes (16 permanent classes + 10 primary classes, crown and root
  separable) with a written license permitting commercial use, we will adopt
  them. Each file still needs its own entry above and an attribution record.
- **(b) Improved procedural geometry — the default**, as recommended.

## Required attribution if (a) is later adopted

If a CC BY asset is adopted, an in-app **Credits** page must carry the exact
attribution text verbatim, e.g. for BodyParts3D:

    BodyParts3D, © The Database Center for Life Science licensed under
    CC Attribution 4.0 International

plus the release/version used and the date checked.

---

**Awaiting the user's choice. No asset has been downloaded into the repo.**
