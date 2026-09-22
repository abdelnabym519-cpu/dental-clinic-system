/**
 * Arabic shaping and bidirectional ordering for the PDF writer.
 *
 * PDF has no text engine: it draws glyph ids left to right. Arabic therefore
 * needs two things done here that a browser does for free:
 *
 *  1. Shaping — every letter is replaced by its contextual presentation form
 *     (isolated / final / initial / medial) and lam+alef becomes a ligature.
 *     The font ships all of U+FE80–FEFC, so no GSUB parsing is required.
 *  2. Ordering — the logical string is reordered into visual order (RTL runs
 *     reversed, LTR runs such as numbers and Latin words kept intact).
 *
 * This is deliberately the same approach used for simple PDF writers: good
 * enough for names, invoice lines and diagnoses, and it keeps documents
 * copy-pasteable via the ToUnicode map built alongside it.
 */

/** Presentation forms, indexed [isolated, final, initial, medial]. */
const ARABIC_FORMS: Record<number, readonly number[]> = {
  0x0621: [0xfe80], // hamza — non-joining
  0x0622: [0xfe81, 0xfe82], // alef madda
  0x0623: [0xfe83, 0xfe84], // alef with hamza above
  0x0624: [0xfe85, 0xfe86], // waw with hamza
  0x0625: [0xfe87, 0xfe88], // alef with hamza below
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c], // yeh with hamza
  0x0627: [0xfe8d, 0xfe8e], // alef
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92], // beh
  0x0629: [0xfe93, 0xfe94], // teh marbuta
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98], // teh
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c], // theh
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0], // jeem
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4], // hah
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8], // khah
  0x062f: [0xfea9, 0xfeaa], // dal
  0x0630: [0xfeab, 0xfeac], // thal
  0x0631: [0xfead, 0xfeae], // reh
  0x0632: [0xfeaf, 0xfeb0], // zain
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4], // seen
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8], // sheen
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc], // sad
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0], // dad
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4], // tah
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8], // zah
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc], // ain
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0], // ghain
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4], // feh
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8], // qaf
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc], // kaf
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0], // lam
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4], // meem
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8], // noon
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec], // heh
  0x0648: [0xfeed, 0xfeee], // waw
  0x0649: [0xfeef, 0xfef0], // alef maksura
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4], // yeh
}

/**
 * Lam + alef is deliberately NOT turned into the U+FEF5–U+FEFC ligature, even
 * though the font ships it.
 *
 * A ligature is one glyph standing for two characters, and PDF text extractors
 * reverse right-to-left runs character by character — so `بلال` came back as
 * `بالل` and `العلاج` as `العالج`, which silently corrupts the searchable text
 * layer of names and diagnoses. Emitting lam and alef as separate contextual
 * glyphs keeps the rendering legible and makes extraction exact.
 */

const TATWEEL = 0x0640

/**
 * Bidi control characters. `Intl` wraps Arabic currency output in U+200F
 * (RLM), and those marks have no glyph in the font — left in, they would be
 * drawn as .notdef boxes. Ordering is handled by `visualOrder()` instead.
 */
function isBidiControl(codePoint: number): boolean {
  return (
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    codePoint === 0x061c ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  )
}

/** Combining marks that never break a joining sequence. */
function isTransparent(codePoint: number): boolean {
  return (
    (codePoint >= 0x064b && codePoint <= 0x065f) ||
    codePoint === 0x0670 ||
    (codePoint >= 0x06d6 && codePoint <= 0x06ed) ||
    codePoint === 0x200d ||
    codePoint === 0x200c ||
    isBidiControl(codePoint)
  )
}

/** Can this letter carry a form that joins to the letter before it? */
function connectsBackward(codePoint: number): boolean {
  if (codePoint === TATWEEL) return true
  const forms = ARABIC_FORMS[codePoint]
  return !!forms && (forms.length === 2 || forms.length === 4)
}

/** Can this letter carry a form that joins to the letter after it? */
function connectsForward(codePoint: number): boolean {
  if (codePoint === TATWEEL) return true
  const forms = ARABIC_FORMS[codePoint]
  return !!forms && forms.length === 4
}

