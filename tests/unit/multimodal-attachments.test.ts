// @ts-nocheck
/**
 * Phase 6 — attachment service pipeline (§7/§8/§11/§12/§33/§36).
 *
 * The BYTES decide: signatures, tenant keys, server-side patient re-
 * resolution, ImagingStudy reuse, typed failures. Real jimp decode + real
 * local storage driver (tmp UPLOAD_DIR) — only the DB is faked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createAttachmentService } from '@/lib/ai/multimodal/attachments'
import { MultimodalError } from '@/lib/ai/multimodal/types'
import { buildStorageKey, keyBelongsToHospital, resetStorage } from '@/lib/storage'
import {
  pngBuffer, jpegBuffer, dicomBuffer, asciiStlBuffer, objBuffer,
  minimalPdfBuffer, textDocumentBuffer, elfBuffer, pixelBombPng, corruptedPng,
} from '@/tests/fixtures/multimodal-fixture-buffers'

const HOSP_A = 'hosp-a'
const HOSP_B = 'hosp-b'

// ── Tiny in-memory fake (create/update-capable) ────────────────────────────
function whereOk(row: Record<string, any>, where: Record<string, any> | undefined) {
  if (!where) return true
  return Object.entries(where).every(([k, v]) => row[k] === v)
}

function makeTable(initial: Record<string, any>[] = []) {
  const rows = [...initial]
  let n = 0
  return {
    rows,
    findFirst: async (args?: any) => rows.find((r) => whereOk(r, args?.where)) ?? null,
    findMany: async (args?: any) => {
      let out = rows.filter((r) => whereOk(r, args?.where))
      if (args?.orderBy && typeof args.orderBy === 'object') {
        const [field, dir] = Object.entries(args.orderBy)[0] ?? []
        out = [...out].sort((a, b) => (dir === 'asc' ? String(a[field]) < String(b[field]) ? -1 : 1 : 1))
      }
      if (typeof args?.take === 'number') out = out.slice(0, args.take)
      return out
    },
    create: async (args: any) => {
      const row = { id: `row-${++n}`, createdAt: new Date(), ...args.data }
      rows.push(row)
      return row
    },
    update: async (args: any) => {
      const row = rows.find((r) => r.id === args.where.id)
      if (!row) throw new Error('update: row not found')
      Object.assign(row, args.data)
      return row
    },
  }
}

let uploadDir: string
let service: ReturnType<typeof createAttachmentService>
let fake: {
  patient: any; imagingStudy: any; multimodalAttachment: any; auditLog: any
}

const DOCTOR = { id: 'staff-doc-1', role: 'DOCTOR' }
const PATIENT_ACTOR = { id: 'user-portal-1', role: 'PATIENT' }

function patientTable() {
  return makeTable([
    { id: 'pat-a1', hospitalId: HOSP_A, portalUserId: 'user-portal-1', firstName: 'Ahmed', lastName: 'Ali' },
    { id: 'pat-a2', hospitalId: HOSP_A, portalUserId: 'user-portal-2', firstName: 'Sara', lastName: 'Hassan' },
    // Same portal user in ANOTHER tenant — the scope check must catch this.
    { id: 'pat-b1', hospitalId: HOSP_B, portalUserId: 'user-portal-1', firstName: 'Omar', lastName: 'Farouk' },
  ])
}

beforeEach(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'p6-attach-'))
  process.env.UPLOAD_DIR = uploadDir
  process.env.STORAGE_DRIVER = 'local'
  resetStorage()
  fake = {
    patient: patientTable(),
    imagingStudy: makeTable([
      { id: 'study-a1', hospitalId: HOSP_A, patientId: 'pat-a1', modality: 'PERIAPICAL', status: 'UPLOADED' },
    ]),
    multimodalAttachment: makeTable(),
    auditLog: makeTable(),
  }
  service = createAttachmentService(fake)
})

afterEach(async () => {
  resetStorage()
  delete process.env.UPLOAD_DIR
  await rm(uploadDir, { recursive: true, force: true })
})

async function upload(file: { buffer: Buffer; name: string }, over: Record<string, any> = {}) {
  return service.create({
    hospitalId: HOSP_A,
    actor: DOCTOR,
    file: { originalName: file.name, buffer: file.buffer, declaredSize: file.buffer.length },
    patientId: null,
    caseId: null,
    conversationId: 'conv-1',
    declaredModality: null,
    linkedStudyId: null,
    source: 'CHAT_UPLOAD',
    ...over,
  })
}

// ── 2D images ───────────────────────────────────────────────────────────────
describe('attachment service — 2D images', () => {
  it('stores a PNG with DECLARED modality + creates the reused imaging study row', async () => {
    const rec = await upload({ buffer: await pngBuffer(), name: 'pano.png' }, { patientId: 'pat-a1', declaredModality: 'PANORAMIC' })

    expect(rec.status).toBe('PROCESSED')
    expect(rec.fileClass).toBe('IMAGE_2D')
    expect(rec.mediaType).toBe('image/png')
    expect(rec.dentalModality).toBe('PANORAMIC')
    expect(rec.modalityOrigin).toBe('DECLARED')
    expect(rec.dentalImageState).toBe('CLASSIFIED')
    expect(rec.width).toBe(48)
    expect(rec.height).toBe(32)
    expect(rec.pixelCount).toBe(48 * 32)
    expect(rec.studyId).toBeTruthy()
    // Tenant-prefixed key, unguessable (uuid) — never the client filename.
    expect(keyBelongsToHospital(rec.storageKey, HOSP_A)).toBe(true)
    expect(rec.storageKey).not.toContain('pano.png')
    // The original bytes live at the row key; a grayscale derivative exists.
    const study = fake.imagingStudy.rows.find((s) => s.id === rec.studyId)
    expect(study.studyType).toBe('CHAT_UPLOAD')
    expect(study.patientId).toBe('pat-a1')
  })

  it('an unclassified image from a PATIENT actor is UNKNOWN_DENTAL_IMAGE (never guessed)', async () => {
    const rec = await upload(
      { buffer: await pngBuffer(), name: 'pic.png' },
      { actor: PATIENT_ACTOR, patientId: 'pat-a1', declaredModality: 'PANORAMIC' },
    )
    expect(rec.status).toBe('PROCESSED')
    // Patient actors cannot declare modality — and there is no classifier.
    expect(rec.dentalModality).toBeNull()
    expect(rec.modalityOrigin).toBe('NONE')
    expect(rec.dentalImageState).toBe('UNKNOWN_DENTAL_IMAGE')
    // No study row without an established modality.
    expect(rec.studyId).toBeNull()
  })

  it('a linked study supplies the TRUSTED modality (origin STUDY)', async () => {
    const rec = await upload({ buffer: await jpegBuffer(), name: 'x.jpg' }, { linkedStudyId: 'study-a1' })
    expect(rec.patientId).toBe('pat-a1')
    expect(rec.dentalModality).toBe('PERIAPICAL')
    expect(rec.modalityOrigin).toBe('STUDY')
  })

  it('pixel bomb → OVERSIZED_INPUT, row marked FAILED, bytes cleaned up', async () => {
    const before = fake.multimodalAttachment.rows.length
    await expect(
      upload({ buffer: await pixelBombPng(), name: 'bomb.png' }, { patientId: 'pat-a1', declaredModality: 'PANORAMIC' }),
    ).rejects.toMatchObject({ code: 'OVERSIZED_INPUT' })
    const rows = fake.multimodalAttachment.rows.slice(before)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('FAILED')
    expect(rows[0].failureCode).toBe('OVERSIZED_INPUT')
    // No bytes remain at the storage key.
    const { getStorage } = await import('@/lib/storage')
    await expect(getStorage().get(rows[0].storageKey)).rejects.toBeTruthy()
  })

  it('undecodable image bytes (signature ok, decode fails) → INVALID_FORMAT, FAILED row', async () => {
    const before = fake.multimodalAttachment.rows.length
    await expect(
      upload({ buffer: corruptedPng(), name: 'bad.png' }, { patientId: 'pat-a1', declaredModality: 'PANORAMIC' }),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' })
    expect(fake.multimodalAttachment.rows.slice(before)[0].status).toBe('FAILED')
  })
})

// ── MIME spoofing / hostile files ──────────────────────────────────────────
describe('attachment service — bytes decide, names lie', () => {
  it('MIME spoof: PDF bytes with .png extension → classified DOCUMENT_PDF (bytes win)', async () => {
    const rec = await upload({ buffer: minimalPdfBuffer('plain note'), name: 'note.png' })
    expect(rec.fileClass).toBe('DOCUMENT_PDF')
    expect(rec.mediaType).toBe('application/pdf')
    expect(rec.status).toBe('PROCESSED')
  })

  it('ELF executable with .png extension → UNKNOWN, stored inert, never an image', async () => {
    const rec = await upload({ buffer: elfBuffer(), name: 'tool.png' })
    expect(rec.fileClass).toBe('UNKNOWN')
    expect(rec.mediaType).toBe('application/octet-stream')
    expect(rec.dentalModality).toBeNull()
    expect(rec.studyId).toBeNull()
  })

  it('declared size mismatch → INVALID_FILE before any write', async () => {
    const buf = await pngBuffer()
    await expect(
      service.create({
        hospitalId: HOSP_A, actor: DOCTOR,
        file: { originalName: 'x.png', buffer: buf, declaredSize: buf.length + 100 },
        patientId: null, caseId: null, conversationId: 'conv-1',
        declaredModality: null, linkedStudyId: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' })
  })

  it('oversized DICOM (declared) → OVERSIZED_INPUT', async () => {
    const big = Buffer.concat([dicomBuffer(), Buffer.alloc(501 * 1024 * 1024)])
    await expect(
      upload({ buffer: big, name: 'vol.dcm' }),
    ).rejects.toMatchObject({ code: 'OVERSIZED_INPUT' })
  })
})

// ── DICOM: ingestion only ───────────────────────────────────────────────────
describe('attachment service — DICOM (ingestion only, §26)', () => {
  it('stores the volume, records VOLUME_DICOM, creates NO study row, claims no AI', async () => {
    const rec = await upload({ buffer: dicomBuffer(), name: 'cbct.dcm' }, { patientId: 'pat-a1' })
    expect(rec.fileClass).toBe('VOLUME_DICOM')
    expect(rec.mediaType).toBe('application/dicom')
    expect(rec.status).toBe('PROCESSED')
    expect(rec.studyId).toBeNull() // DICOM never becomes an analyzable study
  })
})

// ── Documents (§25) ─────────────────────────────────────────────────────────
describe('attachment service — documents', () => {
  it('extracts PDF text with page provenance and stores it under the tenant key', async () => {
    const rec = await upload(
      { buffer: minimalPdfBuffer('patient said: I have pain in tooth 36.'), name: 'record.pdf' },
      { patientId: 'pat-a1' },
    )
    expect(rec.fileClass).toBe('DOCUMENT_PDF')
    expect(rec.status).toBe('PROCESSED')
    expect(rec.pageCount).toBe(1)
    expect(rec.extractedTextKey).toBeTruthy()
    expect(keyBelongsToHospital(rec.extractedTextKey!, HOSP_A)).toBe(true)
    const { getStorage } = await import('@/lib/storage')
    const stored = await getStorage().get(rec.extractedTextKey!)
    expect(stored.body.toString('utf8')).toContain('tooth 36')
  })

  it('text document passthrough with char bounds', async () => {
    const rec = await upload({ buffer: textDocumentBuffer('plain note'), name: 'note.txt' })
    expect(rec.fileClass).toBe('DOCUMENT_TEXT')
    expect(rec.status).toBe('PROCESSED')
    expect(rec.extractedTextKey).toBeTruthy()
  })
})

// ── Meshes ──────────────────────────────────────────────────────────────────
describe('attachment service — 3D meshes', () => {
  it('ASCII STL → MESH_3D, THREE_D_SCAN (deterministic, no guess)', async () => {
    const rec = await upload({ buffer: asciiStlBuffer(), name: 'scan.stl' }, { patientId: 'pat-a1' })
    expect(rec.fileClass).toBe('MESH_3D')
    expect(rec.dentalModality).toBe('THREE_D_SCAN')
    expect(rec.status).toBe('PROCESSED')
    expect(rec.studyId).toBeTruthy()
  })

  it('staff-declared CBCT mesh stays CBCT; OBJ detected by directives', async () => {
    const rec = await upload({ buffer: objBuffer(), name: 'm.obj' }, { patientId: 'pat-a1', declaredModality: 'CBCT' })
    expect(rec.fileClass).toBe('MESH_3D')
    expect(rec.dentalModality).toBe('CBCT')
    expect(rec.modalityOrigin).toBe('DECLARED')
  })
})

// ── Tenant / scope boundaries (§33/§36) ────────────────────────────────────
describe('attachment service — tenant and patient scope', () => {
  it('PATIENT actor may only attribute to their OWN portal patient', async () => {
    // pat-a2 belongs to a DIFFERENT portal user.
    await expect(
      upload({ buffer: await pngBuffer(), name: 'p.png' }, { actor: PATIENT_ACTOR, patientId: 'pat-a2' }),
    ).rejects.toMatchObject({ code: 'PATIENT_SCOPE_MISMATCH' })
  })

  it('PATIENT actor attaching to own record works', async () => {
    const rec = await upload({ buffer: await pngBuffer(), name: 'p.png' }, { actor: PATIENT_ACTOR, patientId: 'pat-a1' })
    expect(rec.patientId).toBe('pat-a1')
  })

  it('staff referencing a foreign-tenant patient → PATIENT_SCOPE_MISMATCH', async () => {
    await expect(
      upload({ buffer: await pngBuffer(), name: 'p.png' }, { patientId: 'pat-b1' }),
    ).rejects.toMatchObject({ code: 'PATIENT_SCOPE_MISMATCH' })
  })

  it('forged linked study id → FORGED_ATTACHMENT_ID', async () => {
    await expect(
      upload({ buffer: await pngBuffer(), name: 'p.png' }, { linkedStudyId: 'study-does-not-exist' }),
    ).rejects.toMatchObject({ code: 'FORGED_ATTACHMENT_ID' })
  })

  it('linked study of a different patient than claimed → PATIENT_SCOPE_MISMATCH', async () => {
    await expect(
      upload({ buffer: await pngBuffer(), name: 'p.png' }, { linkedStudyId: 'study-a1', patientId: 'pat-a2' }),
    ).rejects.toMatchObject({ code: 'PATIENT_SCOPE_MISMATCH' })
  })

  it('get() is tenant-scoped: another tenant cannot read the row', async () => {
    const rec = await upload({ buffer: await pngBuffer(), name: 'p.png' }, { patientId: 'pat-a1' })
    expect(await service.get(rec.id, HOSP_A)).not.toBeNull()
    expect(await service.get(rec.id, HOSP_B)).toBeNull()
    expect(await service.get('att-forged-id-00000000', HOSP_A)).toBeNull()
  })
})

// ── Filename boundary ───────────────────────────────────────────────────────
describe('attachment service — filename sanitization (§33)', () => {
  it('path traversal in the name → PATH_TRAVERSAL_REJECTED', async () => {
    await expect(
      upload({ buffer: await pngBuffer(), name: '../../etc/passwd.png' }),
    ).rejects.toMatchObject({ code: 'PATH_TRAVERSAL_REJECTED' })
  })

  it('script/HTML in the name is neutralized (no tag/attribute structure remains)', async () => {
    const rec = await upload({ buffer: await pngBuffer(), name: '<img src=x onerror=alert(1)>.png' })
    expect(rec.originalName).not.toContain('<')
    expect(rec.originalName).not.toContain('>')
    expect(rec.originalName).not.toContain('"')
    expect(rec.originalName).not.toContain("'")
  })
})

// ── Typed error surface + unknown files ────────────────────────────────────
it('unrecognized/empty bytes → stored inert as UNKNOWN (no analysis is claimed)', async () => {
  const rec = await upload({ buffer: Buffer.alloc(0), name: 'empty.bin' })
  expect(rec.status).toBe('PROCESSED')
  expect(rec.fileClass).toBe('UNKNOWN')
  expect(rec.dentalModality).toBeNull()
  expect(rec.studyId).toBeNull()
})

it('every failure is a typed MultimodalError (no raw/infra leaks)', async () => {
  try {
    await upload({ buffer: await pngBuffer(), name: '../../x.png' })
    throw new Error('expected traversal rejection')
  } catch (err) {
    expect(err).toBeInstanceOf(MultimodalError)
    expect((err as MultimodalError).code).toBe('PATH_TRAVERSAL_REJECTED')
    expect((err as MultimodalError).message).not.toMatch(/e2b|\/home\/user|ENOENT/)
  }
})
