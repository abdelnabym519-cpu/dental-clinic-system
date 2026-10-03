// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

// Issue 5 — /patients/:id/medical-history was a 404 (linked from the patients
// list, never built) and prescriptions were invisible in the patient file.
// These tests lock the shared history view + the prescriptions tab contract.

vi.mock('@/components/providers/language-provider', () => ({
  useLanguage: () => ({ t: (k: string) => k, lang: 'ar' }),
}))

import { MedicalHistoryView } from '@/components/patients/medical-history-view'
import { PatientPrescriptions } from '@/components/patients/patient-prescriptions'

const FULL_HISTORY = {
  bloodGroup: 'A_POSITIVE',
  medicalHistory: {
    hasAllergies: true,
    drugAllergies: 'بنسلين',
    hasDiabetes: true,
    diabetesType: 'TYPE_2',
    hasHypertension: true,
    currentMedications: 'ميتفورمين 500',
    previousDentalWork: 'علاج جذري للسن 36',
    familyDentalHistory: 'تسوس متكرر',
    smokingStatus: 'NEVER',
    lastDentalVisit: '2026-08-01T00:00:00.000Z',
  },
}

describe('MedicalHistoryView (Issue 5)', () => {
  it('renders recorded allergies, chronic conditions and dental history in Arabic', () => {
    render(<MedicalHistoryView patient={FULL_HISTORY} />)
    expect(screen.getByText('حساسية أدوية: بنسلين')).toBeInTheDocument()
    expect(screen.getByText('السكري (TYPE_2)')).toBeInTheDocument()
    expect(screen.getByText('ارتفاع ضغط الدم')).toBeInTheDocument()
    expect(screen.getByText('ميتفورمين 500')).toBeInTheDocument()
    expect(screen.getByText('علاج جذري للسن 36')).toBeInTheDocument()
    expect(screen.getByText('A_POSITIVE')).toBeInTheDocument()
  })

  it('shows honest NOT-RECORDED markers instead of inventing data', () => {
    render(<MedicalHistoryView patient={{ bloodGroup: null, medicalHistory: { hasAllergies: false } }} />)
    const views = screen.getAllByText('غير مسجل')
    expect(views.length).toBeGreaterThan(3) // chronic, meds, dental rows…
    expect(screen.getByText('لا توجد حساسيات مسجلة')).toBeInTheDocument()
  })

  it('says plainly when no history record exists at all', () => {
    render(<MedicalHistoryView patient={{ medicalHistory: null }} />)
    expect(screen.getByText(/لا يوجد تاريخ طبي مسجل/)).toBeInTheDocument()
  })
})

describe('PatientPrescriptions tab (Issue 5)', () => {
  it('lists prescriptions with Arabic statuses and a PDF download link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{
          id: 'rx-1', prescriptionNo: 'RX-0001', status: 'SIGNED', createdAt: '2026-09-01T10:00:00Z',
          doctor: { firstName: 'أحمد', lastName: 'محمود' }, diagnosis: 'خلاصة: التهاب لب السن',
          medications: [{ medicationName: 'أموكسيسيلين', dosage: '500mg', frequency: '3× يوميًا', duration: '5 أيام' }],
        }],
      }),
    }))
    render(<PatientPrescriptions patientId="pat-1" />)
    await waitFor(() => expect(screen.getByTestId('patient-prescriptions')).toBeInTheDocument())
    expect(screen.getByText('RX-0001')).toBeInTheDocument()
    expect(screen.getByText('موقعة')).toBeInTheDocument()
    expect(screen.getByText(/أحمد محمود/)).toBeInTheDocument()
    expect(screen.getByText(/أموكسيسيلين/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /تحميل PDF/ })
    expect(link).toHaveAttribute('href', '/api/documents/prescription/rx-1')
  })

  it('empty state is honest (no prescriptions yet)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) }))
    render(<PatientPrescriptions patientId="pat-2" />)
    await waitFor(() => expect(screen.getByText(/لا توجد وصفات طبية/)).toBeInTheDocument())
  })

  it('fetch failure shows an Arabic error, never a raw payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('500')))
    render(<PatientPrescriptions patientId="pat-3" />)
    await waitFor(() => expect(screen.getByText('تعذر تحميل الوصفات الطبية')).toBeInTheDocument())
  })
})
