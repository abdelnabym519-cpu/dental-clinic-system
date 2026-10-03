import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateAppointmentNo } from '@/lib/appointment-number'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { createRoom, deleteRoom } from '@/lib/services/video.service'
import {
  findConflictingAppointment,
  findConflictingRoomBooking,
  findAvailabilityViolation,
} from '@/lib/services/appointment-conflict.service'
import {
  generateRecurrenceDateKeys,
  RECURRENCE_PATTERNS,
  type RecurrencePattern,
} from '@/lib/agenda-availability'
import { isValidTime, parseDateKey, toDateKey } from '@/lib/agenda-utils'
import { queueAppointmentMessages } from '@/lib/messaging/service'

// Roles allowed to mutate the schedule. Reads stay available to every
// authenticated role; the server enforces this split on POST/PUT/DELETE.
const SCHEDULING_ROLES = ['ADMIN', 'DOCTOR', 'RECEPTIONIST']

// Appointment numbering lives in lib/appointment-number.ts (shared with the
// waitlist promote flow so sequences stay consistent across booking paths).

// GET - List appointments with filters
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole()

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const date = searchParams.get('date') || ''
    const doctorId = searchParams.get('doctorId') || ''
    const patientId = searchParams.get('patientId') || ''
    const type = searchParams.get('type') || ''
    const roomId = searchParams.get('roomId') || ''
    const view = searchParams.get('view') || 'list' // list, day, week, month

    const skip = (page - 1) * limit

    // Build where clause - always include hospitalId
    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { appointmentNo: { contains: search } },
        { patient: { firstName: { contains: search } } },
        { patient: { lastName: { contains: search } } },
        { patient: { phone: { contains: search } } },
      ]
    }

    if (status) {
      where.status = status
    }

    if (date) {
      const dateObj = new Date(date)
      where.scheduledDate = dateObj
    }

    if (doctorId) {
      where.doctorId = doctorId
    }

    if (patientId) {
      where.patientId = patientId
    }

    if (type) {
      where.appointmentType = type
    }

    if (roomId) {
      where.roomId = roomId
    }

    // For calendar views, get date range
    if (view === 'day' && date) {
      const dayStart = new Date(date)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(date)
      dayEnd.setHours(23, 59, 59, 999)
      where.scheduledDate = {
        gte: dayStart,
        lte: dayEnd,
      }
    } else if (view === 'week' && date) {
      const weekStart = new Date(date)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)
      weekEnd.setHours(23, 59, 59, 999)
      where.scheduledDate = {
        gte: weekStart,
        lte: weekEnd,
      }
    } else if (view === 'month' && date) {
      const monthStart = new Date(date)
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      const monthEnd = new Date(monthStart)
      monthEnd.setMonth(monthEnd.getMonth() + 1)
      monthEnd.setDate(0)
      monthEnd.setHours(23, 59, 59, 999)
      where.scheduledDate = {
        gte: monthStart,
        lte: monthEnd,
      }
    }

    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          doctor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
          room: {
            select: { id: true, name: true },
          },
        },
        orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }],
        skip: view === 'list' ? skip : undefined,
        take: view === 'list' ? limit : undefined,
      }),
      prisma.appointment.count({ where }),
    ])

    return NextResponse.json({
      appointments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching appointments:', error)
    return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 })
  }
}

