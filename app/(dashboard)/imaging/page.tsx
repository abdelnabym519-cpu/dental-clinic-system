'use client'

/**
 * Phase 19A (D11) — Imaging Studies list + upload.
 * /dashboard/imaging
 *
 * Upload stores the original (immutable) in object storage, creates the
 * ImagingStudy, and optionally triggers Liodon analysis for PANORAMIC
 * studies (POST /api/imaging/studies).
 */

import { useLanguage } from '@/components/providers/language-provider'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Scan, Upload as UploadIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

interface PatientOption {
  id: string
  patientId: string
  firstName: string
  lastName: string
}

interface StudyRow {
  id: string
  patientId: string | null
  patientName: string | null
  modality: string
  studyType: string
  status: 'UPLOADED' | 'ANALYZED' | 'REVIEWED'
  createdAt: string
  latestJob: { id: string; status: string; engine: string } | null
}

const MODALITIES = ['PANORAMIC', 'PERIAPICAL', 'BITEWING', 'CBCT', 'THREE_D_SCAN', 'PHOTO'] as const

export default function ImagingStudiesPage() {
  const { t } = useLanguage()
  const router = useRouter()

  const [studies, setStudies] = useState<StudyRow[]>([])
  const [patients, setPatients] = useState<PatientOption[]>([])
  const [loading, setLoading] = useState(true)

  // upload form state
  const [patientId, setPatientId] = useState('')
  const [modality, setModality] = useState<string>('PANORAMIC')
  const [studyDate, setStudyDate] = useState('')
  const [description, setDescription] = useState('')
  const [analyze, setAnalyze] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const [studiesRes, patientsRes] = await Promise.all([
        fetch('/api/imaging/studies'),
        fetch('/api/patients?limit=100'),
      ])
      if (studiesRes.ok) {
        const data = await studiesRes.json()
        setStudies(data.studies ?? [])
      }
      if (patientsRes.ok) {
        const data = await patientsRes.json()
        const list = Array.isArray(data) ? data : data.patients ?? []
        setPatients(list.map((p: any) => ({
          id: p.id,
          patientId: p.patientId,
          firstName: p.firstName,
          lastName: p.lastName,
        })))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    if (!file || !patientId) {
      setMessage({ kind: 'err', text: t('Patient *') })
      return
    }
    const fd = new FormData()
    fd.append('file', file)
    fd.append('patientId', patientId)
    fd.append('modality', modality)
    if (studyDate) fd.append('studyDate', studyDate)
    if (description) fd.append('description', description)
    fd.append('analyze', analyze ? 'true' : 'false')

    setUploading(true)
    try {
      const res = await fetch('/api/imaging/studies', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage({
          kind: 'ok',
          text: data.job?.status === 'FAILED' ? t('Job failed: ') + (data.error ?? '') : t('Uploaded'),
        })
        setFile(null)
        setDescription('')
        setStudyDate('')
        load()
        if (data.study?.id) {
          router.push(`/imaging/${data.study.id}`)
        }
      } else {
        setMessage({ kind: 'err', text: data.error ?? `HTTP ${res.status}` })
      }
    } catch {
      setMessage({ kind: 'err', text: t('Network error. Please try again.') })
    } finally {
      setUploading(false)
    }
  }

  const statusBadge = (status: StudyRow['status']) => {
    const map: Record<string, { label: string; className: string }> = {
      UPLOADED: { label: t('Uploaded'), className: 'bg-muted text-muted-foreground' },
      ANALYZED: { label: t('Analyzed'), className: 'bg-blue-100 text-blue-800' },
      REVIEWED: { label: t('Reviewed'), className: 'bg-green-100 text-green-800' },
    }
    const s = map[status] ?? { label: status, className: '' }
    return <Badge className={s.className}>{s.label}</Badge>
  }

  const jobBadge = (job: StudyRow['latestJob']) => {
    if (!job) return <span className="text-muted-foreground">—</span>
    const map: Record<string, { label: string; className: string }> = {
      PENDING: { label: t('Pending'), className: 'bg-muted text-muted-foreground' },
      PROCESSING: { label: t('Processing'), className: 'bg-amber-100 text-amber-800' },
      COMPLETED: { label: t('Completed'), className: 'bg-green-100 text-green-800' },
      FAILED: { label: t('Failed'), className: 'bg-red-100 text-red-800' },
      CANCELLED: { label: job.status, className: '' },
    }
    const s = map[job.status] ?? { label: job.status, className: '' }
    return <Badge className={s.className}>{s.label}</Badge>
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t('Imaging Studies')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('Upload panoramic and other X-rays; AI analysis (Liodon) runs on panoramic studies.')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('Upload Imaging Study')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('Patient *')}</Label>
              <Select value={patientId} onValueChange={setPatientId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('Select patient…')} />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.patientId} — {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('Modality')}</Label>
              <Select value={modality} onValueChange={setModality}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODALITIES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m === 'PANORAMIC'
                        ? t('Panoramic')
                        : m === 'PERIAPICAL'
                          ? t('Periapical')
                          : m === 'BITEWING'
                            ? t('Bitewing')
                            : m === 'CBCT'
                              ? t('CBCT')
                              : m === 'THREE_D_SCAN'
                                ? t('3D Scan')
                                : t('Photo')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('Study date')}</Label>
              <Input type="date" value={studyDate} onChange={(e) => setStudyDate(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>{t('Description')}</Label>
              <Textarea
                rows={1}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>{t('Choose image')}</Label>
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                {t('JPG, PNG or WebP — up to 50MB')}
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={analyze}
                onChange={(e) => setAnalyze(e.target.checked)}
              />
              {t('Run AI analysis (Liodon, panoramic only)')}
            </label>

            <div className="md:col-span-2 flex items-center gap-3">
              <Button type="submit" disabled={uploading}>
                <UploadIcon className="h-4 w-4 mr-2" />
                {uploading ? '…' : t('Upload')}
              </Button>
              {message && (
                <span className={message.kind === 'ok' ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>
                  {message.text}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Study')}</CardTitle>
          <CardDescription>{t('AI')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">…</p>
          ) : studies.length === 0 ? (
            <EmptyState icon={Scan} title={t('No imaging studies yet')} description={t('Upload Imaging Study')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Patient')}</TableHead>
                  <TableHead>{t('Modality')}</TableHead>
                  <TableHead>{t('Status')}</TableHead>
                  <TableHead>{t('AI')}</TableHead>
                  <TableHead>{t('Date')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {studies.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/imaging/${s.id}`)}
                  >
                    <TableCell className="font-medium">
                      {s.patientName ?? s.patientId}
                    </TableCell>
                    <TableCell>
                      {s.modality === 'PANORAMIC'
                        ? t('Panoramic')
                        : s.modality === 'PERIAPICAL'
                          ? t('Periapical')
                          : s.modality === 'BITEWING'
                            ? t('Bitewing')
                            : s.modality === 'CBCT'
                              ? t('CBCT')
                              : s.modality === 'THREE_D_SCAN'
                                ? t('3D Scan')
                                : s.modality === 'PHOTO'
                                  ? t('Photo')
                                  : s.modality}
                    </TableCell>
                    <TableCell>{statusBadge(s.status)}</TableCell>
                    <TableCell>{jobBadge(s.latestJob)}</TableCell>
                    <TableCell>{new Date(s.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
