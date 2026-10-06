# Stage A — Deep Repository Audit: Interactive 2D/3D Dental Chart

> Mission: upgrade DenToRa's Odontogram into a production-grade Interactive 2D/3D
> Clinical Dental Chart WITHOUT breaking protected systems.
> This audit was produced before touching any code (Graph/Prompt/Context Engineering).

## 1. Existing Odontogram (Phase 3 — PROTECTED, imported never modified)

| File | Lines | Role |
|---|---|---|
| `components/dental-chart/types/odontogram.ts` | 132 | Domain types: 16 tooth classes, 16 `DentalCondition`s, 5 surfaces, `ToothViewModel`, `DentalChartEntryRecord` |
| `components/dental-chart/geometry/tooth-paths.ts` | 1468 | Clean-room SVG vector geometry (16 tooth classes) |
| `components/dental-chart/adapters/dental-chart-adapter.ts` | 415 | `buildToothViewModels`, `calculateOdontogramStats`, `ALL_FDI_TEETH`, `TOOTH_NAMES` (English) |
| `components/dental-chart/odontogram/Odontogram.tsx` | ~600 | Client component: fetches `/api/dental-chart`, condition filter, surface dialog, legend, stats |
| `components/dental-chart/odontogram/ToothCell.tsx` | 147 | Already keyboard accessible: `tabIndex`, `aria-label`, `aria-pressed`, Enter/Space handling |
| `components/dental-chart/odontogram/*` | — | `ArchGrid`, `Quadrant`, `ToothSVG`, `ToothSurfaces`, `ToothTooltip`, `SurfaceSelectorDialog`, `OdontogramLegend`, `OdontogramStats`, `ToothHistoryTimeline` |
| `components/dental-chart/dental-chart.tsx`, `components/treatments/dental-chart.tsx` | — | Facade wrappers around `Odontogram` |
| `app/(dashboard)/patients/[id]/odontogram/page.tsx` | — | Standalone route (Phase 11 navigation target) |

## 2. Tooth numbering

**FDI / ISO-3950** — quadrants 1–4 × teeth 1–8 (11–48). Confirmed in `ALL_FDI_TEETH`,
API validation message ("Invalid tooth number. Use FDI notation (11-18, 21-28, 31-38, 41-48)")
and `components/imaging/dental-3d-viewer.tsx` quadrant maps.

## 3. Clinical states (existing — reused, not duplicated)

- **Conditions (DB enum `ToothCondition`, 14):** HEALTHY, CARIES, FILLED, CROWN, BRIDGE,
  IMPLANT, ROOT_CANAL, EXTRACTION, MISSING, FRACTURED, SENSITIVE, MOBILITY, ABSCESS, PERIODONTAL
  (TS type adds client-side `EXTRACTION_NEEDED`, `VENEER` — POST must validate to the DB enum).
- **Severity:** MILD | MODERATE | SEVERE. **Resolution:** `resolvedDate` (isActive filter).
- **Surfaces:** mesial, distal, occlusal, buccal, lingual (booleans per entry).

## 4. Data models (prisma/schema.prisma)

- `DentalChartEntry` (783): hospitalId, patientId, toothNumber Int, toothNotation, 5 surface
  booleans, condition, severity, notes, diagnosedDate, resolvedDate. Indexed on hospital/patient/tooth.
- `TreatmentPlan` (880) / `TreatmentPlanItem` (930): `toothNumbers String?` (comma-separated
  FDI list), `status` PENDING→SCHEDULED→IN_PROGRESS→COMPLETED/CANCELLED, `procedureId`, `estimatedCost`.
- `InvoiceItem.toothNumber Int?` (1226, Phase 12 clinical context).
- `ImagingStudy` (3487) + `AIAnalysisJob` (3523): **tooth linkage only inside findings JSON**
  (`acceptedFindings Json?` — reviewed AI findings; no dedicated tooth column). READ-ONLY for this feature.
- `AuditLog` (2139): hospitalId, userId, action, entityType, entityId, oldValues/newValues.

## 5. APIs (existing)

- `/api/dental-chart` — GET (filters: patientId, toothNumber, condition, isActive), POST (create
  finding; requires patientId+toothNumber+condition; FDI-validated).
