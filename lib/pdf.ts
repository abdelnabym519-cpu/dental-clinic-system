/**
 * Minimal dependency-free PDF writer for messaging attachments
 * (prescriptions, invoices). Produces single-page, Helvetica-based,
 * Latin-encoded documents — enough for a legible attachment delivered over
 * WhatsApp; not a general-purpose PDF engine.
 */

interface PdfLine {
  text: string
  size?: number
  bold?: boolean
  gapAfter?: number
}

interface SimplePdfInput {
  title: string
  subtitle?: string
  lines: PdfLine[]
  footer?: string
}

/** Escape PDF literal-string specials. */
function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // WinAnsi-safe: drop anything outside Latin-1 to keep encoding valid.
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?')
}

/**
 * Render a simple one-page A4 PDF. Returns a Buffer that starts with the
 * `%PDF-` magic and ends with `%%EOF`.
 */
export function renderSimplePdf(input: SimplePdfInput): Buffer {
  const pageWidth = 595.28 // A4 pt
  const pageHeight = 841.89
  const leftMargin = 56
  let y = pageHeight - 72

  const contentOps: string[] = ['BT']
  const writeLine = (text: string, size: number, bold: boolean) => {
    const font = bold ? '/F2' : '/F1'
    contentOps.push(`${font} ${size} Tf`)
    contentOps.push(`1 0 0 1 ${leftMargin} ${y.toFixed(2)} Tm`)
    contentOps.push(`(${escapePdfText(text)}) Tj`)
    y -= size * 1.5
  }

  writeLine(input.title, 18, true)
  if (input.subtitle) {
    writeLine(input.subtitle, 11, false)
    y -= 6
  }
  y -= 8
  for (const line of input.lines) {
    if (y < 72) break // single-page guard
    writeLine(line.text ?? '', line.size ?? 11, line.bold ?? false)
    if (line.gapAfter) y -= line.gapAfter
  }
  if (input.footer) {
    y = 56
    writeLine(input.footer, 9, false)
  }
  contentOps.push('ET')
  const content = contentOps.join('\n')

  const objects: string[] = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`
  )
  objects.push(
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
  )
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  )

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return Buffer.from(pdf, 'latin1')
}
