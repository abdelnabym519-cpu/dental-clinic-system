# R1a bundle-size measurement

How much the vendored React-Advanced-Odontogram costs the client bundle, and how
it was measured.

## Method: A/B of the same build

The absolute "total client JS" number is not attributable on its own — the
library is split across shared chunks. So the route was built **with** and
**without** the v2 route and the difference taken:

```
1. npx next build                        -> measure .next/static/**/*.js
2. move app/(dashboard)/patients/[id]/dental-chart-v2
   and components/dental-chart/v2/RaoOdontogram.tsx aside
3. rm -rf .next && npx next build        -> measure again
4. restore both, revert next.config.js
```

Both runs printed `✓ Compiled successfully`, so the client chunks were emitted
in both cases even though the build later fails at page-data collection (see
"Blocker" below).

## Result

| | Client JS | Files |
| --- | --- | --- |
| Baseline (v2 route absent) | **7.14 MB** | 176 |
| With the v2 route | **9.97 MB** | 199 |
| **Cost of the vendored library** | **+2.83 MB** | +23 |

Both figures are the raw (uncompressed) sum of `.next/static/**/*.js`.
This is **not** gzipped — Next reports gzipped sizes per route, which this
environment cannot produce (see below).

## Interpretation

+2.83 MB uncompressed is a large footprint and should not be waved through.
Mitigating facts, in order of how much they help:

- The v2 chart is behind `dynamic(..., { ssr: false })`, so none of it is in the
  server payload or in any other route's initial JS. The cost is confined to a
  patient page that navigates to this route.
- 23 additional chunks means it is code-split, not one monolith.
- 1.1 MB of the *vendored source* (`src/fonts/`) is reached only by a dynamic
  `import()` inside PDF export, and the i18n locale files are lazy too, so parts
  of the 2.83 MB are themselves lazy chunks rather than first paint.
- The 4.4 MB of tooth SVG artwork is the irreducible part: it is the reason the
  library looks like real teeth.

**Not yet measured:** the gzipped/brotli transfer size and the actual
First-Load JS for the route, both of which Next prints per route at the end of a
successful build. Getting them needs the build to reach completion.

## Blocker: the build cannot finish in this sandbox

`npx next build` compiles successfully and then fails at page-data collection:

```
[dentora] Prisma client unavailable (generated client not found). Running in
fallback mode: ALL database queries resolve to null...
Error: Failed to collect page data for /api/imaging/jobs/[id]/review
  [cause]: Cannot find module '.prisma/client/default'
```

`@prisma/client` is not generated here and generating it is out of scope for
this task. In CI Prisma **is** generated, so this step succeeds there and the
per-route sizes are printed. The A/B above is therefore a valid *comparative*
measurement even though neither run produced a finished build.

To reproduce properly once Prisma is available:

```
npx prisma generate && npx next build
```

## Second finding: the vendor must be aliased, not imported directly

Importing the library through its real path
(`@/vendor/react-advanced-odontogram/src`) takes `tsc --noEmit` from **498**
errors to **684** — 186 new errors (TS7005/TS7006 implicit-any, plus unresolved
`fhir/r4` types), because the library is written with `strict: false` and the
app typechecks with `strict: true`. CI runs `tsc --noEmit` as a hard gate
(`.github/workflows/ci.yml:46`) and with Prisma generated the baseline there is
**0**, so that would break the build.

Fix: app code imports the bare specifier `rao-odontogram`, which
`next.config.js` aliases to the vendored source for the bundler while
TypeScript resolves the same specifier to the ambient declaration in
`types/rao-odontogram.d.ts`. The library is still typechecked on its own terms
(via its own `tsconfig.build.json`: 3 pre-existing `fhir/r4` errors only).

Two dead ends worth recording, both found by running the build:

1. A `webpack:` alias block in `next.config.js` is **silently ignored** — Next
   16 builds with Turbopack. It must be `turbopack.resolveAlias`.
2. `turbopack.resolveAlias` rejects an absolute path
   (`path.resolve(__dirname, ...)`) with *"server relative imports are not
   implemented yet"*. The value must be project-relative:
   `'./vendor/react-advanced-odontogram/src/index.ts'`.

With the alias in place, `tsc --noEmit` is back to exactly **498** — the
pre-existing Prisma cascade — with zero errors in the new files.
