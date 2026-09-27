import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { getStorage } from '@/lib/storage'
import { jpegInfo, renderSimplePdf } from '@/lib/pdf'
import { defaultLocale, isSupportedLocale, type Locale } from '@/lib/i18n/config'
import { translate } from '@/lib/i18n/dictionary'

// Phase 20 (D9) — Arabic-capable imaging report (PDF).
//
// GET /api/imaging/studies/:id/report?lang=ar|en
//
//   - Clinic header + report title (spec layout)
//   - Patient info, study date + modality
//   - The ORIGINAL image embedded (JPEG via DCTDecode; PNG/WebP are
//     converted through jimp — an already-declared dependency)
//   - AI findings table (condition + confidence)
//   - Doctor review decision + notes + reviewed-by line
//   - Footer: "reviewed by a specialist" ONLY when a review exists — an
//     unreviewed report is labelled pending review, not stamped as final.
//
// RBAC: view roles only (DOCTOR/ADMIN/RECEPTIONIST). ACCOUNTANT has no
// imaging access. The original object is never modified — it is read once.

const VIEW_ROLES = ['DOCTOR', 'ADMIN', 'RECEPTIONIST']

/**
 * The UI sends its RESOLVED locale tag (ar-EG | en-EG | en-US). Bare "ar"/"en"
 * are tolerated too — resolveLocale alone would map an unknown tag to the
 * default (ar-EG) and silently print an English UI's request in Arabic.
 */
function resolveReportLocale(raw: string | null | undefined): Locale {
  if (isSupportedLocale(raw)) return raw
  const lower = raw?.trim().toLowerCase()
  if (lower === 'ar') return 'ar-EG'
  if (lower === 'en') return 'en-EG'
  return defaultLocale
}

/** ISO date (yyyy-mm-dd) — ASCII on purpose: stable in the PDF stream. */
function isoDate(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10)
}

interface FindingLike {
  condition?: unknown
  confidence?: unknown
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user, hospitalId } = await requireAuthAndRole(VIEW_ROLES)

  if (error || !user || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const url = new URL(req.url)
  const locale = resolveReportLocale(url.searchParams.get('lang'))
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars)

  const study = await prisma.imagingStudy.findFirst({
    where: { id, hospitalId },
    include: {
      patient: { select: { patientId: true, firstName: true, lastName: true } },
      aiJobs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { reviewedBy: { select: { name: true } } },
      },
    },
  })

  if (!study) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  const job = (study.aiJobs as Array<Record<string, unknown> & {
    findings: unknown
    confidence: number | null
    reviewDecision: string | null
    reviewNotes: string | null
    reviewedAt: Date | null
    acceptedFindings: unknown
    reviewedBy: { name: string } | null
  }>)[0] ?? null

  const conditionLabel = (raw: unknown): string => {
    const name = typeof raw === 'string' && raw.trim() ? raw.trim() : 'AI'
    const key = `imaging.condition.${name}`
    const out = t(key)
    // A missing key returns itself — fall back to the raw class string.
    return out === key ? name : out
  }

  // ---- Embed the original image (read-only, immutable object) -----------
  let image: { data: Buffer; width: number; height: number } | null = null
  let imageUnavailable = false
  try {
    const object = await getStorage().get(study.originalKey)
    const body = Buffer.from(object.body)
    if (study.mimeType === 'image/jpeg') {
      const info = jpegInfo(body)
      if (info) {
        image = { data: body, width: info.width, height: info.height }
      } else {
        imageUnavailable = true
      }
    } else {
      // PNG / WebP → JPEG via jimp (a declared dependency of this branch).
      // Anything that fails — missing module, corrupt file, unsupported
      // codec — degrades to a report without the image; the clinical content
      // must never be lost to a codec problem.
      const { Jimp } = await import('jimp')
      const img = await Jimp.read(body)
      const maxWidth = 1600
      if (img.width > maxWidth) img.resize({ w: maxWidth })
      image = {
        data: Buffer.from(await img.getBuffer('image/jpeg')),
        width: img.width,
        height: img.height,
      }
    }
  } catch {
    imageUnavailable = true
  }

  // ---- Findings table ----------------------------------------------------
  const findings = (job?.findings ?? []) as FindingLike[]
  const findingLines: { text: string; size?: number; bold?: boolean; gapAfter?: number }[] = [
    { text: t('imaging.report.findings_table'), bold: true, gapAfter: 4 },
  ]
  if (findings.length === 0) {
    findingLines.push({ text: t('imaging.no_findings') })
  } else {
    for (const finding of findings) {
      const confidence =
        typeof finding.confidence === 'number' && Number.isFinite(finding.confidence)
          ? Math.round(finding.confidence * 100)
          : null
      findingLines.push({
        // Plain hyphen, not an em dash: a single non-Latin-1 character would
        // push the whole line (including the ASCII condition name) onto the
        // embedded-font path.
        text: `${conditionLabel(finding.condition)}${
          confidence !== null ? ` - ${confidence}%` : ''
        }`,
      })
    }
  }

  // ---- Review block -------------------------------------------------------
  const reviewLines: { text: string; size?: number; bold?: boolean; gapAfter?: number }[] = [
    { text: '', gapAfter: 6 },
    { text: t('imaging.report.review'), bold: true, gapAfter: 4 },
  ]
  const reviewed = !!job && !!job.reviewDecision && !!job.reviewedAt
  if (!reviewed) {
    reviewLines.push({ text: t('imaging.report.not_reviewed') })
  } else {
    const accepted = Array.isArray(job!.acceptedFindings) ? job!.acceptedFindings.length : 0
    reviewLines.push({
      text: `${t('imaging.report.decision')}: ${t(`imaging.review.decision.${job!.reviewDecision}`)}`,
    })
    if (job!.reviewDecision === 'REJECTED') {
      reviewLines.push({ text: t('imaging.report.rejected_all') })
    } else if (job!.reviewDecision === 'ACCEPTED') {
      reviewLines.push({ text: t('imaging.report.accepted_all') })
    } else {
      reviewLines.push({
        text: t('imaging.report.accepted_some', {
          count: accepted,
          total: findings.length,
        }),
      })
    }
    if (job!.reviewNotes) reviewLines.push({ text: job!.reviewNotes })
    if (job!.reviewedBy?.name) {
      reviewLines.push({
        text: `${t('imaging.review.reviewed_by')}: ${job!.reviewedBy.name} - ${isoDate(job!.reviewedAt)}`,
      })
    }
  }

  const lines: { text: string; size?: number; bold?: boolean; gapAfter?: number }[] = [
    { text: `${t('imaging.report.patient')}: ${study.patient ? `${study.patient.firstName} ${study.patient.lastName}`.trim() : '—'}` },
    ...(study.patient?.patientId
      ? [{ text: `${t('imaging.report.patient_id')}: ${study.patient.patientId}` }]
      : []),
    { text: `${t('imaging.report.date')}: ${isoDate(study.studyDate ?? study.createdAt)}` },
    { text: `${t('imaging.report.modality')}: ${t(`imaging.modality.${study.modality}`)}`, gapAfter: 8 },
    ...(imageUnavailable ? [{ text: t('imaging.report.image_unavailable'), gapAfter: 6 }] : []),
    ...findingLines,
    ...reviewLines,
  ]

  const pdf = renderSimplePdf({
    title: t('imaging.report.clinic'),
    subtitle: t('imaging.report.title'),
    lines,
    image: image ?? undefined,
    footer: reviewed
      ? t('imaging.report.footer_reviewed')
      : t('imaging.report.footer_unreviewed'),
  })

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `attachment; filename="imaging-report-${study.id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