- `/api/dental-chart/[id]` — GET / PATCH / DELETE.
- `/api/treatment-plans/[id]/items` — POST: already `['ADMIN','DOCTOR']` ✅.
- **RBAC (corrected during implementation):** dental-chart routes call `requireAuthAndRole()`
  without a role list for GET (view — correct), but the MUTATION handlers carry inline
  `['ADMIN','DOCTOR']` checks — role restriction was already correct; what was missing was a
  **test pin** for it. Added pins; behavior preserved.
- **Audit gaps found (real):** no `auditLog.create` on any dental-chart mutation or procedure
  assignment → added (`DENTAL_FINDING_ADDED`, `TOOTH_STATE_CHANGED`, `PROCEDURE_ASSIGNED`);
  an audit-write failure surfaces as 500 (trail never silently skipped).

## 6. RBAC

`requireAuthAndRole(allowedRoles?)` (lib/api-helpers.ts:84) → `{error, user, hospitalId, session}`.
Roles: SUPER_ADMIN, ADMIN, DOCTOR, RECEPTIONIST, LAB_TECH, ACCOUNTANT, PATIENT.
Tenant pattern proven in GET: patient verified `findFirst({id, hospitalId}}` → 404 otherwise.

## 7. i18n

Flat dotted keys: `locales/ar.json` (5720 keys) + `locales/en.json`.
`useLanguage().t(key)` → `translateText(locale, key)`: key lookup → English reverse-index →
passthrough. **Missing keys silently pass through** → every new string must be added to BOTH files.
Existing keys: `ui.dental_chart`, `clinical.odontogram`, `toothCondition.*`.

## 8. Tests (current, all green)

| Suite | Count |
|---|---|
| `tests/unit/odontogram-clean-room.test.ts` | 13 |
| `tests/components/odontogram-clean-room.test.tsx` | 11 |
| `tests/api/dental-chart-routes.test.ts` | 21 |
| `tests/e2e/dental-chart.spec.ts` (Playwright, not in vitest suite) | 8 |
| Adjacent dental AI: `ai-context-tooth` (9) + `intelligence-dental-brain` (11) | 20 |
| **Dental-related total (vitest)** | **65** |

(The prompt's "195 protected tests" is historical; the operative invariant is:
**every current dental + full-suite test stays green.**)

## 9. Gaps → this mission

1. **No 3D view.** `components/imaging/dental-3d-viewer.tsx` is CSS-based (not WebGL) and
   belongs to imaging — it stays untouched; the new chart needs REAL 3D (WebGL).
2. **No shared 2D↔3D selection state.**
3. **No per-tooth aggregate** (findings + procedures + imaging + treatment status in one payload).
4. Mutation RBAC too loose; **no audit trail on chart/procedure mutations**.
5. No clinical context panel; no Arabic tooth-name map (adapter names are English-only).
6. No unified treatment-status derivation (healthy/affected/planned/in_progress/completed/missing).
7. Arrow-key navigation between adjacent teeth; split view; WebGL fallback.

## 10. Architecture decision (Stage E)

**Chosen: React Three Fiber 9.8 + three 0.186 + drei 10.7** (installed and verified against
React 19.2 / Next 16). Rationale: React-idiomatic declarative scene graph, per-tooth pointer
picking without manual raycasting, `frameloop="demand"` for render-on-demand, dynamic
`import()` with `ssr:false` for SSR bypass, tree-shakeable (drei used only for `OrbitControls`).
Babylon rejected (larger bundle, weaker React integration); bare three rejected (manual
React lifecycle/picking plumbing duplicates R3F). Procedural original geometry (no external/
proprietary assets), structured so meshes can be swapped for anatomical GLTFs later.
State: **zustand 5** (explicit dependency; single store consumed by 2D, 3D and the panel).

## 11. Constraint compliance plan

- Protected Phase-3 components imported, never modified; new code in
  `components/dental-chart/interactive/*` + `lib/dental-chart/*` + additive API/page/locales.
- No AI engine changes (read-only `acceptedFindings`); no cloud AI; tenant isolation on every
  query; audit via existing `AuditLog`; procedures via existing Phase-11 APIs; schema: **no changes**.
