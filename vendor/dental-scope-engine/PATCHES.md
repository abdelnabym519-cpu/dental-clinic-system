# vendor/dental-scope-engine — patch log

Every change to the vendored source is numbered here, with the reason and the
test that pins it. Nothing is patched silently.

Conventions (same as `vendor/react-advanced-odontogram`):

* patches are **additive** wherever possible — a new module beside the upstream
  one beats an edit inside it;
* every patch has a **contract test** that parses this vendored source, so a
  change to the file cannot pass unnoticed;
* the vendor tree is kept out of the app's `tsc` via an ambient declaration plus
  a resolver alias, and is typechecked separately by `typecheck:vendor-3d`.

Upstream commit pinned: `e34d4b986d5439501f23c91cde593f69a3b180b0`.

---

## Patches

| # | File | Change | Why | Test |
| --- | --- | --- | --- | --- |
| — | — | **No source patch yet.** The tree at S1 is upstream verbatim (minus excluded tests/docs/assets, which is an extraction choice, not a code change). | — | `tests/unit/dental-scope-vendor.test.ts` |

Planned (S3, each will get a row here):

1. `setToothAppearance(fdi, { tint, opacity, rim })` — a tint over the enamel
   material, applied by traversing meshes whose key starts with `tooth-<fdi>`,
   rather than replacing the material.
2. Selection **out**: subscribe to `src/state/store.ts` `selectedId` and map
   `tooth-NN` → FDI number.
3. Selection **in**: `selectFromUI` / `focus` with the FDI → key mapping.
4. Per-mount isolation / explicit reset between patients.
5. `dispose()` hardening — release geometries, materials and textures.
6. Removal/hiding of the engine's own UI chrome (search, labels panel,
   language flags) so no English text can appear in our build.
