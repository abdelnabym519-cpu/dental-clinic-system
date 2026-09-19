# Clean-Room Odontogram Design Contract — DenToRa

---

## 1. Executive Summary & Legal / Provenance Boundary

This document specifies the architectural design, user experience model, mathematical SVG geometry, and data contracts for the newly authored **DenToRa Interactive Odontogram**.

### Legal & Provenance Boundary Declaration
- **Clean-Room Authorship**: All source code, React components, TypeScript interfaces, SVG geometry paths, styling, and mathematical curves are authored from scratch specifically for DenToRa.
- **Reference Model**: DentalPin was analyzed strictly as an observational behavioral reference for dental workflow patterns (quadrant layout, anatomical dual-view, surface subdivision, condition visualization, and multi-selection).
- **Zero Code/Asset Copying**: No Vue components, Nuxt composables, FastAPI backend endpoints, or proprietary SVG path assets (such as `ToothSVGPaths.ts` or `ImplantSVG.vue`) are copied or imported.
- **System of Record**: DenToRa remains the sole system of record for persistence, NextAuth authentication, multi-tenant isolation (`hospitalId`), and RESTful API handling.

---

## 2. Reference Study: DentalPin Architectural Reverse-Engineering

### 2.1 Visual Structure & Information Architecture
- **Arch Layout**: Standardized two-tier maxillary (upper arch) and mandibular (lower arch) arrangement organized in four anatomical quadrants:
  - **Quadrant 1 (UR)**: Teeth 18 to 11 (Maxillary Right)
  - **Quadrant 2 (UL)**: Teeth 21 to 28 (Maxillary Left)
  - **Quadrant 3 (LL)**: Teeth 31 to 38 (Mandibular Left)
  - **Quadrant 4 (LR)**: Teeth 41 to 48 (Mandibular Right)
- **Tooth Anatomy Proportions**:
  - **Crown Component**: Anatomical coronal profile containing 5 distinct interactive surfaces: Mesial ($M$), Distal ($D$), Occlusal/Incisal ($O/I$), Buccal/Vestibular ($B/V$), and Lingual/Palatal ($L/P$).
  - **Root Component**: Anatomical radicular profile reflecting specific morphology by tooth group:
    - *Upper Molars (18-16, 26-28)*: Trifurcated (3 roots: Mesiobuccal, Distobuccal, Palatal).
    - *Lower Molars (48-46, 36-38)*: Bifurcated (2 roots: Mesial, Distal).
    - *Premolars (15-14, 24-25, 45-44, 34-35)*: Single to bifurcated tapered roots.
    - *Anteriors / Canines (13-11, 21-23, 43-41, 31-33)*: Single prominent tapered root.
  - **Pulp Chamber & Canals**: Central endodontic vascular channel pathing from pulp chamber through root apices.
- **Visual Status Overlays**: Distinct geometric markers overlaid on tooth anatomy for Restorative, Endodontic, Prosthodontic, and Periodontal conditions.

### 2.2 Interaction & Behavioral Model
- **Hover Feedback**: Real-time anatomical highlight of hovered tooth and individual surface polygons with immediate tooltip displaying tooth nomenclature, active clinical findings, and surface annotations.
- **Single-Click Workflow**:
  - *Clinical Mode*: Opens condition and surface annotation dialog for diagnosing conditions (Caries, Filling, Crown, Root Canal, Implant, etc.).
  - *Treatment Selection Mode*: Toggles tooth selection state in a multi-tooth array for procedure planning and billing estimation.
- **Surface Selection**: Individual clickable surface sectors allowing multi-surface restorations (e.g., MOD, MO, DO, OB, etc.).
- **Timeline / History**: Displays sequential historical modifications for each tooth over time.

---

## 3. DenToRa Data Model & Gap Analysis

