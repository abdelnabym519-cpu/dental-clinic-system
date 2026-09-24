'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '@/components/providers/language-provider'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Lock, Pencil, StickyNote, Trash2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Note {
  id: string
  content: string
  noteType: string
  isPrivate: boolean
  createdAt: string
  doctor: { id: string; firstName: string; lastName: string }
}

const NOTE_TYPES = ['GENERAL', 'EXAMINATION', 'TREATMENT', 'FOLLOW_UP', 'REFERRAL']

const TYPE_COLORS: Record<string, string> = {
  GENERAL: 'bg-zinc-100 text-zinc-700',
  EXAMINATION: 'bg-sky-100 text-sky-800',
  TREATMENT: 'bg-violet-100 text-violet-800',
  FOLLOW_UP: 'bg-amber-100 text-amber-800',
  REFERRAL: 'bg-pink-100 text-pink-800',
}

/**
 * Phase 11 — clinical notes panel (embedded in the appointment detail).
 * Composer (type + privacy) for DOCTOR/ADMIN; list newest-first. The API
 * hides isPrivate notes from non-clinical roles, enforces own-notes-only
 * editing within 24h, and DOCTOR/ADMIN deletion.
 */
export function ClinicalNotesPanel({
  appointmentId,
  canEdit,
}: {
  appointmentId: string
  canEdit: boolean
}) {
  const { t, locale } = useLanguage()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const [content, setContent] = useState('')
  const [noteType, setNoteType] = useState('GENERAL')
  const [isPrivate, setIsPrivate] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clinical-notes?appointmentId=${appointmentId}`)
      if (!res.ok) throw new Error(t('clinical.load_error'))
      setError('')
      const data = await res.json()
      setNotes(data.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setLoading(false)
    }
  }, [appointmentId, t])

  useEffect(() => {
    void load()
  }, [load])

  const addNote = async () => {
    if (!content.trim()) return
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/clinical-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId, content, noteType, isPrivate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('clinical.load_error'))
      setContent('')
      setIsPrivate(false)
      setMessage(t('clinical.saved'))
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async (id: string) => {
    if (!editContent.trim()) return
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`/api/clinical-notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('clinical.load_error'))
      setEditingId(null)
      setMessage(t('clinical.saved'))
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setBusy(false)
    }
  }

  const deleteNote = async (id: string) => {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`/api/clinical-notes/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('clinical.load_error'))
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('clinical.load_error'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('ui.loading')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800" role="status">
          {message}
        </p>
      )}

      {canEdit && (
        <div className="space-y-2 rounded-md border p-3">
          <Label className="flex items-center gap-1 text-sm">
            <StickyNote className="h-3.5 w-3.5" /> {t('clinical.new_note')}
          </Label>
          <Textarea
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('clinical.add_note')}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Select value={noteType} onValueChange={setNoteType}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTE_TYPES.map((nt) => (
                  <SelectItem key={nt} value={nt}>
                    {t(`clinical.note_types.${nt}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={isPrivate} onCheckedChange={(v) => setIsPrivate(v === true)} />
              {t('clinical.private_note')}
            </label>
            <Button className="ml-auto" onClick={addNote} disabled={busy || !content.trim()}>
              {busy ? t('ui.loading') : t('clinical.add_note')}
            </Button>
          </div>
        </div>
      )}

      {notes.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t('clinical.no_notes')}</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div key={note.id} className="rounded-md border p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge className={TYPE_COLORS[note.noteType] ?? 'bg-zinc-100 text-zinc-700'}>
                  {t(`clinical.note_types.${note.noteType}`)}
                </Badge>
                {note.isPrivate && (
                  <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700">
                    <Lock className="h-3 w-3" /> {t('clinical.private_badge')}
                  </Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  Dr. {note.doctor.firstName} {note.doctor.lastName} ·{' '}
                  {new Date(note.createdAt).toLocaleString(locale)}
                </span>
              </div>
              {editingId === note.id ? (
                <div className="space-y-2">
                  <Textarea
                    rows={3}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => saveEdit(note.id)}
                      disabled={busy || !editContent.trim()}
                    >
                      {t('common.save')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm">{note.content}</p>
              )}
              {canEdit && editingId !== note.id && (
                <div className="mt-2 flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setEditingId(note.id)
                      setEditContent(note.content)
                    }}
                  >
                    <Pencil className="mr-1 h-3 w-3" /> {t('ui.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive"
                    onClick={() => {
                      if (window.confirm(t('clinical.delete_note'))) void deleteNote(note.id)
                    }}
                    disabled={busy}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> {t('ui.delete')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
