'use client'

/**
 * Phase 19A (D11) — Imaging study detail + Doctor Review.
 * /dashboard/imaging/[id]
 *
 * Shows the immutable original, the AI-annotated result (separate object),
 * the validated findings with confidence (NOT severity), the model
 * provenance, and the mandatory doctor review gate (ACCEPT / MODIFY /
 * REJECT) which persists to AIAnalysisJob and moves the study to REVIEWED.
 */

import { useLanguage } from '@/components/providers/language-provider'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeft, ShieldAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

interface Finding {
  condition: string
  tooth_number: null
  confidence: number
  bounding_box: {
    x: number
    y: number
    width: number
    height: number
    x2: number
    y2: number
    coordinate_space?: string
    units?: string
  }
}

interface Job {
  id: string
  engine: string
  status: string
  modelVersion: string | null
  modelChecksum: string | null
  processingTimeMs: number | null
  findings: Finding[] | null
  confidence: number | null
  errorMessage: string | null
  provenance: {
    engine?: string
    model_version?: string | null
    model_checksum?: string
    model_source?: string
    model_license?: string
    orchestrator_version?: string
    image_sha256?: string
    device?: string
    runtime?: string
    processing_time_ms?: number
    annotated_image_key?: string | null
    timestamp?: string
  } | null
  reviewedById: string | null
  reviewedAt: string | null
  reviewDecision: 'ACCEPTED' | 'MODIFIED' | 'REJECTED' | null
  reviewNotes: string | null
  acceptedFindings: Finding[] | null
  reviewedBy?: { name: string | null } | null
}

interface Study {
  id: string
  patientId: string
  patient: { patientId: string; firstName: string; lastName: string } | null
  modality: string
  status: 'UPLOADED' | 'ANALYZED' | 'REVIEWED'
  originalKey: string
  originalHash: string
  originalSize: number
  aiJobs: Job[]
  originalUrl: string
  annotatedUrl: string | null
}

