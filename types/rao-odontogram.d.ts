/**
 * Ambient type surface for the vendored React-Advanced-Odontogram.
 *
 * WHY THIS EXISTS
 * ---------------
 * App code must import the library through the bare specifier
 * `rao-odontogram`, which `next.config.js` aliases to
 * `vendor/react-advanced-odontogram/src/index.ts` at build time. TypeScript
 * resolves the SAME specifier to this ambient declaration instead.
 *
 * That indirection is deliberate and load-bearing. The library is authored
 * against its own `tsconfig` with `strict: false` and `noImplicitAny: false`.
 * Importing it directly pulls its ~180 files into the app's typecheck program,
 * where `strict: true` produces 186 errors (TS7005/7006 implicit-any, plus
 * unresolved `fhir/r4` types). Measured: importing it directly takes
 * `tsc --noEmit` from 498 to 684 errors. CI runs `tsc --noEmit` as a hard gate
 * (`.github/workflows/ci.yml`), and with Prisma generated the baseline there is
 * 0 — so those 186 errors would break the build.
 *
 * The vendor IS still typechecked, just on its own terms: with the library's
 * own `tsconfig.build.json` it reports only the 3 pre-existing `fhir/r4`
 * resolution errors. See vendor/react-advanced-odontogram/PATCHES.md.
 *
 * WHAT IS DECLARED
 * ----------------
 * Only the props DenToRa actually passes. Types are kept structural and
 * explicit rather than `any`, so a wrong prop name or a wrong value type is
 * still caught at the call site — which is where mistakes matter.
 */

declare module 'rao-odontogram' {
  import type { ComponentType } from 'react'

  /** UI languages the library supports. DenToRa uses only `ar` and `en`. */
  export type OdontogramLanguage =
    | 'hu' | 'en' | 'de' | 'es' | 'it' | 'sk'
    | 'pl' | 'ru' | 'pt-br' | 'zh' | 'ar' | 'fr'

  export interface OdontogramShellProps {
    /** Controlled UI language. DenToRa passes 'ar' or 'en' from its own locale. */
    language?: OdontogramLanguage
    /** Fired when the user changes the language in the (hidden) chart switcher. */
    onLanguageChange?: (lang: OdontogramLanguage) => void

    /** PATCH 4 (R1a-iv): disable all interaction. Driven from DenToRa RBAC. */
    readOnly?: boolean

    /** PATCH 1 (R1a-i): controlled selection, as library SLOTS 11-48. */
    selectedTeeth?: number[]
    /** PATCH 1 (R1a-i): fired with the new selection, as library SLOTS 11-48. */
    onSelectionChange?: (teeth: number[]) => void

    /** PATCH 3 (R1a-iii): show the built-in language menu. DenToRa passes false. */
    showLanguageSwitcher?: boolean

    /** Per-tooth notes (double-click). Left off in DenToRa. */
    enableNotes?: boolean
    /** ICDAS II per-surface caries scoring. Left off in DenToRa. */
    enableIcdas?: boolean

    /** Theme overrides via `--odon-*` CSS custom properties. */
    themeConfig?: Record<string, unknown>
  }

  export const OdontogramShell: ComponentType<OdontogramShellProps>

  /** Imperative engine API actually used by the DenToRa host. */
  export function getSelectedTeeth(): number[]
  export function setSelectedTeeth(teeth: number[]): void
  /** PATCH 5 (R1a-v): clear all patient data + selection, keeping host config. */
  export function resetForPatient(): void
  export function initOdontogram(): Promise<void>
  export function destroyOdontogram(): void

  const _default: ComponentType<OdontogramShellProps>
  export default _default
}
