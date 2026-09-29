'use client'

import { useCallback, useEffect, useState, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  ArrowLeft,
  Camera,
  Download,
  Loader2,
  ScanEye,
  ShieldAlert,
} from 'lucide-react'

import { useLanguage } from '@/components/providers/language-provider'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'

import { ImagingUpload } from '@/components/imaging/ImagingUpload'
import { StudyList } from '@/components/imaging/StudyList'
import { FindingsViewer } from '@/components/imaging/FindingsViewer'
import { FindingCard } from '@/components/imaging/FindingCard'
import { DoctorReviewPanel, type ReviewDecision } from '@/components/imaging/DoctorReviewPanel'
import {
  derivedStudyStatus,
  isBoxFinding,
  isLandmarkFinding,
  type ImagingJob,
  type ImagingStudyDetail,
  type ImagingStudySummary,
} from '@/components/imaging/types'

// Phase 20 (D2) — the imaging platform page inside the patient file.
//
//   /patients/[id]/imaging
//
// Layout: upload zone (D3) + study list (D7) on the left; the selected
// study's original/annotated image with live bounding boxes (D5), its
// findings (D5) and the doctor review gate (D6) on the right.
//
// RBAC mirrors the API: DOCTOR/ADMIN may upload and review, RECEPTIONIST
// views only, ACCOUNTANT has no imaging surface (spec).
//
// Query params: ?study=<id> deep-links a study (from the list / appointment
// panel), ?appointmentId=<id> pre-fills the upload form (D8).

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export default function PatientImagingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { t, locale } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const { status: sessionStatus, data: session } = useSession()

  const role = session?.user?.role
  const canEdit = role === 'DOCTOR' || role === 'ADMIN'
  const blocked = role === 'ACCOUNTANT'

  const [patientName, setPatientName] = useState<string | null>(null)
  const [studies, setStudies] = useState<ImagingStudySummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ImagingStudyDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedFinding, setSelectedFinding] = useState<number | null>(null)

  // Set once from the URL on mount (?appointmentId= from the appointment
  // panel, D8).
  const [appointmentId, setAppointmentId] = useState<string | null>(null)

  const fetchPatientName = useCallback(async () => {
    try {
      const res = await fetch(`/api/patients/${id}`)
      if (res.ok) {
        const data = await res.json()
        const p = data.patient
        if (p) setPatientName(`${p.firstName} ${p.lastName}`.trim())
      }
    } catch {
      // The name is cosmetic — the page works without it.
    }
  }, [id])

  const fetchStudies = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await fetch(`/api/imaging/studies?patientId=${encodeURIComponent(id)}`)
      if (res.ok) {
        const data = await res.json()
        setStudies(data.studies ?? [])
      } else if (res.status === 403) {
        toast({ variant: 'destructive', title: t('imaging.no_access') })
      }
    } catch {
      // Network hiccups keep the previous list.
    } finally {
      setListLoading(false)
    }
  }, [id, t, toast])

  const loadDetail = useCallback(
    async (studyId: string) => {
      setDetailLoading(true)
      setSelectedFinding(null)
      try {
        const res = await fetch(`/api/imaging/studies/${studyId}`)
        if (res.ok) {
          const data = await res.json()
          setDetail(data.study)
        } else {
          setDetail(null)
          if (res.status !== 404) {
            toast({ variant: 'destructive', title: t('imaging.no_access') })
          }
        }
      } catch {
        setDetail(null)
      } finally {
        setDetailLoading(false)
      }
    },
    [t, toast]
  )

  // Query params are read once on mount (the patient file uses the same
  // window-location pattern — no useSearchParams prerender boundary needed).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setAppointmentId(q.get('appointmentId'))
    const studyParam = q.get('study')
    if (studyParam) {
      setSelectedId(studyParam)
      void loadDetail(studyParam)
    }
  }, [loadDetail])

  useEffect(() => {
    fetchPatientName()
    fetchStudies()
  }, [fetchPatientName, fetchStudies])

  const selectStudy = (studyId: string) => {
    setSelectedId(studyId)
    router.replace(`/patients/${id}/imaging?study=${studyId}`, { scroll: false })
    void loadDetail(studyId)
  }

  const onUploadComplete = useCallback(
    (studyId: string) => {
      void fetchStudies()
      selectStudy(studyId)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchStudies, id]
  )

  const onReviewComplete = useCallback(
    async (_decision: ReviewDecision) => {
      if (selectedId) await loadDetail(selectedId)
      await fetchStudies()
    },
    [selectedId, loadDetail, fetchStudies]
  )

  if (sessionStatus === 'loading') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  if (blocked) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('imaging.no_access')}</p>
        <Button variant="outline" onClick={() => router.push(`/patients/${id}`)}>
          <ArrowLeft className="me-2 h-4 w-4" />
          {t('Back to imaging')}
        </Button>
      </div>
    )
  }

  const job: ImagingJob | null = detail?.aiJobs?.[0] ?? null
  const findings = job?.findings ?? []
  const status = detail ? derivedStudyStatus(detail.status, job) : null
  const reviewed = !!job?.reviewDecision && !!job?.reviewedAt
  const reviewMode = !!job && job.status === 'COMPLETED' && !job.reviewDecision && canEdit

  const decisionKey = job?.reviewDecision ? `imaging.review.decision.${job.reviewDecision}` : ''
  const decisionOut = job?.reviewDecision ? t(decisionKey) : ''

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push(`/patients/${id}`)}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>
        <div className="flex items-center gap-2">
          <ScanEye className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">
            {t('imaging.header')}
            {patientName && <span className="text-muted-foreground"> · {patientName}</span>}
          </h1>
        </div>
        <div className="ms-auto">
          {detail && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                window.open(`/api/imaging/studies/${detail.id}/report?lang=${locale}`, '_blank')
              }}
            >
              <Download className="h-4 w-4" />
              {t('imaging.download_report')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px,1fr]">
        {/* Left: upload + list */}
        <div className="space-y-4">
          {canEdit && (
            <ImagingUpload
              patientId={id}
              appointmentId={appointmentId}
              onUploadComplete={onUploadComplete}
            />
          )}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('imaging.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {listLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : (
                <StudyList studies={studies} selectedId={selectedId} onSelect={selectStudy} />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: detail */}
        <div className="min-w-0 space-y-4">
          {!detail && !detailLoading && (
            <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
              <Camera className="h-6 w-6" />
              {t('imaging.select_study')}
            </div>
          )}
          {detailLoading && (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {detail && (
            <>
              {/* Study meta */}
              <Card>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
                  <span className="font-medium">{t(`imaging.modality.${detail.modality}`)}</span>
                  <Badge variant="outline">{formatDate(detail.studyDate ?? detail.createdAt)}</Badge>
                  {status && (
                    <Badge variant="secondary">{t(`imaging.status.${status}`)}</Badge>
                  )}
                  {job?.processingTimeMs != null && (
                    <span className="text-xs text-muted-foreground">
                      {t('imaging.processing_time')}: {job.processingTimeMs} ms
                    </span>
                  )}
                  {job?.modelVersion && (
                    <span className="text-xs text-muted-foreground">
                      {t('imaging.model_version')}: {job.modelVersion}
                    </span>
                  )}
                </CardContent>
              </Card>

              {/* Image + overlays. Phase 20B: 3D studies store a mesh file,
                  not an image — the viewer's <img> would be broken, so show
                  a file card instead (findings + review render below either
                  way). */}
              {detail.modality === 'THREE_D_SCAN' || detail.modality === 'CBCT' ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center gap-1 p-10 text-center">
                    <Camera className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm font-medium">{t('imaging.3d_analysis')}</p>
                    <p className="text-xs text-muted-foreground">{t('imaging.mesh_file')}</p>
                  </CardContent>
                </Card>
              ) : (
                <FindingsViewer
                  imageUrl={detail.originalUrl}
                  annotatedUrl={detail.annotatedUrl}
                  findings={findings}
                  readonly={reviewed}
                  selectedFinding={selectedFinding}
                  onFindingClick={setSelectedFinding}
                />
              )}

              {/* Findings + review */}
              {job && findings.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {t('imaging.findings')} ({findings.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {findings.map((f, i) => (
                        <FindingCard
                          key={
                            isBoxFinding(f)
                              ? `box-${f.bounding_box.x}-${f.bounding_box.y}-${i}`
                              : isLandmarkFinding(f)
                                ? `lm-${f.landmark_id}-${i}`
                                : `seg-${f.class_id}-${i}`
                          }
                          finding={f}
                          index={i}
                          selected={selectedFinding === i}
                          onSelect={(idx) => setSelectedFinding(idx === selectedFinding ? null : idx)}
                        />
                      ))}
                    </div>

                    {reviewMode && job && (
                      <>
                        <Separator />
                        <DoctorReviewPanel
                          jobId={job.id}
                          findings={findings}
                          onReviewComplete={onReviewComplete}
                        />
                      </>
                    )}

                    {reviewed && job && (
                      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
                        <p className="font-medium text-emerald-700 dark:text-emerald-400">
                          {decisionOut === decisionKey ? job.reviewDecision : decisionOut}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('imaging.review.reviewed_by')}: {job.reviewedBy?.name ?? '—'} - {formatDate(job.reviewedAt)}
                          {Array.isArray(job.acceptedFindings) && (
                            <> · {t('imaging.findings_count', { count: job.acceptedFindings.length })}</>
                          )}
                        </p>
                        {job.reviewNotes && (
                          <p className="mt-2 whitespace-pre-wrap text-xs">{job.reviewNotes}</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {job && job.status === 'FAILED' && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-400">
                  {t('imaging.analysis_failed')}
                  {job.errorMessage && (
                    <p className="mt-1 text-xs opacity-80">{job.errorMessage}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