| Capability / Feature | DentalPin Reference | DenToRa System of Record | Architecture Strategy |
| :--- | :--- | :--- | :--- |
| **Data Persistence** | PostgreSQL / JSONB | MySQL 8.4 via Prisma `DentalChartEntry` | Map directly to `DentalChartEntry` fields (`mesial`, `distal`, `occlusal`, `buccal`, `lingual`, `condition`, `severity`, `notes`, `diagnosedDate`, `resolvedDate`). |
| **Tooth Numbering** | FDI (11–48) | FDI (11–48) | 100% Native FDI support. |
| **Surface Breakdown** | 5 surfaces (M, D, O, V, L) | 5 boolean fields (`mesial`, `distal`, `occlusal`, `buccal`, `lingual`) | 1:1 direct boolean mapping. |
| **Implant Representation** | SVG overlay | `condition = 'IMPLANT'` | Render authored titanium fixture screw geometry replacing anatomical root. |
| **Root Canal Treatment** | Endodontic pin | `condition = 'ROOT_CANAL'` | Render authored gutta-percha obturation lines traversing root canals to apices. |
| **Crown & Restoration** | Coronal cap / fill | `condition = 'CROWN'`, `condition = 'FILLED'` | Render gold/porcelain crown contour or composite filling texture across affected surfaces. |
| **Bridge Representation** | Multi-tooth link | `condition = 'BRIDGE'` + span metadata | Render pontic and abutment connector span across missing and anchor teeth. |
| **Periodontal & Mobility** | Periodontal depth | `condition = 'PERIODONTAL'`, `condition = 'MOBILITY'` | Render alveolar bone crest recession level and mobility vector markers. |
| **Abscess & Sensitivity** | Status tag | `condition = 'ABSCESS'`, `condition = 'SENSITIVE'` | Render periapical apical lesion bubble at root tip and pulpal sensitivity indicator. |
| **Missing / Extraction** | Ghosting & X-out | `condition = 'MISSING'`, `condition = 'EXTRACTION'` | Render dashed anatomical silhouette with central extraction marker. |

---

## 4. Newly Authored SVG Geometry Architecture

### 4.1 Coordinate Space & ViewBox Normalization
All tooth graphics are designed within a standardized normalized coordinate system:
- **Tooth ViewBox**: `0 0 60 100` (Width: 60px, Height: 100px)
- **Upper Arch Alignment**:
  - Coronal Crown: `Y = 48` to `Y = 96` (Crown points downward toward occlusal plane)
  - Radicular Root(s): `Y = 4` to `Y = 48` (Roots point upward toward maxillary bone)
- **Lower Arch Alignment**:
  - Radicular Root(s): `Y = 52` to `Y = 96` (Roots point downward toward mandibular bone)
  - Coronal Crown: `Y = 4` to `Y = 52` (Crown points upward toward occlusal plane)

### 4.2 Anatomical Groupings & Geometry Definitions
1. **Central & Lateral Incisors (11, 12, 21, 22, 31, 32, 41, 42)**:
   - Crown: Trapezoidal incisal edge with slightly convex labial enamel curve.
   - Root: Single conical root tapering symmetrically to apical foramen.
2. **Canines / Cuspids (13, 23, 33, 43)**:
   - Crown: Prominent central cusp tip with mesial and distal incisal slopes.
   - Root: Longest, stout single conical root with reinforced cervical margin.
3. **Premolars / Bicuspids (14, 15, 24, 25, 34, 35, 44, 45)**:
   - Crown: Dual-cusp coronal contour (buccal and lingual cusps) with central occlusal groove.
   - Root: Bifurcated apex for upper first premolars; stout single root for others.
4. **Molars (16, 17, 18, 26, 27, 28, 36, 37, 38, 46, 47, 48)**:
   - Crown: Broad multi-cusped occlusal surface with defined marginal ridges and developmental fissures.
   - Roots:
     - *Maxillary (Upper)*: 3 distinct divergent roots (Mesiobuccal, Distobuccal, Palatal).
     - *Mandibular (Lower)*: 2 robust curved roots (Mesial and Distal).