export interface ShapedGlyphCluster {
  /** Code point to send to the font. */
  codePoint: number
  /** What this glyph should read as when text is extracted (base letters). */
  toUnicode: string
  /** True for combining marks, which must not advance the pen. */
  mark: boolean
  /** True for Arabic-script clusters (drives bidi classing). */
  rtl: boolean
}

/** Replace Arabic letters with their contextual presentation forms. */
export function shapeArabicClusters(text: string): ShapedGlyphCluster[] {
  const chars = [...text]
  const codePoints = chars.map((char) => char.codePointAt(0) as number)

  const nextLetter = (from: number) => {
    for (let i = from + 1; i < codePoints.length; i++) {
      if (isTransparent(codePoints[i])) continue
      return { codePoint: codePoints[i], index: i }
    }
    return null
  }
  const previousLetter = (from: number) => {
    for (let i = from - 1; i >= 0; i--) {
      if (isTransparent(codePoints[i])) continue
      return { codePoint: codePoints[i], index: i }
    }
    return null
  }

  const clusters: ShapedGlyphCluster[] = []
  for (let i = 0; i < codePoints.length; i++) {
    const codePoint = codePoints[i]

    // Bidi controls are dropped: they are not glyphs, and ordering is ours.
    if (isBidiControl(codePoint)) continue

    if (isTransparent(codePoint)) {
      clusters.push({ codePoint, toUnicode: chars[i], mark: true, rtl: true })
      continue
    }

    const forms = ARABIC_FORMS[codePoint]
    if (!forms && codePoint !== TATWEEL) {
      clusters.push({ codePoint, toUnicode: chars[i], mark: false, rtl: false })
      continue
    }

    if (codePoint === TATWEEL) {
      clusters.push({ codePoint, toUnicode: chars[i], mark: false, rtl: true })
      continue
    }

    const previous = previousLetter(i)
    const next = nextLetter(i)
    const joinsBack = previous ? connectsForward(previous.codePoint) : false
    const joinsForward = next ? connectsBackward(next.codePoint) : false

    let formIndex: number
    if (forms.length === 1) formIndex = 0
    else if (forms.length === 2) formIndex = joinsBack ? 1 : 0
    else if (joinsBack && joinsForward) formIndex = 3
    else if (joinsBack) formIndex = 1
    else if (joinsForward) formIndex = 2
    else formIndex = 0

    clusters.push({ codePoint: forms[formIndex], toUnicode: chars[i], mark: false, rtl: true })
  }

  return clusters
}

/** Arabic-Indic and extended Arabic-Indic digits, plus their separators. */
function isArabicNumber(codePoint: number): boolean {
  return (
    (codePoint >= 0x0660 && codePoint <= 0x0669) ||
    (codePoint >= 0x06f0 && codePoint <= 0x06f9) ||
    codePoint === 0x066b ||
    codePoint === 0x066c ||
    codePoint === 0x066a
  )
}

function isLatinNumber(codePoint: number): boolean {
  return (
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    codePoint === 0x25
  )
}

/** Brackets and other pairs swap sides when the run is right-to-left. */
const MIRRORED: Record<number, number> = {
  0x28: 0x29,
  0x29: 0x28,
  0x5b: 0x5d,
  0x5d: 0x5b,
  0x7b: 0x7d,
  0x7d: 0x7b,
  0x3c: 0x3e,
  0x3e: 0x3c,
}

export interface OrderedText {
  /** Clusters in visual (left-to-right) order, ready to be drawn. */
  visual: ShapedGlyphCluster[]
  /**
   * Paragraph direction, taken from the first strongly-directed character in
   * LOGICAL order. Alignment must use this — a mixed line such as
   * `فاتورة INV-1001` starts with Arabic even though its leftmost glyph after
   * reordering is Latin.
   */
  rtl: boolean
}

/**
 * Reorder shaped clusters into visual (left-to-right) order.
 *
 * Neutrals take the direction of the text around them; runs that end up
 * sharing a direction are merged before reordering, so a Latin token like
 * `INV-1001` — split by its hyphen into several runs — is not scrambled.
 */
