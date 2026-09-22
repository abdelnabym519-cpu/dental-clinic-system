# Localization — Arabic (Egypt) first, bilingual by design

Dentora is built for Egyptian dental clinics, and that assumption is
deliberately baked into the product rather than patched over:

- **Arabic (ar-EG, RTL)** is the primary locale and the first-boot default.
- **Egyptian English (en-EG)** and **international English (en-US)** are the
  secondary locales. The retired `en-IN` locale is not supported anywhere;
  legacy records fall through the resolution cascade to the clinic's locale.
- Currency is **EGP (ج.م)** everywhere, formatted through the single
  locale-aware formatter (`lib/i18n/format.ts`) — never a raw glyph in markup.
- Tax is **Egyptian VAT at 14%**, a single rate. The legacy
  `cgstRate/cgstAmount` columns carry it (`sgstRate/sgstAmount` stay 0 for
  backwards compatibility); the UI shows one "VAT (14%)" row.
- Timezone is **Africa/Cairo** end to end: locale defaults, scheduling,
  calendar integrations, and message templates.
- Phone numbers are Egyptian mobiles — `01XXXXXXXXX` local
  (010/011/012/015) or `+20 1X…` international — validated by
  `validateEgyptianPhone()` in `lib/utils.ts`.
- Addresses use the **27 Egyptian governorates**; postal codes are 5-digit.
- Payment rails are **Fawry, Paymob (Accept) and InstaPay**, plus cash,
  bank cards, mobile wallets (Vodafone Cash / Orange / Etisalat), bank
  transfer and cheque.

This document maps what is locale-aware today, how resolution works, and the
conventions contributors must follow.

## 1. What is localized today

| Concern            | Implementation                                                        |
| ------------------ | --------------------------------------------------------------------- |
| Currency & numbers | `lib/i18n/format.ts` — single `Intl`-based module                      |
| Dates & times      | `lib/i18n/format.ts` + `Africa/Cairo` from `lib/i18n/config.ts`        |
| UI strings         | `locales/ar.json`, `locales/en.json` via `lib/i18n/dictionary.ts`      |
| Locale resolution  | `lib/i18n/request.ts` cascade (see §2.1)                               |
| `<html lang/dir>`  | `app/layout.tsx` — cookie choice → default; `directionFor()`          |
| Tax                | `vatConfig` / `calculateVAT()` in `lib/billing-utils.ts` (VAT 14%)     |
| Phones             | `validateEgyptianPhone()` in `lib/utils.ts`                            |
| Seeds              | `prisma/seed.ts` — Egyptian clinic, staff, patients, suppliers         |
| Payment gateways   | `lib/payment-gateways/` — Fawry, Paymob, InstaPay adapters             |

## 2. Locale resolution: per-clinic, not per-URL

This is a logged-in B2B application, not a public marketing site. The locale
hangs off the **`Hospital` record**, not a `/[locale]/` URL segment — that
avoids restructuring every route in `app/(dashboard)/`.

On the `Hospital` model:

```prisma
locale    String @default("ar-EG")       // BCP 47
country   String @default("EG")          // ISO 3166-1 alpha-2
currency  String @default("EGP")         // ISO 4217
timezone  String @default("Africa/Cairo")
```

Patient-facing surfaces — the patient portal, public booking and public
payment pages — resolve the locale from the clinic being booked, with an
optional override for the patient's own preference.

### 2.1 The resolution cascade — implemented

`Hospital.locale` is the clinic's setting. `User.locale` and `Patient.locale`
sit on top of it as personal overrides. Resolution walks from most specific to
least and takes the first **supported** value:

| Surface                   | Resolution                                     | Entry point                                                |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| Staff UI                  | `User.locale` → `Hospital.locale` → default    | `getLocaleForRequest()`                                    |
| Patient portal            | `Patient.locale` → `Hospital.locale` → default | `getLocaleForRequest()`, or `getLocaleForPatientRequest()` |
| Public pages (no session) | `?lang=` → `Hospital.locale` → default         | `resolvePublicLocale()`                                    |

`getLocaleForRequest()` is what `next-intl` calls. It tries the staff session
first and the portal cookie second, because a browser can hold both at once and
the staff session is the more specific context when it does.

**Both override columns are nullable with no default.** This is the decision
worth understanding before changing anything here:

```prisma
model User {
  // null means "inherit from the clinic" — deliberately NOT defaulted.
  locale String?
}
```

A default would make "never expressed a preference" indistinguishable from
"explicitly chose en-EG", so a clinic changing its own locale would silently
fail to propagate to everyone who had never touched the setting.

Three behaviours follow from that, covered by
[`tests/unit/i18n-cascade.test.ts`](../tests/unit/i18n-cascade.test.ts) for the
resolution itself and
[`tests/api/locale-preferences.test.ts`](../tests/api/locale-preferences.test.ts)
for what the endpoints actually write:

- **Clearing the picker persists `NULL`**, not the clinic's current value.
  Re-selecting whatever the clinic uses today would pin the user to it.
- **An unsupported stored value falls through to the next candidate**, not
  straight to the default. If a locale is retired (as `en-IN` was during the
  Egyptian pivot), its users should land on their clinic's locale. This is why
  resolution uses `resolveLocaleCascade(...candidates)` rather than
  `resolveLocale(user ?? clinic)` — the latter treats a non-null unsupported
  value as a decision and skips the clinic entirely.
