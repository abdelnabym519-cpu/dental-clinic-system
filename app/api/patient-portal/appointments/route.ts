import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePatientAuth } from '@/lib/patient-auth'
import { enqueueMessage } from '@/lib/messaging/service'
import {
  appointmentConfirmationPatient,
  appointmentConfirmationDoctor,
} from '@/lib/messaging/templates'

/**
 * GET: List patient's appointments (past + upcoming).
 */
export async function GET(req: NextRequest) {
  const { error, patient } = await requirePatientAuth(req)
  if (error) return error

  try {
    const { searchParams } = new URL(req.url)
    const filter = searchParams.get('filter') || 'upcoming' // upcoming | past | all
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const where: Record<string, unknown> = {
      patientId: patient!.id,
      hospitalId: patient!.hospitalId,
    }

    if (filter === 'upcoming') {
      where.scheduledDate = { gte: today }
      where.status = { in: ['SCHEDULED', 'CONFIRMED'] }
    } else if (filter === 'past') {
      where.OR = [
        { scheduledDate: { lt: today } },
        { status: { in: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] } },
      ]
    }

    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where: where as any,
        include: {
          doctor: {
            select: {
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
        },
        orderBy: { scheduledDate: filter === 'upcoming' ? 'asc' : 'desc' },
        skip,
        take: limit,
      }),
      prisma.appointment.count({ where: where as any }),
    ])

    return NextResponse.json({
      appointments,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err: unknown) {
    console.error('Patient appointments error:', err)
    return NextResponse.json({ error: 'Failed to load appointments' }, { status: 500 })
  }
}

/**
 * POST: Patient requests a new appointment.
 * Body: { doctorId, date, time, type, chiefComplaint }
 *
 * Phase 13 hardening — every rule is checked server-side (D7):
 *   1. doctor must belong to the patient's hospital
 *   2. date must be in the future (today only if the time is ahead)
 *   3. time must be inside the doctor's working hours / shift (Phase 5
 *      data: StaffShift + Hospital.workingHours, same source as the slots
 *      API) and outside lunch
 *   4. the doctor must not already have an overlapping appointment
 *   5. the patient must not already have an appointment with the same
 *      doctor within one hour of the selected time
 * On success the confirmation is queued on the existing WhatsApp
 * MessageQueue for both the patient and the doctor.
 */
export async function POST(req: NextRequest) {
  const { error, patient } = await requirePatientAuth(req)
  if (error) return error

  try {
    const body = await req.json()
    const { doctorId, date, time, type, chiefComplaint } = body as {
      doctorId: string
      date: string
      time: string
      type?: string
      chiefComplaint?: string
    }

    if (!doctorId || !date || !time) {
      return NextResponse.json({ error: 'Doctor, date, and time are required' }, { status: 400 })
    }

    const dateObj = new Date(date)
    if (isNaN(dateObj.getTime()) || !/^\d{2}:\d{2}$/.test(time)) {
      return NextResponse.json({ error: 'Invalid date or time' }, { status: 400 })
    }

    const [th, tm] = time.split(':').map(Number)
    const duration = 30
    const startMinutes = th * 60 + tm
    const endMinutes = startMinutes + duration

    // 1. Verify doctor belongs to hospital
    const doctor = await prisma.staff.findFirst({
      where: { id: doctorId, hospitalId: patient!.hospitalId, isActive: true },
      select: { id: true, firstName: true, lastName: true, phone: true, specialization: true },
    })

    if (!doctor) {
      return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    }

    const hospital = await prisma.hospital.findUnique({
      where: { id: patient!.hospitalId },
      select: { name: true, address: true, phone: true, workingHours: true },
    })

    // 2. Future date (today only if the slot is still ahead of now)
    const now = new Date()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const isToday = dateObj.toDateString() === today.toDateString()
    if (dateObj < today || (isToday && endMinutes <= now.getHours() * 60 + now.getMinutes())) {
      return NextResponse.json({ error: 'The appointment must be in the future' }, { status: 400 })
    }

    // 3. Working hours / shift (same source as the slots API)
    let workingHours = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '14:00' }
    if (hospital?.workingHours) {
      try {
        workingHours = JSON.parse(hospital.workingHours)
      } catch {
        /* defaults */
      }
    }
    const doctorShift = await prisma.staffShift.findUnique({
      where: {
        staffId_dayOfWeek: { staffId: doctorId, dayOfWeek: dateObj.getDay() },
      },
    })

    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number)
      return h * 60 + m
    }
    const whStart = toMin(doctorShift?.startTime || workingHours.start)
    const whEnd = toMin(doctorShift?.endTime || workingHours.end)
    const lunchStart = toMin(workingHours.lunchStart)
    const lunchEnd = toMin(workingHours.lunchEnd)

    if (startMinutes < whStart || endMinutes > whEnd) {
      return NextResponse.json(
        { error: "This time is outside the doctor's working hours" },
        { status: 409 }
      )
    }
    if (startMinutes < lunchEnd && endMinutes > lunchStart) {
      return NextResponse.json(
        { error: "This time is outside the doctor's working hours" },
        { status: 409 }
      )
    }

    // 4. Double-booking: doctor already has an overlapping appointment
    type DoctorApt = { scheduledTime: string; duration: number; patientId: string }