export function orderText(clusters: ShapedGlyphCluster[]): OrderedText {
  // Bidi classes we care about. Arabic-Indic digits are Unicode class AN,
  // which is NOT the same as the Latin EN class: a neutral sitting between a
  // Latin number and an Arabic-Indic one (rule N1 requires the *same* class on
  // both sides) therefore falls back to the paragraph direction instead of
  // gluing the two numbers into one left-to-right run.
  type Direction = 'rtl' | 'ltr' | 'an' | 'neutral'
  const directionOf = (cluster: ShapedGlyphCluster): Direction => {
    if (cluster.rtl) return 'rtl'
    if (isArabicNumber(cluster.codePoint)) return 'an'
    if (isLatinNumber(cluster.codePoint)) return 'ltr'
    return 'neutral'
  }
  /** Direction a run is laid out in: numbers read left-to-right either way. */
  const layoutOf = (direction: Direction): 'rtl' | 'ltr' =>
    direction === 'rtl' ? 'rtl' : 'ltr'

  // 1. Paragraph direction: the first strong character in logical order.
  const firstStrong = clusters.find((cluster) => directionOf(cluster) !== 'neutral')
  const paragraphIsRtl = firstStrong ? directionOf(firstStrong) === 'rtl' : false

  // 2. Resolve every neutral: neighbours of the same class win (N1), otherwise
  //    the paragraph direction applies (N2).
  const resolved: Array<'rtl' | 'ltr'> = clusters.map((cluster, index) => {
    const own = directionOf(cluster)
    if (own !== 'neutral') return layoutOf(own)
    let before: Direction = paragraphIsRtl ? 'rtl' : 'ltr'
    for (let i = index - 1; i >= 0; i--) {
      const candidate = directionOf(clusters[i])
      if (candidate !== 'neutral') {
        before = candidate
        break
      }
    }
    let after: Direction = paragraphIsRtl ? 'rtl' : 'ltr'
    for (let i = index + 1; i < clusters.length; i++) {
      const candidate = directionOf(clusters[i])
      if (candidate !== 'neutral') {
        after = candidate
        break
      }
    }
    if (before === after) return layoutOf(before)
    return paragraphIsRtl ? 'rtl' : 'ltr'
  })

  // 3. Merge neighbours that now share a layout direction.
  const runs: Array<{ direction: 'rtl' | 'ltr'; items: ShapedGlyphCluster[] }> = []
  clusters.forEach((cluster, index) => {
    const last = runs[runs.length - 1]
    if (last && last.direction === resolved[index]) last.items.push(cluster)
    else runs.push({ direction: resolved[index], items: [cluster] })
  })

  // 4. Right-to-left paragraphs lay their runs out from the right.
  const ordered = paragraphIsRtl ? [...runs].reverse() : runs

  const visual: ShapedGlyphCluster[] = []
  for (const run of ordered) {
    if (run.direction === 'rtl') {
      // Right-to-left text is emitted last-glyph-first, mirroring its pairs.
      for (let i = run.items.length - 1; i >= 0; i--) {
        const item = run.items[i]
        const mirrored = MIRRORED[item.codePoint]
        visual.push(
          mirrored && !item.rtl
            ? { ...item, codePoint: mirrored, toUnicode: String.fromCodePoint(mirrored) }
            : item
        )
      }
    } else {
      visual.push(...run.items)
    }
  }
  return { visual, rtl: paragraphIsRtl }
}

/** Reorder shaped clusters into visual order (clusters only). */
export function visualOrder(clusters: ShapedGlyphCluster[]): ShapedGlyphCluster[] {
  return orderText(clusters).visual
}

/** True when the text contains any character the core PDF fonts cannot draw. */
export function needsEmbeddedFont(text: string): boolean {
  for (const char of text) {
    const codePoint = char.codePointAt(0) as number
    // WinAnsi covers Latin-1 plus a handful of punctuation; treat anything
    // beyond that, and any Arabic, as needing the embedded font.
    if (codePoint > 0xff) return true
  }
  return false
}