- **`?lang=` is never written anywhere.** An anonymous visitor has no account
  to store it against, and persisting it would let a shared link change what
  other visitors see.

Failure is never fatal: no session, an unreachable database or a retired locale
all resolve to the default rather than throwing. Formatting must not be able to
take a page down.

**What the override changes.** Interface language, number and date formatting,
and how amounts are grouped and punctuated — not which currency the clinic
bills in. Currency follows the clinic (`EGP`).

## 3. Layout

```
messages/
  ar-EG.json         # primary locale (RTL)
  en-US.json         # English catalogue
lib/i18n/
  config.ts          # supported locales, default, resolution helpers
  request.ts         # next-intl getRequestConfig — reads the cascade
  format.ts          # the single locale-aware currency/date/number module
lib/payment-gateways/
  fawry.ts           # Fawry IPC charge API (sha256-signed)
  paymob.ts          # Paymob Accept (auth → order → payment key → iframe)
  instapay.ts        # InstaPay references + handle-based transfers
prisma/seed.ts       # Egyptian clinic, staff, patients, catalogue
```

## 4. Conventions

- **Message keys** are namespaced by feature, not by page:
  `billing.invoice.total`, not `invoicePage.label7`.
- **Never concatenate translated fragments.** Use ICU message format with
  placeholders so translators control word order.
- **No raw `ج.م` or `EGP` in markup.** Always go through the formatter — the
  symbol, its position and the digit grouping are all locale-dependent
  (`ar-EG` renders `١٬٠٠٠٫٠٠ ج.م.‏`; `en-EG` renders `EGP 1,000.00`).
- **Bilingual content (Arabic + English) is the default** for patient-facing
  text: reminders, intake forms, payment instructions. Staff-only admin text
  may be English-only, but Arabic-first is preferred.
- **Dates in the database stay UTC.** Only presentation is localized; the
  display timezone is Africa/Cairo.
- **Clinical free text is not translated.** Patient notes, prescriptions and
  diagnoses are entered by clinicians and stored verbatim; machine-translating
  them would be a safety problem.
- **Egyptian Arabic numerals**: `ar-EG` formats with Arabic-Indic digits by
  default; the formatter accepts an explicit `numberingSystem` override for
  screens where Latin digits are operationally clearer.

## 5. How UI strings are resolved (implemented)

The rendered UI reads `locales/ar.json` and `locales/en.json` through
`lib/i18n/dictionary.ts`:

| Surface                                 | Entry point                                        |
| --------------------------------------- | -------------------------------------------------- |
| Client components                       | `useLanguage()` → `t(key, vars?)`                   |
| Server components / `generateMetadata()`| `getServerTranslator()` in `lib/i18n/server.ts`     |
| Non-component code (lib helpers)        | `translateText(locale, key, vars?)`                 |
| Dates rendered with `date-fns`          | `dateFnsLocale(locale)` in `lib/i18n/dates.ts`      |

Both files carry the same key set (parity is enforced by
`tests/unit/i18n-completeness.test.tsx`), and the key is its own English text —
`t('Save Changes')` — so an untranslated string degrades to readable English
instead of a dotted id. `messages/*.json` and `lib/i18n/request.ts` remain the
`next-intl` request-config path for locale cascade resolution; the UI does not
read its message catalogs.

## 6. PDF attachments — Arabic supported

Patient-facing invoice and prescription PDFs
(`app/api/communications/*/send`) follow the staff member's locale, exactly
like the UI, and render Arabic properly:

| Piece                | Where                                                       |
| -------------------- | ----------------------------------------------------------- |
| Contextual shaping   | `lib/pdf-arabic.ts` — isolated/final/initial/medial forms    |
| Bidirectional order  | `lib/pdf-arabic.ts` — logical text → visual glyph order      |
| Font subset + embed  | `lib/pdf-font.ts` + `lib/pdf.ts` — Type0/`Identity-H`, `/FontFile2` |
| Font asset           | `assets/fonts/NotoNaskhArabic-Regular.ttf` (SIL OFL 1.1)     |

Notes for future work:

- Documents with no non-Latin-1 text still use the core Helvetica fonts, so an
  English attachment embeds no font data at all.
- Shaping is glyph-based rather than GSUB-based: the font ships the Arabic
  presentation forms, so no layout tables are parsed and no shaping engine is
  needed.
- Lam+alef is deliberately **not** turned into a single ligature glyph — that
  makes text extraction lossy (`بلال` came back as `بالل`), which would corrupt
  the searchable text of patient names.
- The subset keeps original glyph ids, so the cmap and composite glyphs stay
  valid; `head`, `hhea`, `maxp`, `hmtx`, `loca` and `name` are the only tables
  that need rewriting.
- Characters the font does not cover fall back to `?` rather than `.notdef`
  boxes, so a document never silently loses content.
- `next.config.js` lists the font under `outputFileTracingIncludes`: it is read
  from disk at runtime, which a standalone build would otherwise not trace.

The WhatsApp/SMS *message* text around the attachment is Arabic as well
(`lib/messaging/templates.ts`).