const doctorAppointments = await prisma.appointment.findMany({
      where: {
        hospitalId: patient!.hospitalId,
        doctorId,
        scheduledDate: dateObj,
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
      },
      select: { scheduledTime: true, duration: true, patientId: true },
    })
    const overlaps = doctorAppointments.some((apt: DoctorApt) => {
      const [ah, am] = apt.scheduledTime.split(':').map(Number)
      const aptStart = ah * 60 + am
      const aptEnd = aptStart + apt.duration
      return startMinutes < aptEnd && endMinutes > aptStart
    })
    if (overlaps) {
      return NextResponse.json(
        { error: 'The doctor already has an appointment at this time' },
        { status: 409 }
      )
    }

    // 5. One-hour rule: patient already booked with this doctor nearby
    const withinHour = doctorAppointments.some((apt: DoctorApt) => {
      if (apt.patientId !== patient!.id) return false
      const [ah, am] = apt.scheduledTime.split(':').map(Number)
      const aptStart = ah * 60 + am
      return Math.abs(aptStart - startMinutes) < 60
    })
    if (withinHour) {
      return NextResponse.json(
        { error: 'You already have an appointment within the next hour' },
        { status: 409 }
      )
    }

    // Generate appointment number (legacy APTNNNNN sequence)
    const lastAppt = await prisma.appointment.findFirst({
      where: { hospitalId: patient!.hospitalId },
      orderBy: { createdAt: 'desc' },
      select: { appointmentNo: true },
    })
    const lastNum = lastAppt ? parseInt(lastAppt.appointmentNo.replace(/\D/g, '')) || 0 : 0
    const appointmentNo = `APT${String(lastNum + 1).padStart(5, '0')}`

    const appointment = await prisma.appointment.create({
      data: {
        hospitalId: patient!.hospitalId,
        appointmentNo,
        patientId: patient!.id,
        doctorId,
        scheduledDate: dateObj,
        scheduledTime: time,
        duration,
        appointmentType: (type as any) || 'CONSULTATION',
        status: 'SCHEDULED',
        chiefComplaint: chiefComplaint || null,
      },
      include: {
        doctor: {
          select: { firstName: true, lastName: true, specialization: true },
        },
      },
    })

    // WhatsApp confirmations (Phase 10 MessageQueue)
    const dateLabel = dateObj.toISOString().slice(0, 10)
    const patientName = `${patient!.firstName} ${patient!.lastName}`.trim()

    await enqueueMessage({
      hospitalId: patient!.hospitalId,
      appointmentId: appointment.id,
      patientId: patient!.id,
      recipient: patient!.phone,
      channel: 'WHATSAPP',
      messageType: 'APPOINTMENT_CONFIRMATION',
      payload: {
        text: appointmentConfirmationPatient(
          { name: hospital?.name ?? '', address: hospital?.address ?? null },
          {
            patientName,
            doctorName: `${doctor.firstName} ${doctor.lastName}`,
            date: dateLabel,
            time,
            type: type || 'CONSULTATION',
          }
        ),
      },
    })

    if (doctor.phone) {
      await enqueueMessage({
        hospitalId: patient!.hospitalId,
        appointmentId: appointment.id,
        recipient: doctor.phone,
        channel: 'WHATSAPP',
        messageType: 'DOCTOR_NEW_APPOINTMENT',
        payload: {
          text: appointmentConfirmationDoctor({
            patientName,
            date: dateLabel,
            time,
            type: type || 'CONSULTATION',
          }),
        },
      })
    }

    return NextResponse.json({ success: true, appointment }, { status: 201 })
  } catch (err: unknown) {
    console.error('Patient book appointment error:', err)
    return NextResponse.json({ error: 'Failed to book appointment' }, { status: 500 })
  }
}
