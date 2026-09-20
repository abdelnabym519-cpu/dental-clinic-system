// @ts-nocheck
import { describe, it, expect } from 'vitest'
import * as templates from '@/lib/messaging/templates'
import { renderSimplePdf } from '@/lib/pdf'

// ---------------------------------------------------------------------------
// Message templates (3C–3J): exact Arabic wording pinned by tests.
// PDF writer: valid structure + escaped content.
// ---------------------------------------------------------------------------

const clinic = { name: 'عيادة دنتورا', address: 'القاهرة، مصر' }
const appointment = {
  patientName: 'أحمد محمد',
  doctorName: 'د. سمير علي',
  date: '2026-09-21',
  time: '10:00',
  type: 'CONSULTATION',
}

describe('Arabic message templates', () => {
  it('patient confirmation contains every required field (3C)', () => {
    const msg = templates.appointmentConfirmationPatient(clinic, appointment)
    expect(msg).toContain('مرحباً أحمد محمد 👋')
    expect(msg).toContain('تم تأكيد موعدك في عيادة دنتورا ✅')
    expect(msg).toContain('📅 التاريخ: 2026-09-21')
    expect(msg).toContain('⏰ الوقت: 10:00')
    expect(msg).toContain('👨‍⚕️ الطبيب: د. سمير علي')
    expect(msg).toContain('📍 العنوان: القاهرة، مصر')
  })

  it('doctor notification matches the 3C format (3J)', () => {
    const msg = templates.appointmentConfirmationDoctor(appointment)
    expect(msg).toContain('موعد جديد 📋')
    expect(msg).toContain('المريض: أحمد محمد')
    expect(msg).toContain('📅 2026-09-21 ⏰ 10:00')
    expect(msg).toContain('نوع الزيارة: CONSULTATION')
  })

  it('24h and 1h reminders match their formats (3D/3E)', () => {
    const r24 = templates.reminder24h(clinic, appointment)
    expect(r24).toContain('تذكير بموعدك 🔔')
    expect(r24).toContain('لديك موعد غداً في عيادة دنتورا')
    expect(r24).toContain('نتطلع لرؤيتك! 😊')

    const r1 = templates.reminder1h(clinic, appointment)
    expect(r1).toContain('تذكير أخير ⏰')
    expect(r1).toContain('موعدك بعد ساعة في عيادة دنتورا')
  })

  it('prescription, invoice and radiology templates carry clinic + context (3F/3G/3H)', () => {
    expect(templates.prescriptionSent(clinic, 'د. سمير علي', '2026-09-20')).toContain(
      'وصفتك الطبية من عيادة دنتورا 💊'
    )
    const inv = templates.invoiceSent(clinic, 'INV-1', '250.00', '2026-09-20')
    expect(inv).toContain('فاتورتك من عيادة دنتورا 🧾')
    expect(inv).toContain('رقم الفاتورة: INV-1')
    expect(inv).toContain('الإجمالي: 250.00 جنيه')
    expect(templates.radiologySent(clinic, 'د. سمير علي', '2026-09-20')).toContain(
      'نتيجة الأشعة من عيادة دنتورا 🦷'
    )
  })

  it('review request and doctor notices match their formats (3I/3J)', () => {
    const review = templates.reviewRequest(clinic, 'أحمد محمد')
    expect(review).toContain('شكراً لزيارتك عيادة دنتورا 🌟')
    expect(review).toContain('⭐⭐⭐⭐⭐')
    expect(templates.doctorCancellation('أحمد محمد', '2026-09-21')).toBe(
      'تم إلغاء موعد أحمد محمد بتاريخ 2026-09-21'
    )
    expect(templates.doctorReschedule('أحمد محمد', '2026-09-22', '11:00')).toBe(
      'تم تغيير موعد أحمد محمد إلى 2026-09-22 ⏰ 11:00'
    )
  })

  it('drops empty optional lines instead of printing "undefined"', () => {
    const msg = templates.appointmentConfirmationPatient({ name: 'العيادة' }, appointment)
    expect(msg).not.toContain('undefined')
    expect(msg).not.toContain('null')
  })
})

describe('minimal PDF writer (3F/3G attachments)', () => {
  const pdf = renderSimplePdf({
    title: 'Prescription RX-1',
    subtitle: 'Clinic — 2026-09-20',
    lines: [
      { text: 'Patient: Ahmed Mohamed', bold: true },
      { text: '- Amoxicillin 500mg, 3x/day, 7 days' },
    ],
    footer: 'Issued electronically.',
  })

  it('produces a valid PDF buffer structure', () => {
    const text = pdf.toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('startxref')
  })

  it('embeds the requested content', () => {
    const text = pdf.toString('latin1')
    expect(text).toContain('Prescription RX-1')
    expect(text).toContain('- Amoxicillin 500mg, 3x/day, 7 days')
  })

  it('escapes PDF string specials so content cannot break the stream', () => {
    const evil = renderSimplePdf({ title: 'a(b)\\c', lines: [] })
    const text = evil.toString('latin1')
    expect(text).toContain('a\\(b\\)\\\\c')
  })
})
