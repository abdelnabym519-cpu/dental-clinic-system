import { prisma } from '@/lib/prisma'

/**
 * Generate a unique, human-readable appointment number for the hospital.
 * Format: APT<YYYYMMDD><0001-sequential>. Shared by the booking API and the
 * waitlist promote flow so numbering stays consistent.
 */
export async function generateAppointmentNo(hospitalId: string): Promise<string> {
  const today = new Date()
  const prefix = `APT${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
    today.getDate()
  ).padStart(2, '0')}`

  const lastAppointment = await prisma.appointment.findFirst({
    where: {
      hospitalId,
      appointmentNo: {
        startsWith: prefix,
      },
    },
    orderBy: {
      appointmentNo: 'desc',
    },
  })

  if (lastAppointment) {
    const lastNumber = parseInt(lastAppointment.appointmentNo.slice(-4))
    return `${prefix}${String(lastNumber + 1).padStart(4, '0')}`
  }

  return `${prefix}0001`
}