### 4.3 Interactive Surface Partitioning
Each tooth crown features 5 precision SVG polygon/path sectors:
```text
        +-----------------------+
        |        BUCCAL         |
        |      (Vestibular)     |
+-------+-----------------------+-------+
|       |                       |       |
|   M   |       OCCLUSAL        |   D   |
|   E   |       /INCISAL        |   I   |
|   S   |                       |   S   |
|   I   |                       |   T   |
|   A   |                       |   A   |
|   L   +-----------------------+   L   |
|       |        LINGUAL        |       |
|       |       (Palatal)       |       |
+-------+-----------------------+-------+
```
Each surface is independently focusable, clickable, and renders active restorative fills with high-contrast borders.

---

## 5. Component Hierarchy & Architecture

```text
components/dental-chart/
├── odontogram/
│   ├── Odontogram.tsx              # Main orchestrator component (Arch layout, toolbar, stats, summary)
│   ├── ArchGrid.tsx                # Maxilla (upper) and Mandible (lower) layout grids
│   ├── Quadrant.tsx                # FDI Quadrant wrapper (Q1, Q2, Q3, Q4) with midline divider
│   ├── ToothCell.tsx               # Individual tooth container with numbering, status, and hover logic
│   ├── ToothSVG.tsx                # Pure vector tooth renderer combining roots, crown, surfaces & overlays
│   ├── ToothSurfaces.tsx           # Interactive 5-surface SVG hitboxes and condition styling
│   ├── ConditionOverlay.tsx        # Visual condition overlays (Implant, Crown, RCT, Caries, Filling, etc.)
│   ├── BridgeConnector.tsx         # SVG span lines connecting bridge abutments and pontics
│   ├── ToothTooltip.tsx            # Floating rich tooltip on tooth hover
│   ├── SurfaceSelectorDialog.tsx   # Modal for editing tooth condition, severity, surfaces, and clinical notes
│   ├── OdontogramLegend.tsx        # Interactive condition legend with semantic colors and filtering
│   ├── OdontogramStats.tsx         # Clinical summary cards (Healthy, Caries, Filled, Missing, Implants)
│   └── ToothHistoryTimeline.tsx    # Chronological history viewer for historical entries per tooth
├── geometry/
│   ├── tooth-paths.ts              # Clean-room mathematical SVG vector path generators
│   └── tooth-dimensions.ts         # Anatomical proportions and bounding boxes
├── adapters/
│   ├── dental-chart-adapter.ts     # Adapter mapping Prisma DentalChartEntry to Odontogram View Models
│   └── bridge-mapper.ts            # Computes multi-tooth bridge connections from chart data
└── types/
    └── odontogram.ts               # Core TypeScript domain models and UI state types
```

---

## 6. State Management Model

