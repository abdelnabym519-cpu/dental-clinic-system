'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Upload, X } from 'lucide-react'

import { useLanguage } from '@/components/providers/language-provider'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Phase 20 (D3) — X-ray upload with automatic AI trigger.
//
// The 19A upload endpoint is synchronous for PANORAMIC (Liodon runs during
// the POST), so the common path resolves with the findings already on the
// wire. The polling below still implements the contract for the async edge
// (a PENDING/PROCESSING job) — spec D4: GET .../status every 2s.
//
// Non-PANORAMIC studies never trigger AI (19A D10.1). The UI mirrors the
// server rule proactively: the analyze switch locks off for other modalities,
// and the 422 branch remains the authoritative backstop.

interface ImagingUploadProps {
  patientId: string
  /** Pre-filled when arriving from the appointment panel (D8). */
  appointmentId?: string | null
  onUploadComplete: (studyId: string) => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'analyzing' }
  | { kind: 'done'; studyId: string }
  | { kind: 'error'; message: string; retryable: boolean }

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 50 * 1024 * 1024 // 50 MB
const MODALITIES = ['PANORAMIC', 'PERIAPICAL', 'BITEWING', 'CBCT', 'THREE_D_SCAN', 'PHOTO'] as const

export function ImagingUpload({ patientId, appointmentId = null, onUploadComplete }: ImagingUploadProps) {
  const { t } = useLanguage()
  const { toast } = useToast()

  const [file, setFile] = useState<File | null>(null)
  const [modality, setModality] = useState<string>('PANORAMIC')
  const [analyze, setAnalyze] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const analyzingLocked = modality !== 'PANORAMIC'

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const pickFile = useCallback(
    (candidate: File | null) => {
      if (!candidate) return
      if (!ACCEPTED_TYPES.includes(candidate.type)) {
        toast({
          variant: 'destructive',
          title: t('imaging.unsupported_type'),
          description: t('imaging.drop_zone'),
        })
        return
      }
      if (candidate.size > MAX_SIZE) {
        toast({
          variant: 'destructive',
          title: '50MB',
          description: t('Image exceeds 50MB limit'),
        })
        return
      }
      stopPolling()
      setFile(candidate)
      setPhase({ kind: 'idle' })
    },
    [toast, t, stopPolling]
  )

  const startPolling = useCallback(
    (studyId: string) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/imaging/studies/${studyId}/status`)
          if (!res.ok) return
          const body = await res.json()
          if (body.status === 'ANALYZED' || body.status === 'REVIEWED') {
            stopPolling()
            setPhase({ kind: 'done', studyId })
            onUploadComplete(studyId)
          } else if (body.latestJob && body.latestJob.status === 'FAILED') {
            stopPolling()
            setPhase({
              kind: 'error',
              message: body.latestJob.errorMessage || t('imaging.analysis_failed'),
              retryable: true,
            })
          }
        } catch {
          // Transient network errors do not abort the poll.
        }
      }, 2000)
    },
    [onUploadComplete, stopPolling, t]
  )

  const doUpload = useCallback(
    (candidate: File) => {
      const form = new FormData()
      form.append('file', candidate)
      form.append('patientId', patientId)
      form.append('modality', modality)
      if (appointmentId) form.append('appointmentId', appointmentId)
      form.append('analyze', analyze ? 'true' : 'false')

      setPhase({ kind: 'uploading', progress: 0 })

      // XHR (not fetch) — the only built-in way to observe upload progress.
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/imaging/studies')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setPhase({ kind: 'uploading', progress: Math.round((e.loaded / e.total) * 100) })
        }
      }
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || '{}')
          const studyId: string | undefined = body.study?.id
          if (xhr.status === 201) {
            if (!studyId) throw new Error(t('imaging.missing_study_id'))
            const jobStatus = body.job?.status
            if (jobStatus === 'PENDING' || jobStatus === 'PROCESSING') {
              setPhase({ kind: 'analyzing' })
              startPolling(studyId)
            } else {
              setPhase({ kind: 'done', studyId })
              onUploadComplete(studyId)
            }
            return
          }
          if (xhr.status === 422) {
            // The study itself WAS uploaded — only the AI trigger was refused
            // (non-PANORAMIC). Surface the server message and list the study.
            // body.error is a dictionary key (19A i18n contract), not prose.
            toast({
              variant: 'destructive',
              title: t('imaging.run_ai'),
              description: body.error ? t(body.error) : '422',
            })
            if (studyId) {
              setPhase({ kind: 'done', studyId })
              onUploadComplete(studyId)
            } else {
              setPhase({ kind: 'error', message: body.error || '422', retryable: false })
            }
            return
          }
          setPhase({
            kind: 'error',
            message: body.error || `HTTP ${xhr.status}`,
            // A 502 leaves a FAILED job we can retry by re-uploading the file
            // as a new study; keep it simple and retryable for all failures.
            retryable: true,
          })
        } catch (err) {
          setPhase({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
            retryable: true,
          })
        }
      }
      xhr.onerror = () => {
        setPhase({ kind: 'error', message: t('imaging.review.network_error'), retryable: true })
      }
      xhr.send(form)
    },
    [patientId, appointmentId, modality, analyze, onUploadComplete, startPolling, t, toast]
  )

  const reset = () => {
    stopPolling()
    setFile(null)
    setPhase({ kind: 'idle' })
    if (inputRef.current) inputRef.current.value = ''
  }

  const busy = phase.kind === 'uploading' || phase.kind === 'analyzing'

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">{t('imaging.upload')}</h3>
          {(file || phase.kind !== 'idle') && !busy && (
            <Button size="sm" variant="ghost" onClick={reset} className="gap-1 text-xs">
              <X className="h-3.5 w-3.5" />
              {t('imaging.cancel')}
            </Button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              pickFile(e.dataTransfer.files?.[0] ?? null)
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') inputRef.current?.click()
            }}
            className={`flex min-h-[96px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-3 text-center transition-colors ${
              dragOver ? 'border-primary bg-accent' : 'border-border hover:border-primary/50'
            }`}
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('imaging.drop_zone')}</p>
            {file && <p className="text-xs font-medium">{file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB</p>}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Options */}
          <div className="flex flex-col justify-between gap-3">
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('imaging.study_type')}</label>
                <Select value={modality} onValueChange={(v) => { setModality(v); if (v !== 'PANORAMIC') setAnalyze(false) }}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODALITIES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`imaging.modality.${m}`) === `imaging.modality.${m}` ? m : t(`imaging.modality.${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={analyze}
                  disabled={analyzingLocked}
                  onChange={(e) => setAnalyze(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                {t('imaging.run_ai')}
                {analyzingLocked && (
                  <span className="text-xs text-muted-foreground">
                    ({t('AI analysis is only supported for PANORAMIC studies')})
                  </span>
                )}
              </label>
            </div>

            <Button
              onClick={() => file && doUpload(file)}
              disabled={!file || busy}
              className="gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t('imaging.upload')}
            </Button>
          </div>
        </div>

        {/* Phase feedback */}
        {phase.kind === 'uploading' && (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-muted-foreground">{t('imaging.uploading')}</p>
            <Progress value={phase.progress} className="h-2" />
          </div>
        )}
        {phase.kind === 'analyzing' && (
          <p className="mt-3 flex items-center gap-2 text-sm text-amber-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('imaging.analyzing')}
          </p>
        )}
        {phase.kind === 'done' && (
          <p className="mt-3 flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
            {t('imaging.analysis_complete')}
          </p>
        )}
        {phase.kind === 'error' && (
          <div className="mt-3 flex items-center justify-between gap-2 text-sm text-red-600">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {phase.message}
            </span>
            {phase.retryable && file && (
              <Button size="sm" variant="outline" onClick={() => doUpload(file)} className="gap-1">
                <RefreshCw className="h-3.5 w-3.5" />
                {t('imaging.retry')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