// POST - Create new appointment
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(SCHEDULING_ROLES)

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      patientId,
      doctorId,
      scheduledDate,
      scheduledTime,
      duration = 30,
      chairNumber,
      roomId,
      appointmentType = 'CONSULTATION',
      priority = 'NORMAL',
      chiefComplaint,
      notes,
      contactPhone,
      isVirtual = false,
      recurrence,
    } = body

    // Validate required fields
    if (!patientId || !doctorId || !scheduledDate || !scheduledTime) {
      return NextResponse.json(
        { error: 'Patient, doctor, date, and time are required' },
        { status: 400 }
      )
    }

    // 3K — optional manual contact number override for messaging. Stored as
    // provided (trimmed); normalization/validation happens before sending.
    const contactPhoneOverride =
      typeof contactPhone === 'string' && contactPhone.trim()
        ? contactPhone.trim().slice(0, 30)
        : null

    // Validate time format (HH:MM)
    if (!isValidTime(scheduledTime)) {
      return NextResponse.json(
        { error: 'Invalid time format. Use HH:MM (24-hour format)' },
        { status: 400 }
      )
    }

    // Validate duration (between 5 and 480 minutes / 8 hours max)
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
      return NextResponse.json(
        { error: 'Duration must be between 5 and 480 minutes' },
        { status: 400 }
      )
    }

    // Validate a clinic-local YYYY-MM-DD key without UTC day shifting.
    if (typeof scheduledDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      return NextResponse.json({ error: 'Invalid scheduled date' }, { status: 400 })
    }
    let scheduledDateObj: Date
    try {
      scheduledDateObj = parseDateKey(scheduledDate)
    } catch {
      return NextResponse.json({ error: 'Invalid scheduled date' }, { status: 400 })
    }
    if (toDateKey(scheduledDateObj) !== scheduledDate) {
      return NextResponse.json({ error: 'Invalid scheduled date' }, { status: 400 })
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (scheduledDateObj < today) {
      return NextResponse.json(
        { error: 'Cannot schedule appointments in the past' },
        { status: 400 }
      )
    }

    // Check if patient exists and belongs to this hospital
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
    })
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Check if doctor exists and belongs to this hospital
    const doctor = await prisma.staff.findFirst({
      where: { id: doctorId, hospitalId },
    })
    if (!doctor) {
      return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
    }

    // Room must exist in this hospital (never trust client IDs for ownership)
    if (roomId) {
      const room = await prisma.room.findFirst({ where: { id: roomId, hospitalId } })
      if (!room) {
        return NextResponse.json({ error: 'Room not found' }, { status: 404 })
      }
    }

    // Availability gate: working hours, lunch break, approved leave, clinic
    // holiday. Authoritative server-side scheduling rule.
    const appointmentDate = scheduledDateObj
    const violation = await findAvailabilityViolation({
      hospitalId,
      doctorId,
      scheduledDate: appointmentDate,
      scheduledTime,
      duration,
    })
    if (violation) {
      return NextResponse.json({ error: violation.message, code: violation.code }, { status: 409 })
    }

    // Recurrence expansion: every occurrence is a real Appointment record and
    // runs the full conflict pipeline before anything is written.
    let recurrenceDates: string[] = [toDateKey(appointmentDate)]
    let recurrenceGroupId: string | null = null
    if (recurrence && typeof recurrence === 'object') {
      const pattern = recurrence.pattern as RecurrencePattern
      if (!RECURRENCE_PATTERNS.includes(pattern)) {
        return NextResponse.json(
          { error: 'Invalid recurrence pattern. Use DAILY, WEEKLY, BIWEEKLY or MONTHLY' },
          { status: 400 }
        )
      }
      const count = Number(recurrence.count) || 1
      const endKey = recurrence.endDate ? String(recurrence.endDate) : undefined
      if (endKey && !/^\d{4}-\d{2}-\d{2}$/.test(endKey)) {
        return NextResponse.json({ error: 'Invalid recurrence end date' }, { status: 400 })
      }
      recurrenceDates = generateRecurrenceDateKeys(
        toDateKey(appointmentDate),
        pattern,
        endKey ? Number.MAX_SAFE_INTEGER : count,
        endKey
      )
      if (recurrenceDates.length < 1) {
        return NextResponse.json(
          { error: 'Recurrence produced no occurrences after the end date' },
          { status: 400 }
        )
      }
      recurrenceGroupId =
        recurrenceDates.length > 1
          ? `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
          : null
    }

    // Re-check hours, leave, holidays, breaks, blocked slots, and conflicts
    // for every recurrence occurrence before writing any appointment.
    for (const dateKey of recurrenceDates) {
      const occurrenceDate = parseDateKey(dateKey)
      if (dateKey !== toDateKey(appointmentDate)) {
        const occurrenceViolation = await findAvailabilityViolation({
          hospitalId,
          doctorId,
          scheduledDate: occurrenceDate,
          scheduledTime,
          duration,
        })
        if (occurrenceViolation) {
          return NextResponse.json(
            { error: `${occurrenceViolation.message} (${dateKey})`, code: occurrenceViolation.code },
            { status: 409 }
          )
        }
      }

      const conflict = await findConflictingAppointment({
        hospitalId,
        doctorId,
        scheduledDate: occurrenceDate,
        scheduledTime,
        duration,
      })
      if (conflict) {
        return NextResponse.json(
          {
            error: `Doctor already has appointment ${conflict.appointmentNo} from ${conflict.scheduledTime} (${conflict.duration} min) overlapping ${dateKey}`,
          },
          { status: 409 }
        )
      }
      if (roomId) {
        const roomConflict = await findConflictingRoomBooking({
          hospitalId,
          doctorId,
          scheduledDate: occurrenceDate,
          scheduledTime,
          duration,
          roomId,
        })
        if (roomConflict) {
          return NextResponse.json(
            {
              error: `Room is already booked by appointment ${roomConflict.appointmentNo} at ${roomConflict.scheduledTime} on ${dateKey}`,
            },
            { status: 409 }
          )
        }
      }
    }

    // Create appointment(s) with a collision-safe appointment number:
    // generateAppointmentNo reads the current max, so two concurrent bookings
    // can derive the same number (the unique constraint then rejects one).
    // Retry with a freshly generated number instead of failing the booking.
    let appointment: any = null
    const createdAppointments: Array<{ id: string; scheduledDate: Date }> = []
    for (const dateKey of recurrenceDates) {
      const occurrenceDate = parseDateKey(dateKey)
      let created: any = null
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        const appointmentNo = await generateAppointmentNo(hospitalId)
        try {
          created = (await prisma.appointment.create({
            data: {
              appointmentNo,
              patientId,
              doctorId,
              hospitalId,
              scheduledDate: occurrenceDate,
              scheduledTime,
              duration,
              chairNumber,
              roomId: roomId || null,
              recurrenceGroupId,
              contactPhone: contactPhoneOverride,
              appointmentType,
              priority,
              chiefComplaint,
              notes,
              // Only mark virtual once a provider room and consultation row exist.
              isVirtual: false,
              status: 'SCHEDULED',
            },
            include: {
              patient: {
                select: {
                  id: true,
                  patientId: true,
                  firstName: true,
                  lastName: true,
                  phone: true,
                },
              },
              doctor: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          })) as { id: string }
          if (!appointment) appointment = created // first occurrence is the response body
        } catch (err) {
          if ((err as { code?: string })?.code === 'P2002') continue // number taken concurrently — retry
          throw err
        }
      }
      if (!created) {
        return NextResponse.json(
          { error: 'Could not allocate an appointment number, please retry' },
          { status: 503 }
        )
      }
      createdAppointments.push({ id: created.id, scheduledDate: occurrenceDate })
    }

    // Provision one real, stable room per virtual appointment occurrence.
    // If provider setup fails, keep the booking but do not label it virtual or
    // show a fabricated meeting URL; the response explicitly warns the user.
    let primaryVideoConsultation: any = null
    const videoSetupFailures: string[] = []
    if (isVirtual && appointment) {
      for (const bookedAppointment of createdAppointments) {
        let provisionedRoomName: string | null = null
        try {
          const room = await createRoom(bookedAppointment.id)
          provisionedRoomName = room.roomName

          const [hours, minutes] = scheduledTime.split(':').map(Number)
          const scheduledAt = new Date(bookedAppointment.scheduledDate)
          scheduledAt.setHours(hours, minutes, 0, 0)

          const consultation: any = await prisma.$transaction(async (tx: any) => {
            const createdConsultation = await tx.videoConsultation.create({
              data: {
                hospitalId,
                appointmentId: bookedAppointment.id,
                patientId,
                doctorId,
                roomUrl: room.roomUrl,
                roomName: room.roomName,
                scheduledAt,
              },
            })
            await tx.appointment.update({
              where: { id: bookedAppointment.id },
              data: { isVirtual: true, videoConsultationId: createdConsultation.id },
            })
            return createdConsultation
          })
          provisionedRoomName = null

          if (bookedAppointment.id === appointment.id) {
            primaryVideoConsultation = consultation
            appointment = {
              ...appointment,
              isVirtual: true,
              videoConsultationId: consultation.id,
              videoConsultation: consultation,
            }
          }
        } catch (videoErr) {
          console.error(`Failed to create video consultation for ${bookedAppointment.id}:`, videoErr)
          if (provisionedRoomName) {
            try {
              await deleteRoom(provisionedRoomName)
            } catch (cleanupErr) {
              console.error('Failed to clean up unlinked video room:', cleanupErr)
            }
          }
          videoSetupFailures.push(bookedAppointment.id)
        }
      }
    }
    const videoSetupWarning = videoSetupFailures.length
      ? primaryVideoConsultation
        ? 'تم إنشاء غرفة الفيديو للموعد الأساسي، لكن تعذر إنشاء غرفة لواحد أو أكثر من المواعيد المتكررة.'
        : 'تم حفظ الموعد دون رابط فيديو لأن مزود الخدمة لم ينشئ غرفة صالحة. لم يتم إنشاء أو عرض رابط تجريبي.'
      : null

    // Messaging platform (3C/3D/3E/3J): queue patient confirmation, doctor
    // notification and the 24h/1h reminder pair. Failure-isolated — booking
    // has already succeeded and must never depend on messaging.
    try {
      if (appointment?.id) {
        const [patientRow, doctorRow] = await Promise.all([
          prisma.patient.findUnique({
            where: { id: patientId },
            select: { id: true, firstName: true, lastName: true, phone: true },
          }),
          prisma.staff.findUnique({
            where: { id: doctorId },
            select: { id: true, firstName: true, lastName: true, phone: true },
          }),
        ])
        if (patientRow && doctorRow) {
          await queueAppointmentMessages({
            id: appointment.id,
            hospitalId,
            scheduledDate: parseDateKey(scheduledDate),
            scheduledTime,
            duration,
            appointmentType,
            contactPhone: contactPhoneOverride,
            patient: patientRow,
            doctor: doctorRow,
          })
        }
      }
    } catch (msgErr) {
      console.error('Failed to queue appointment messages (non-fatal):', msgErr)
    }

    return NextResponse.json(
      { ...appointment, ...(videoSetupWarning ? { videoSetupWarning } : {}) },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error creating appointment:', error)
    return NextResponse.json({ error: 'Failed to create appointment' }, { status: 500 })
  }
}
