# ARCHITECTURE.md

## Chart data flow

```mermaid
graph TD
    subgraph UI["Chart UI"]
        W["DentalChartWorkspace.tsx"]
        C2["DentalChart2D.tsx"]
        C3["DentalChart3D.tsx"]
        OG["Odontogram (Phase-3 protected clean room)"]
        AD["adapters/dental-chart-adapter.ts"]
        TA["interactive/tooth-anatomy.ts"]
        ST["chart-state.ts (zustand, single store)"]
    end

    subgraph API["API layer"]
        R1["GET/POST /api/dental-chart"]
        R2["GET/PUT/DELETE /api/dental-chart/[id]"]
        R3["GET /api/dental-chart/[id]/summary"]
        R4["POST /api/treatment-plans/[id]/items"]
    end

    subgraph DOMAIN["Domain"]
        FDI["lib/dental-chart/fdi.ts  <-- CANONICAL FDI RULE SET"]
        AIFDI["lib/ai/context/fdi.ts  (re-exports isValidFdi)"]
    end

    subgraph DB["Prisma / MySQL"]
        DCE["DentalChartEntry.toothNumber Int, toothNotation String"]
        TPI["TreatmentPlanItem.toothNumber String?"]
        TRT["Treatment.toothNumber String?"]
        INV["InvoiceItem.toothNumber Int?"]
        LAB["LabOrder.toothNumber String?"]
    end

    W --> C2
    W --> C3
    OG --> AD
    C3 --> TA
    C3 --> FDI
    C2 --> FDI
    W --> FDI
    C2 --> ST
    C3 --> ST
    W --> R1
    W --> R2
    W --> R3
    R1 --> FDI
    R4 --> FDI
    R1 --> DCE
    R3 --> DCE
    R4 --> TPI
    DCE --> TRT
    DCE --> INV
    DCE --> LAB
    AIFDI --> FDI
```

## AI runtime

```mermaid
graph LR
    N["Next.js app"] -->|ORCHESTRATOR_SECRET| O["orchestrator :8000 (FastAPI, main.py)"]
    O --> E1["liodon :8001 — panoramic"]
    O --> E2["implant-ai :8002 — periapical/bitewing"]
    O --> E3["orthodontic-ai :8003 — cephalometric, 38 landmarks"]
    O --> E4["meshsegnet :8004 — .obj jaw segmentation"]
    O --> E5["dentalgemma :8005"]
    O --> V["orchestrator validation.py (score clamp)"]
```

## Tooth-number persistence (verified — **no migration required**)

| Model               | Column          | Type                    | Notes                                         |
| ------------------- | --------------- | ----------------------- | --------------------------------------------- |
| `DentalChartEntry`  | `toothNumber`   | `Int` NOT NULL          | no CHECK constraint; 51–85 already storable   |
| `DentalChartEntry`  | `toothNotation` | `VARCHAR(191)` NOT NULL | non-unique index only                         |
| `TreatmentPlanItem` | `toothNumber`   | `String?`               |                                               |
| `Treatment`         | `toothNumber`   | `String?`               |                                               |
| `InvoiceItem`       | `toothNumber`   | `Int?`                  | added in `20260925120000_add_billing_phase12` |
| `LabOrder`          | `toothNumber`   | `String?`               |                                               |

`grep CHECK` across all migrations returns **no tooth-column constraint**. The 32-tooth limit is
**100% application-layer**. `toothNumber INT` already stores 51–85.

## FDI consumer inventory (verified by grep)

**Canonical:** `lib/dental-chart/fdi.ts`

**Imports of the canonical module**

- `app/api/treatment-plans/[id]/items/route.ts:4` — `isValidFdi`
- `components/dental-chart/interactive/DentalChart2D.tsx:20` — `navigationTargets`
- `components/dental-chart/interactive/DentalChart3D.tsx:22` — `FDI_TEETH`, `groupOf`
- `components/dental-chart/interactive/DentalChartWorkspace.tsx:25` — `isValidFdi`
- `components/dental-chart/interactive/ToothContextPanel.tsx:25` — `toothNameAr`, `toothNameEn`
- `components/dental-chart/interactive/tooth-3d.ts:12` — `archOf`, `groupOf`, `sideOf`, `toothIndexOf`, `isValidFdi`
- `components/dental-chart/interactive/tooth-anatomy.ts:20` — `groupOf`, `archOf`, `toothIndexOf`

**Imports of the AI adapter** (now re-exported from canonical — one rule set)

- `app/api/ai/context/route.ts:23`
- `lib/ai/agent/classifier.ts:15` (used at `:409`)
- `lib/ai/voice/entity-resolution.ts:13` (used at `:150`)

**Still-divergent / permanent-only sites (NOT yet migrated)**

| Site                                                               | Issue                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `lib/ai/agent/classifier.ts:392`                                   | comment "11–48 only"                                                               |
| `lib/ai/agent/classifier.ts:1196`                                  | `missingInfo: 'valid FDI tooth number (11–48)'`                                    |
| `lib/ai/agent/loop.ts:826-827`                                     | clarification strings hardcode `(11–48)`; **also English** (Arabic-only violation) |
| `lib/ai/agent/tools.ts:221-222`                                    | `toothFdi < 11 \|\| toothFdi > 48`                                                 |
| `app/api/dental-chart/route.ts:131-136`                            | hardcoded 32-item array                                                            |
| `app/api/dental-chart/[id]/summary/route.ts:58,203`                | clamps `< 11 \|\| > 48`, silently drops findings                                   |
| `components/dental-chart/adapters/dental-chart-adapter.ts:100-104` | `getToothQuadrant` silently `return 1`                                             |
| `components/dental-chart/types/odontogram.ts:16-33`                | `ToothSpecificType` has 16 permanent members, no primary                           |
| `components/dental-chart/adapters/dental-chart-adapter.ts:107-132` | permanent-only root/canal table                                                    |

**Protected:** the Phase-3 odontogram clean room + its tests must keep passing unchanged.
