/**
 * P4 / S1 — PATCH 1: replacement for the upstream `src/content/` tree.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Upstream `src/content/` is NOT part of the MIT engine. It is educational
 * prose and clinical reference data — `en|de|es|la|sv/structures.json`,
 * `en|de|es|la|sv/teeth.json`, `canal-counts.json`, `toothGuides.ts` and the
 * modules around them — licensed **CC BY-SA 4.0** (see upstream `CREDITS.md`).
 * `canal-counts.json` in particular is clinical data nobody approved.
 *
 * That whole tree was therefore DELETED from this vendor copy rather than
 * relicensed or trimmed. The only engine-critical symbol it exported was
 * `resolveContent`, used once (Engine.ts, hover tooltip). This module is the
 * MINIMAL TYPED STUB the licence hygiene work requires:
 *
 *   - the same export names and the same types as the deleted module, so the
 *     engine compiles and runs unchanged;
 *   - **EMPTY data** — no English text, no clinical counts, no anatomy claims.
 *
 * DELIBERATE DETAIL — `summary` is `''`, not `undefined`.
 * The single caller does `resolveContent(...).summary!` and assigns the result
 * to `textContent`. Returning `undefined` there would render the literal
 * string "undefined" into the DOM — i.e. English text leaking into an
 * Arabic-only UI. The stub returns an EMPTY STRING so the node stays empty.
 *
 * `ToothGuide`'s shape below is reconstructed from its only consumer
 * (`src/app/guide.ts`, since deleted), not invented: an array of
 * `{ title, rows: { label, value }[] }`.
 */
import type { Registry } from '../anatomy/registry.ts';
import type { Lang } from '../i18n/lang.ts';

export type ContentStatus = 'placeholder' | 'draft' | 'reviewed';

/** Minimal stand-in for the upstream `ToothGuide` entry (see header). */
export interface ToothGuideEntry {
  title: string;
  rows: { label: string; value: string }[];
}

export type ToothGuide = ToothGuideEntry[];

export interface ResolvedContent {
  key: string | null;
  summary?: string;
  function?: string;
  clinical?: string;
  location?: string;
  sources: { title: string; url: string }[];
  facts: { label: string; value: string }[];
  related: string[];
  guides: ToothGuide;
  status: ContentStatus;
}

/**
 * Stubbed lookup. Returns an EMPTY result for every input: no summary, no
 * facts, no sources, no related structures, no guides. `status` is
 * `'placeholder'` — the honest value, since no content is shipped.
 */
/**
 * Stubbed canal-count lookup. Returns `undefined` for every tooth, i.e.
 * "no data". Its only consumer (`ui/CanalFrequency.tsx`) does
 * `if (!item) return null`, so the panel renders nothing rather than
 * showing a fabricated count. Shape reconstructed from that consumer.
 */
export interface CanalFrequencyRow {
  canals: number;
  percent: number;
}

export interface CanalFrequency {
  rows: CanalFrequencyRow[];
  n: number;
  source: { url: string; citation: string };
}

export function canalFrequency(_fdi: number): CanalFrequency | undefined {
  return undefined;
}

/** Stubbed percentage formatter: empty string, never a number. */
export function formatPercent(_value: number, _lang: Lang = 'en'): string {
  return '';
}

/** Stubbed evidence context: no sentences. */
export function frequencyContext(_fdi: number, _lang: Lang = 'en'): string[] {
  return [];
}

/** Shared shape of a citation link (from the deleted content modules). */
export interface SourceRef {
  title: string;
  url: string;
}

/**
 * Stubbed citation lists. EMPTY: rendering them produces no link and no
 * English title, which is the point — the upstream lists cited sources we
 * have not verified and must not imply endorsement of.
 */
export const DEVELOPMENT_SOURCES: SourceRef[] = [];
export const HYOID_SOURCES: SourceRef[] = [];

/**
 * The hyoid attachment group names. This is a three-word structural union
 * type (not content); the panel's `useState<HyoidGroup>` needs it to compile.
 */
export type HyoidGroup = 'skull' | 'jaw' | 'below';

export interface HyoidAttachment {
  name: string;
  description: string;
  group: HyoidGroup;
}

/** Stubbed hyoid attachment list: empty, so the panel lists nothing. */
export function hyoidAttachments(_lang: Lang = 'en'): HyoidAttachment[] {
  return [];
}

export function resolveContent(
  _registry: Registry,
  _id: string,
  _lang: Lang = 'en',
): ResolvedContent {
  return {
    key: null,
    summary: '',
    sources: [],
    facts: [],
    related: [],
    guides: [],
    status: 'placeholder',
  };
}
