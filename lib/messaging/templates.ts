/**
 * Arabic message templates (master prompt 3C–3J). Pure string builders so the
 * exact wording is pinned by unit tests. Dates/times arrive pre-formatted.
 */

export interface TemplateClinic {
  name: string
  address?: string | null
  phone?: string | null
}

export interface TemplateAppointment {
  patientName: string
  doctorName: string
  date: string
  time: string
  type?: string | null
}

const joinNonEmpty = (parts: Array<string | null | undefined>) =>
  parts.filter((p) => p && String(p).trim()).join('\n')

export function appointmentConfirmationPatient(
  clinic: TemplateClinic,
  appointment: TemplateAppointment
): string {
  return joinNonEmpty([
    `مرحباً ${appointment.patientName} 👋`,
    `تم تأكيد موعدك في ${clinic.name} ✅`,
    `📅 التاريخ: ${appointment.date}`,
    `⏰ الوقت: ${appointment.time}`,
    `👨‍⚕️ الطبيب: ${appointment.doctorName}`,
    clinic.address ? `📍 العنوان: ${clinic.address}` : null,
    'في حالة الرغبة في إلغاء أو تغيير الموعد، يرجى التواصل معنا.',
  ])
}

export function appointmentConfirmationDoctor(
  appointment: Pick<TemplateAppointment, 'patientName' | 'date' | 'time' | 'type'>
): string {
  return joinNonEmpty([
    'موعد جديد 📋',
    `المريض: ${appointment.patientName}`,
    `📅 ${appointment.date} ⏰ ${appointment.time}`,
    `نوع الزيارة: ${appointment.type ?? '-'}`,
  ])
}

export function reminder24h(clinic: TemplateClinic, appointment: TemplateAppointment): string {
  return joinNonEmpty([
    'تذكير بموعدك 🔔',
    `لديك موعد غداً في ${clinic.name}`,
    `📅 ${appointment.date} ⏰ ${appointment.time}`,
    `👨‍⚕️ الطبيب: ${appointment.doctorName}`,
    'نتطلع لرؤيتك! 😊',
  ])
}

export function reminder1h(clinic: TemplateClinic, appointment: TemplateAppointment): string {
  return joinNonEmpty([
    'تذكير أخير ⏰',
    `موعدك بعد ساعة في ${clinic.name}`,
    `📅 ${appointment.date} ⏰ ${appointment.time}`,
    `👨‍⚕️ الطبيب: ${appointment.doctorName}`,
  ])
}

export function prescriptionSent(
  clinic: TemplateClinic,
  doctorName: string,
  date: string
): string {
  return joinNonEmpty([
    `وصفتك الطبية من ${clinic.name} 💊`,
    `الطبيب: ${doctorName}`,
    `التاريخ: ${date}`,
    '[مرفق: الوصفة الطبية PDF]',
  ])
}

export function invoiceSent(
  clinic: TemplateClinic,
  invoiceNo: string,
  total: string,
  date: string
): string {
  return joinNonEmpty([
    `فاتورتك من ${clinic.name} 🧾`,
    `رقم الفاتورة: ${invoiceNo}`,
    `الإجمالي: ${total} جنيه`,
    `التاريخ: ${date}`,
    '[مرفق: الفاتورة PDF]',
  ])
}

export function radiologySent(
  clinic: TemplateClinic,
  doctorName: string,
  date: string
): string {
  return joinNonEmpty([
    `نتيجة الأشعة من ${clinic.name} 🦷`,
    `الطبيب: ${doctorName}`,
    `التاريخ: ${date}`,
    '[الصورة/الصور مرفقة]',
  ])
}

export function reviewRequest(clinic: TemplateClinic, patientName: string): string {
  return joinNonEmpty([
    `شكراً لزيارتك ${clinic.name} 🌟`,
    'نأمل أن تكون راضياً عن خدمتنا.',
    'هل يمكنك تقييم تجربتك؟',
    '⭐⭐⭐⭐⭐',
    'رأيك يهمنا كثيراً!',
  ])
}

export function doctorCancellation(patientName: string, date: string): string {
  return `تم إلغاء موعد ${patientName} بتاريخ ${date}`
}

export function doctorReschedule(patientName: string, newDate: string, newTime: string): string {
  return `تم تغيير موعد ${patientName} إلى ${newDate} ⏰ ${newTime}`
}