```text
┌─────────────────────────────────────────────────────────────┐
│                       SERVER STATE                          │
│  - patientId (UUID)                                         │
│  - DentalChartEntry[] (Fetched via GET /api/dental-chart)   │
│  - Active/Resolved Status Filter                            │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    ODONTOGRAM VIEW MODEL                    │
│  - Map<toothNumber, ToothViewModel>                         │
│  - Active Condition & Severity                             │
│  - Surface Status (mesial, distal, occlusal, buccal, lingual│
│  - Historical Diagnostic Entries                            │
│  - Bridge Connections & Spans                               │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                         UI STATE                            │
│  - selectedTeeth: number[] (Multi-selection for treatments) │
│  - activeDialogTooth: number | null                         │
│  - hoveredTooth: number | null                              │
│  - filterCondition: string | 'ALL'                          │
│  - mode: 'clinical' | 'treatment-selection'                 │
│  - isSaving: boolean                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Accessibility (WCAG 2.1 AA Compliant)

- **Keyboard Navigation**:
  - Teeth are structured with `tabIndex={0}`, standard `aria-label` announcing tooth number, name, quadrant, and condition (e.g. `"Tooth 16, Upper Right First Molar, Condition: Caries on Mesial and Occlusal"`).
  - Activating via <kbd>Enter</kbd> or <kbd>Space</kbd> opens the tooth surface editor or toggles selection.
- **Color-Independent Visual Encoding**:
  - Every condition couples its distinct semantic color with unique geometry or patterns (e.g., Caries uses stippled decay fill; Missing uses dashed outline with diagonal strike-through; Implants display threaded screw grooves; Root canals display bright central canal lines; Fractures display jagged crack lines).
- **High-Contrast Dark/Light Themes**: Uses CSS variable-driven styling (`bg-background`, `text-foreground`, `border-border`) compliant with theme switching.

---

## 8. Security & Multi-Tenant Integrity

- All API communications pass through DenToRa's existing `/api/dental-chart` endpoints secured by `requireAuthAndRole(['ADMIN', 'DOCTOR'])`.
- Patient ownership and tenant scoping (`hospitalId`) are verified strictly on the server; client input cannot alter tenant boundary.
- Input validation on tooth numbers strictly enforces the FDI notation set: `{11..18, 21..28, 31..38, 41..48}`.

---

## 9. High-Fidelity 2.5D SVG Geometry Model

The tooth vector layer (`geometry/tooth-paths.ts` + `odontogram/ToothSVG.tsx`) is authored
as a layered 2.5D anatomical illustration, **not** as single-outline icons.

**Coordinate frame (64 × 100 viewBox):**
- Maxillary master frame: cervical (gum) line at `y ≈ 46`, crowns extend **down** to the
  occlusal plane (`y ≈ 92–97`), root trunks extend **up** to `y ≈ 5–13`.
- Mandibular frame: generated by vertical mirroring (`y → 100 − y`) so lower crowns face
  **up** toward the occlusal plane and roots extend **down**.
- Left-sided teeth (Q2/Q3) are derived by horizontal mirroring of the right master forms,
  which keeps distal root curvature and incisal asymmetry facing the arch.

**Layer order per tooth (bottom → top):**
1. **Furcation depth shadows** — soft blurred shapes in inter-radicular notches.
2. **Root trunks** — separate volumetric silhouettes (1 / 2 / 3 per class) filled with a
   horizontal cylindrical cementum gradient (matte cream-tan), thin warm contour, apex
   shadow blobs, faint longitudinal striations, and translucent root canal traces.
3. **Enamel crown body** — single organic contour filled with a warm porcelain-ivory
   gradient (deeper tone cervically, brighter/thinner at the occlusal/incisal edge).
4. **Clipped interior shading** (clipped to the crown silhouette):
   - cervical band, mesial/distal edge falloff, incisal translucency band;
   - faint translucent pulp chamber;
   - recessed **occlusal table plate** with a soft top-edge shadow, cusp-base shadows,
     engraved grooves (dark line + faint offset light edge), light ridge lines, and
     radial **cusp volume highlights** (raised cusps read as bright radials over the
     recessed plate);
   - glossy labial sheen (blurred + crisp specular).
5. **Interactive 5-surface zones** — procedural crown-bbox partition (mesial/distal
   slivers, buccal/lingual/occlusal bands) clipped to the enamel silhouette so hover
   fills always follow the organic contour.
6. **Gum margin & cervical line**, then the diagnostic `ConditionOverlay`.

**Class differentiation (all 16 classes are visually distinct without FDI labels):**
- Maxillary: central/lateral incisors (flat chisel incisal edges, ribbon roots), canine
  (pointed cusp, longest stout root), PM1 (bifurcated dual roots, two-cusp table), PM2
  (single root, balanced two-cusp table), M1/M2 (trifurcated three roots with open
  furcations, four-cusp tables, M2 roots converge), M3 (compact crown, fused curved root).
- Mandibular: narrower crowns; M1 (bifurcated dual roots, five-cusp Y-table),
  M2 (two convergent roots, four-cusp cross table), M3 (short fused root),
  PM1 (single root, dominant buccal cusp + transverse ridge), PM2 (Y-groove three-cusp
  table), incisors (flattest ribbon roots in the dentition).

A deterministic proportional refinement pass (`scaleClass`) widens crowns to real
mesiodistal proportions and trims roots (thinner base, tighter taper, shorter length)
without altering the hand-authored curves.

**Verification:** `tools/render-arch.tsx` SSR-renders the real `ToothSVG` components and
rasterizes full-arch / class close-up / condition sheets (`npx tsx tools/render-arch.tsx`)
so the rendered pixels — not just the code — are inspectable.

---

*Clean-Room Odontogram Design Contract authored and established. Proceeding to implementation.*