export default function ImagingStudyDetailPage() {
  const { t } = useLanguage()
  const params = useParams<{ id: string }>()
  const studyId = params?.id

  const [study, setStudy] = useState<Study | null>(null)
  const [notFound, setNotFound] = useState(false)

  // review form
  const [decision, setDecision] = useState<'ACCEPTED' | 'MODIFIED' | 'REJECTED' | null>(null)
  const [notes, setNotes] = useState('')
  const [findingsJson, setFindingsJson] = useState('')
  const [saving, setSaving] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    if (!studyId) return
    const res = await fetch(`/api/imaging/studies/${studyId}`)
    if (res.status === 404) {
      setNotFound(true)
      return
    }
    if (res.ok) {
      const data = await res.json()
      setStudy(data.study)
    }
  }, [studyId])

  useEffect(() => {
    load()
  }, [load])

  const job = study?.aiJobs?.[0] ?? null

  useEffect(() => {
    if (job?.status === 'COMPLETED') {
      setFindingsJson(JSON.stringify(job.findings ?? [], null, 2))
    }
  }, [job?.id, job?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveReview() {
    if (!job || !decision) return
    setReviewError('')
    setSaving(true)
    try {
      const payload: { decision: string; reviewNotes?: string; acceptedFindings?: Finding[] } = {
        decision,
      }
      if (notes) payload.reviewNotes = notes
      if (decision === 'MODIFIED') {
        const parsed = JSON.parse(findingsJson)
        if (!Array.isArray(parsed)) throw new Error('findings must be an array')
        payload.acceptedFindings = parsed
      }
      const res = await fetch(`/api/imaging/jobs/${job.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSaved(true)
        load()
      } else {
        setReviewError(data.error ?? `HTTP ${res.status}`)
      }
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (notFound) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{t('Study not found')}</div>
    )
  }
  if (!study) {
    return <div className="p-6 text-sm text-muted-foreground">…</div>
  }

  const statusBadge =
    study.status === 'REVIEWED' ? (
      <Badge className="bg-green-100 text-green-800">{t('Reviewed')}</Badge>
    ) : study.status === 'ANALYZED' ? (
      <Badge className="bg-blue-100 text-blue-800">{t('Analyzed')}</Badge>
    ) : (
      <Badge className="bg-muted text-muted-foreground">{t('Uploaded')}</Badge>
    )

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => (window.location.href = '/imaging')}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('Back to imaging')}
          </button>
          <h1 className="text-2xl font-bold">
            {study.patient ? `${study.patient.firstName} ${study.patient.lastName}` : study.patientId}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {study.modality === 'PANORAMIC' ? t('Panoramic') : study.modality} · {study.id}
          </p>
        </div>
        {statusBadge}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('Original')}</CardTitle>
            <CardDescription className="break-all">
              {t('Image hash')}: {study.originalHash.slice(0, 32)}… · {study.originalSize} bytes
            </CardDescription>
          </CardHeader>
          <CardContent>
            {study.originalUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={study.originalUrl}
                alt={t('Original')}
                className="w-full rounded-md border bg-black"
              />
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('Annotated result (AI)')}</CardTitle>
          </CardHeader>
          <CardContent>
            {study.annotatedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={study.annotatedUrl}
                alt={t('Annotated result (AI)')}
                className="w-full rounded-md border bg-black"
              />
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>
      </div>

      {job?.status === 'FAILED' && (
        <Card className="border-red-200">
          <CardContent className="pt-6 text-sm text-red-700">
            {t('Job failed: ')} {job.errorMessage}
          </CardContent>
        </Card>
      )}

      {job?.status === 'COMPLETED' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-500" />
                {t('AI Findings')}
              </CardTitle>
              <CardDescription>
                {t('AI findings are suggestions only. A licensed dental professional must review them before clinical use.')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(job.findings ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">{t('No findings detected')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Condition')}</TableHead>
                      <TableHead>{t('Confidence')}</TableHead>
                      <TableHead>{t('Bounding box (x, y, w, h)')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(job.findings ?? []).map((f, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{f.condition}</TableCell>
                        <TableCell>{(f.confidence * 100).toFixed(1)}%</TableCell>
                        <TableCell className="font-mono text-xs">
                          {f.bounding_box.x.toFixed(0)}, {f.bounding_box.y.toFixed(0)},{' '}
                          {f.bounding_box.width.toFixed(0)}, {f.bounding_box.height.toFixed(0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {job.provenance && (
                <div className="mt-6 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                  <div>
                    {t('Engine')}: {job.provenance.engine} · {t('Model version')}:{' '}
                    {job.provenance.model_version}
                  </div>
                  <div>
                    {t('Model checksum')}: <span className="break-all">{job.provenance.model_checksum}</span>
                  </div>
                  <div>
                    {t('Processing time')}: {job.processingTimeMs} ms
                  </div>
                  <div className="break-all">
                    {t('Image hash')}: {job.provenance.image_sha256?.slice(0, 32)}…
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('Doctor Review')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {job.reviewDecision ? (
                <div className="space-y-2 text-sm">
                  <p>
                    {t('Reviewed by')}{' '}
                    <span className="font-medium">{job.reviewedBy?.name ?? job.reviewedById}</span>
                    {job.reviewedAt ? ` · ${new Date(job.reviewedAt).toLocaleString()}` : ''}
                  </p>
                  <Badge
                    className={
                      job.reviewDecision === 'ACCEPTED'
                        ? 'bg-green-100 text-green-800'
                        : job.reviewDecision === 'MODIFIED'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                    }
                  >
                    {job.reviewDecision === 'ACCEPTED'
                      ? t('Accept findings')
                      : job.reviewDecision === 'MODIFIED'
                        ? t('Modify findings')
                        : t('Reject findings')}
                  </Badge>
                  {job.reviewNotes && <p className="text-muted-foreground">{job.reviewNotes}</p>}
                </div>
              ) : saved ? (
                <p className="text-sm text-green-600">{t('Review saved')}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={decision === 'ACCEPTED' ? 'default' : 'outline'}
                      onClick={() => setDecision('ACCEPTED')}
                    >
                      {t('Accept findings')}
                    </Button>
                    <Button
                      variant={decision === 'MODIFIED' ? 'default' : 'outline'}
                      onClick={() => setDecision('MODIFIED')}
                    >
                      {t('Modify findings')}
                    </Button>
                    <Button
                      variant={decision === 'REJECTED' ? 'destructive' : 'outline'}
                      onClick={() => setDecision('REJECTED')}
                    >
                      {t('Reject findings')}
                    </Button>
                  </div>

                  {decision === 'MODIFIED' && (
                    <div className="space-y-1">
                      <Label>{t('Findings (editable JSON for MODIFIED)')}</Label>
                      <Textarea
                        rows={8}
                        className="font-mono text-xs"
                        value={findingsJson}
                        onChange={(e) => setFindingsJson(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label>{t('Review notes')}</Label>
                    <Textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>

                  {reviewError && <p className="text-sm text-red-600">{reviewError}</p>}

                  <Button onClick={saveReview} disabled={!decision || saving}>
                    {saving ? '…' : t('Save review')}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
