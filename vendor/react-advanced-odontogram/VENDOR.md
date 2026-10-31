# Vendored: React-Advanced-Odontogram

| | |
| --- | --- |
| Upstream | <https://github.com/ZoliQua/React-Advanced-Odontogram> |
| Upstream commit | `a11468def7a5c30c876db24fce3986f21b815377` (branch `main`, fetched 2026-10-31) |
| npm version | `react-advanced-odontogram` 2.8.0 |
| Licence | MIT — see [`LICENSE`](./LICENSE) |
| Extra notices | [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) |
| Upstream package.json | `package.upstream.json` (kept for provenance only — not used by the build) |

## Why vendored instead of installed from npm

The npm package ships only `dist/odontogram.js` (a single bundled ES module)
plus `dist/index.d.ts` and `dist/style.css`. R1a requires five behavioural
patches, which are not feasible against a pre-bundled file. Vendoring the
source makes every change reviewable and keeps it in `PATCHES.md`.

## What was copied

- `LICENSE`, `THIRD-PARTY-NOTICES.md` — kept **verbatim, unmodified**. Both
  must continue to ship with any redistribution.
- `src/` — **all of it except `__tests__/`**, which holds the upstream
  fixture and golden files (parity fingerprints, FHIR goldens) and is not
  needed at runtime. Nothing else was removed.

## What was NOT copied (deliberately)

`src/__tests__/` only. The `fonts/` directory **is** copied even though it is
1.1 MB, because `src/fonts/loader` is reached by a dynamic `import()` from the
PDF export path; removing it would break resolution. Those fonts are lazily
loaded and never enter the initial bundle.

## Size

| | |
| --- | --- |
| `vendor/react-advanced-odontogram/` | 7.8 MB |
| files | 159 |
| of which `src/assets` (tooth SVG artwork) | 4.4 MB |
| of which `src/fonts` (lazy, PDF only) | 1.1 MB |

## Runtime dependencies introduced

| Package | Licence | Why |
| --- | --- | --- |
| `dompurify` | MPL-2.0 or Apache-2.0 | **static** import in 2 source files; the library sanitises every SVG it renders |
| `jspdf` | MIT | dynamic `import()` only, inside the PDF export path — lazy chunk |

Both are added to the host `package.json`. Neither is in the initial page
bundle: `jspdf` is a lazy chunk and `dompurify` is small.

## Build integration

`vendor/` is excluded from the repository `tsconfig.json` typecheck: the
library was authored against its own `tsconfig.build.json` for a Vite library
build, and typechecking it under the app's stricter settings produces a large
number of pre-existing errors unrelated to our changes. Our own adapter code
lives outside `vendor/` and **is** typechecked.
