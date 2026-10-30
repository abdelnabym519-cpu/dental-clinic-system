# P2-procedural — step 4 verification + step 5 proposal

Step 4 (per-class crown geometry) is committed as `7101f96`. This document is the
screenshot checklist and measured numbers step 4 owes, plus the step 5 primary
teeth proposal, which is **awaiting approval**.

Everything here is stylized-realistic procedural geometry. It is not
scan-realistic and must never be described as photorealistic or clinically
accurate.

---

## 1. Measured numbers

| Quantity                            | Value                                                             |
| ----------------------------------- | ----------------------------------------------------------------- |
| Shared crown geometries (permanent) | **16** (one per anatomical class)                                 |
| Triangles, all 16 crowns            | **15,664**                                                        |
| Triangles per crown (average)       | **979**                                                           |
| Geometries if all 52 teeth rendered | 19 (16 classes + 3 primary groups — primary has no premolars)     |
| Triangles if all 52 rendered        | 18,368                                                            |
| `frameloop`                         | `"demand"` (already set, unchanged)                               |
| Dispose on unmount                  | yes (`getShared().dispose()` in a `useEffect` cleanup, unchanged) |

Before step 4 the renderer built **4** shared crowns (one per group). It now
builds **16**, so every permanent tooth draws its own anatomical class.

### Spacing (all measured, not estimated)

44 adjacent pairs across all 52 ids. All clear the 0.01 tolerance:

|                      | Worst pair | Value                               |
| -------------------- | ---------- | ----------------------------------- |
| Adjacent clearance   | 36-37      | **-0.0041** (a gap, not an overlap) |
| Inter-arch clearance | 13 vs 43   | **+0.2600**                         |

Before step 2 all 44 pairs interpenetrated; the worst (54-55) by 0.2048.

Arch angles now solved per class and per arch:

| Arch                       | Span           | Max \|x\| |
| -------------------------- | -------------- | --------- |
| Upper (maxillary classes)  | 3.66° → 64.33° | 2.118     |
| Lower (mandibular classes) | 2.07° → 56.58° | 1.962     |
| Primary (group extents)    | 3.41° → 41.23° | 1.549     |

Both permanent arches stay on the same ellipse (`ARCH_X` 2.35, `ARCH_Z` 3.1), so
each jaw is still one continuous arch meeting at the midline. The lower arch is
now genuinely smaller and nests inside the upper one.

---

## 2. Screenshot checklist

**I could not take these screenshots.** This sandbox has no browser or display,
so the visual result is **unverified by me**. Capture them on a machine with the
dev server running (`npm run dev`), then open the 3D dental chart.

The camera presets available are `default`, `front`, `top`, `side`.

### A. Upper arch (maxillary)

- Camera: `top`, then `front`.
- [ ] All 16 upper teeth present, 8 per side, no gaps at the midline.
- [ ] The two central incisors (11, 21) meet at the midline without a visible
      seam **and** without merging into one block.
- [ ] Walking back from 11 → 18, each tooth is visibly distinct from its
      neighbour: no two crowns interpenetrate.
- [ ] Third molars (18, 28) sit at the back of the arch, angled ~64°, not
      poking through their neighbours.
- [ ] Tooth size decreases incisor → molar is **not** expected: molars are the
      widest. Confirm molars look widest and central incisors narrow.

### B. Lower arch (mandibular)

- Camera: `top`, then `front`.
- [ ] All 16 lower teeth present.
- [ ] Lower central incisors (31, 41) are visibly **narrower** than the upper
      central incisors (11, 21). This is the step 4 change: mandibular central
      incisor is 0.17 wide, maxillary is 0.30.
- [ ] The lower arch is visibly **narrower and shorter** than the upper arch
      from the `top` view, and sits inside it.
- [ ] No interpenetration between 31-32, 33-34, 36-37 (the tightest pairs).
- [ ] Lower molars look wider than upper molars (0.4115 vs 0.3798).

### C. Mixed view (both arches together)

- Camera: `default`, then `side`.
- [ ] Upper and lower arches are separated vertically; no upper crown touches a
      lower crown (measured gap 0.2600 at the tightest, 13 vs 43).
- [ ] Upper teeth overlap **outside** the lower teeth when viewed from `top` —
      normal overbite/overjet relationship, lower arch nested inside upper.
- [ ] From `side`: crowns point at the occlusal plane, roots point away, upper
      crowns point **down**, lower crowns point **up**.
- [ ] No tooth is missing, duplicated, or floating away from the arch.
- [ ] `missing` status teeth render as a socket only, no crown.

### Known good / known risks

- Crown shapes are unchanged in character — only the _width/depth_ per class
  changed, plus the spacing. If a crown looks malformed (not merely a different
  size), that is a new defect worth reporting.

---

## 3. Step 5 — primary teeth proposal (AWAITING APPROVAL)

**No primary tooth code has been written.** Rendering is blocked until this is
approved.

### Current state

`DentalChart3D` iterates `FDI_TEETH`, which is the **32 permanent teeth only**.
The 20 primary teeth (51-55, 61-65, 71-75, 81-85) are **not rendered at all**.
They exist in the FDI data model, in the odontogram, and now in the arch solver,
but not in the 3D scene.

### Constraint

`ANATOMICAL_SPECS` covers the 16 permanent classes. There is **no primary tooth
spec**. Step 3 removed the fallback that silently drew primary teeth as a
maxillary central incisor. Step 4 kept primary teeth on the group master purely
as a data-source detail; nothing renders them.

I will not invent root or canal counts. Primary teeth have genuinely different
anatomy — shorter crowns, relatively larger pulps, and roots that resorb — none
of which is in the repo.

### Proposal: crown-only schematic

Render primary teeth as a **crown-only schematic**, clearly marked as such.

1. **Geometry**: reuse `buildCrownGeometry(groupOf(n))`, the existing group
   master, scaled down to primary proportions. No roots, no pulp, no cusps.
   - Rationale: it needs no new anatomy facts. It is already the geometry the
     spacing solver uses for primary teeth (`CROWN_GROUP_EXTENTS`), so spacing
     stays correct with no further solver work.
2. **Crown only**: no root mesh. A primary tooth with no root is honest; a
   primary tooth with a borrowed permanent root system is a lie about anatomy.
3. **Visual distinction**: desaturated / matte material, distinctly different
   from the permanent enamel material, so a primary tooth is never mistaken for
   a permanent one at a glance.
4. **Legend label**: a persistent legend entry reading
   "Primary (deciduous) teeth — schematic crown only, not anatomically
   modelled", in both Arabic (RTL) and English. This is the label the step 5
   brief asks for.
5. **Spacing**: already solved (`PRIMARY_ANGLES`, group extents, 5 per
   quadrant). No change needed.
6. **Tests**: extend `tooth-arch-spacing.test.ts` so the 20 primary teeth are
   covered by the no-overlap contract (currently all 44 adjacent pairs include
   the 16 primary pairs, and they pass) and assert primary teeth render with no
   root mesh.

### What I need from you

- Approve the crown-only schematic, or
- Reject it and tell me what primary teeth should look like instead.

I will not start until you reply.

---

## 4. Not verified by me

- **All visuals.** No browser in this sandbox. Section 2 is a checklist for you,
  not a report of what I saw.
- **Runtime behaviour** of the R3F scene (hover, click, selection, orbit). Only
  the pure placement math is unit-tested.
- **Prisma-dependent suites** (`tests/api/imaging-review.test.ts`,
  `tests/unit/dev-start-env.test.ts`) fail here because the Prisma client is not
  generated in this sandbox. Same two failures as the baseline, not caused by
  this work.
