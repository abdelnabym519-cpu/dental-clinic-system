/**
 * P4/S3 — ambient declarations so `npm run typecheck:vendor-3d` can resolve
 * the image imports in the engine's own React chrome (`ui/LanguageSwitcher`
 * imports flag PNGs). That chrome is never rendered by us — PATCH 7 hides it
 * — but it is still part of the vendored source we typecheck.
 */
declare module '*.png';
declare module '*.svg';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.webp';
