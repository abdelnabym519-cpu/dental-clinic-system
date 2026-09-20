import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { handleCancellationWaitlist } from '@/lib/services/smart-scheduler'
import {
  findConflictingAppointment,
  findConflictingRoomBooking,
  findAvailabilityViolation,
} from '@/lib/services/appointment-conflict.service'
import { isValidTime, toDateKey, parseDateKey } from '@/lib/agenda-utils'
import { queueDoctorCancellation, queueDoctorReschedule, queueReviewRequest, type QueueableAppointment } from '@/lib/messaging/service'

// Roles allowed to mutate the schedule (edit / reschedule / cancel / status).
const SCHEDULING_ROLES = ['ADMIN', 'DOCTOR', 'RECEPTIONIST']

// GET - Get single appointment
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requireAuthAndRole()

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const appointment = await prisma.appointment.findFirst({
      where: { id, hospitalId },
      include: {
        patient: {
          include: {
            medicalHistory: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
            phone: true,
          },
        },
        treatments: {
          include: {
            procedure: true,
          },
        },
        reminders: true,
        room: {
          select: { id: true, name: true },
        },
      },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    return NextResponse.json(appointment)
  } catch (error) {
    console.error('Error fetching appointment:', error)
    return NextResponse.json({ error: 'Failed to fetch appointment' }, { status: 500 })
  }
}

// PUT - Update appointment
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requireAuthAndRole(SCHEDULING_ROLES)

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const {
      scheduledDate,
      scheduledTime,
      duration,
      chairNumber,
      roomId,
      appointmentType,
      status,
      priority,
      chiefComplaint,
      notes,
      doctorId,
      /** For recurrence series: 'this' (default) | 'future' | 'all'. */
      applyTo,
    } = body

    // Check if appointment exists and belongs to this hospital
    const existingAppointment = await prisma.appointment.findFirst({
      where: { id, hospitalId },
    })

    if (!existingAppointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Validate provided fields before touching the database (parity with POST).
    if (scheduledTime !== undefined && !isValidTime(scheduledTime)) {
      return NextResponse.json(
        { error: 'Invalid time format. Use HH:MM (24-hour format)' },
        { status: 400 }
      )
    }
    if (duration !== undefined && (duration < 5 || duration > 480)) {
      return NextResponse.json(
        { error: 'Duration must be between 5 and 480 minutes' },
        { status: 400 }
      )
    }
    const VALID_STATUSES = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED']
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid appointment status' }, { status: 400 })
    }
    const VALID_TYPES = ['CONSULTATION', 'PROCEDURE', 'FOLLOW_UP', 'EMERGENCY', 'CHECK_UP']
    if (appointmentType !== undefined && !VALID_TYPES.includes(appointmentType)) {
      return NextResponse.json({ error: 'Invalid appointment type' }, { status: 400 })
    }
    const VALID_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
    if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
    }
    if (scheduledDate !== undefined && Number.isNaN(new Date(scheduledDate).getTime())) {
      return NextResponse.json({ error: 'Invalid scheduled date' }, { status: 400 })
    }

    // Never trust client-supplied IDs: verify ownership within this hospital.
    if (doctorId !== undefined) {
      const doctor = await prisma.staff.findFirst({
        where: { id: doctorId, hospitalId },
      })
      if (!doctor) {
        return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
      }
    }
    if (roomId !== undefined && roomId !== null) {
      const room = await prisma.room.findFirst({ where: { id: roomId, hospitalId } })
      if (!room) {
        return NextResponse.json({ error: 'Room not found' }, { status: 404 })
      }
    }

    // Build update data
    const updateData: any = {}

    if (scheduledDate !== undefined) {
      updateData.scheduledDate = new Date(scheduledDate)
    }
    if (scheduledTime !== undefined) updateData.scheduledTime = scheduledTime
    if (duration !== undefined) updateData.duration = duration
    if (chairNumber !== undefined) updateData.chairNumber = chairNumber
    if (typeof body.contactPhone === 'string') {
      updateData.contactPhone = body.contactPhone.trim().slice(0, 30) || null
    }
    if (roomId !== undefined) updateData.roomId = roomId
    if (appointmentType !== undefined) updateData.appointmentType = appointmentType
    if (status !== undefined) updateData.status = status
    if (priority !== undefined) updateData.priority = priority
    if (chiefComplaint !== undefined) updateData.chiefComplaint = chiefComplaint
    if (notes !== undefined) updateData.notes = notes
    if (doctorId !== undefined) updateData.doctorId = doctorId

    // If rescheduling, check for conflicts
    if (
      (scheduledDate || scheduledTime || doctorId) &&
      status !== 'CANCELLED' &&
      status !== 'NO_SHOW'
    ) {
      const checkDate = scheduledDate ? new Date(scheduledDate) : existingAppointment.scheduledDate
      const checkTime = scheduledTime || existingAppointment.scheduledTime
      const checkDoctorId = doctorId || existingAppointment.doctorId

      const checkDuration = duration ?? existingAppointment.duration
      const violating = await findAvailabilityViolation({
        hospitalId,
        doctorId: checkDoctorId,
        scheduledDate: checkDate,
        scheduledTime: checkTime,
        duration: checkDuration,
      })
      if (violating) {
        return NextResponse.json({ error: violating.message, code: violating.code }, { status: 409 })
      }

      const conflictingAppointment = await findConflictingAppointment({
        hospitalId,
        doctorId: checkDoctorId,
        scheduledDate: checkDate,
        scheduledTime: checkTime,
        duration: checkDuration,
        excludeId: id,
      })

      if (conflictingAppointment) {
        return NextResponse.json(
          {
            error: `Doctor already has appointment ${conflictingAppointment.appointmentNo} from ${conflictingAppointment.scheduledTime} (${conflictingAppointment.duration} min) overlapping this time`,
          },
          { status: 409 }
        )
      }

      const existingRoomId = (existingAppointment as { roomId?: string | null }).roomId ?? null
      const effectiveRoomId = roomId !== undefined ? roomId : existingRoomId
      if (effectiveRoomId) {
        const roomConflict = await findConflictingRoomBooking({
          hospitalId,
          doctorId: checkDoctorId,
          scheduledDate: checkDate,
          scheduledTime: checkTime,
          duration: checkDuration,
          roomId: effectiveRoomId,
          excludeId: id,
        })
        if (roomConflict) {
          return NextResponse.json(
            {
              error: `Room is already booked by appointment ${roomConflict.appointmentNo} at ${roomConflict.scheduledTime}`,
            },
            { status: 409 }
          )
        }
      }
    }

    // Handle cancellation
    if (status === 'CANCELLED') {
      updateData.cancelledAt = new Date()
      if (body.cancellationReason) {
        updateData.cancellationReason = body.cancellationReason
      }
    }

    // ── Recurrence series updates ──────────────────────────────────────────
    // 'this' (default): only this record. 'future': this + later occurrences.
    // 'all': every occurrence in the group. Time/doctor/status changes are
    // applied to each affected occurrence at its own date, with the conflict
    // pipeline re-run per record; series edits fail atomically.
    const groupId = (existingAppointment as { recurrenceGroupId?: string | null }).recurrenceGroupId
    if (applyTo && applyTo !== 'this' && groupId) {
      const group = await prisma.appointment.findMany({
        where: { hospitalId, recurrenceGroupId: groupId },
        orderBy: { scheduledDate: 'asc' },
      })
      const thisKey = toDateKey(existingAppointment.scheduledDate)
      const targets = (group as Array<Record<string, unknown>>).filter((g) => {
        if (g.id === id) return true
        if (applyTo === 'all') return true
        return toDateKey(g.scheduledDate as Date) >= thisKey
      })

      const baseDate =
        scheduledDate !== undefined ? new Date(scheduledDate) : existingAppointment.scheduledDate
      const newKey = toDateKey(baseDate)
      const oldKey = thisKey
      for (const target of targets) {
        const targetKey = toDateKey(target.scheduledDate as Date)
        // Date moves: shift every sibling by the same delta unless 'all' with
        // no explicit date change; otherwise keep each occurrence's own date.
        let memberDate = target.scheduledDate as Date
        if (scheduledDate !== undefined) {
          memberDate = new Date(target.scheduledDate as Date)
          memberDate.setDate(memberDate.getDate() + (parseDateKey(newKey).getTime() - parseDateKey(oldKey).getTime()) / 86400000)
        }

        const memberTime = scheduledTime ?? (target.scheduledTime as string)
        const memberDuration = duration ?? (target.duration as number)
        const memberDoctorId = doctorId ?? (target.doctorId as string)

        if (status !== 'CANCELLED' && status !== 'NO_SHOW') {
          const violating = await findAvailabilityViolation({
            hospitalId,
            doctorId: memberDoctorId,
            scheduledDate: memberDate,
            scheduledTime: memberTime,
            duration: memberDuration,
          })
          if (violating) {
            return NextResponse.json(
              { error: `${toDateKey(memberDate)}: ${violating.message}`, code: violating.code },
              { status: 409 }
            )
          }
          const conflict = await findConflictingAppointment({
            hospitalId,
            doctorId: memberDoctorId,
            scheduledDate: memberDate,
            scheduledTime: memberTime,
            duration: memberDuration,
            excludeId: target.id as string,
          })
          if (conflict) {
            return NextResponse.json(
              {
                error: `${toDateKey(memberDate)}: doctor already has appointment ${conflict.appointmentNo} at ${conflict.scheduledTime}`,
              },
              { status: 409 }
            )
          }
        }

        const memberData: Record<string, unknown> = {
          ...updateData,
          scheduledDate: memberDate,
        }
        if (status === 'CANCELLED' && (target.status as string) !== 'CANCELLED') {
          memberData.cancelledAt = new Date()
          if (body.cancellationReason) memberData.cancellationReason = body.cancellationReason
        }
        await prisma.appointment.update({ where: { id: target.id as string }, data: memberData })
      }

      const last = await prisma.appointment.findFirst({ where: { id } })
      return NextResponse.json(last)
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: updateData,
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
    })

    // Messaging platform (3G/3I/3J): doctor cancellation / reschedule notices
    // and the post-visit review request. Failure-isolated; booking flows never
    // depend on messaging.
    try {
      const previous = existingAppointment as typeof appointment & { status: string }
      // The include above carries doctor names but not the phone — fetch it
      // so doctor notices (3J) can actually be delivered.
      const doctorRow = await prisma.staff.findUnique({
        where: { id: existingAppointment.doctorId },
        select: { id: true, firstName: true, lastName: true, phone: true },
      })
      const messagingBase = {
        id: appointment.id,
        hospitalId,
        scheduledDate: (appointment.scheduledDate ?? existingAppointment.scheduledDate) as Date,
        scheduledTime: (appointment.scheduledTime ?? existingAppointment.scheduledTime) as string,
        duration: (appointment.duration ?? existingAppointment.duration) as number,
        appointmentType: existingAppointment.appointmentType,
        status: (appointment.status ?? previous.status) as string,
        contactPhone: (appointment.contactPhone ?? (existingAppointment as { contactPhone?: string | null }).contactPhone) as string | null,
        patient: appointment.patient ?? { id: existingAppointment.patientId, firstName: '', lastName: '', phone: null },
        doctor:
          doctorRow ?? {
            id: existingAppointment.doctorId,
            firstName: '',
            lastName: '',
            phone: null,
          },
      } as QueueableAppointment
      if (status === 'CANCELLED' && previous.status !== 'CANCELLED') {
        await queueDoctorCancellation(messagingBase)
      } else if (
        status === 'COMPLETED' &&
        previous.status !== 'COMPLETED'
      ) {
        await queueReviewRequest(messagingBase)
      } else if (
        (scheduledDate !== undefined || scheduledTime !== undefined) &&
        (toDateKey(new Date(scheduledDate ?? existingAppointment.scheduledDate)) !==
          toDateKey(existingAppointment.scheduledDate) ||
          (scheduledTime ?? existingAppointment.scheduledTime) !== existingAppointment.scheduledTime)
      ) {
        await queueDoctorReschedule(messagingBase)
      }
    } catch (msgErr) {
      console.error('Failed to queue appointment change messages (non-fatal):', msgErr)
    }

    // Smart Scheduler: When appointment is cancelled, notify matching waitlist patients
    if (status === 'CANCELLED' && existingAppointment.status !== 'CANCELLED') {
      try {
        const waitlistResult = await handleCancellationWaitlist({
          hospitalId,
          doctorId: existingAppointment.doctorId,
          scheduledDate: existingAppointment.scheduledDate,
          scheduledTime: existingAppointment.scheduledTime,
          duration: existingAppointment.duration,
        })

        if (waitlistResult.matchedPatients.length > 0) {
          // Return the waitlist notification info alongside the appointment
          return NextResponse.json({
            ...appointment,
            _waitlistNotifications: {
              patientsNotified: waitlistResult.matchedPatients.length,
              patients: waitlistResult.matchedPatients.map((p) => ({
                name: p.patientName,
                phone: p.patientPhone,
              })),
              slotDetails: waitlistResult.slotDetails,
            },
          })
        }
      } catch (err) {
        // Don't fail the cancellation if waitlist notification fails
        console.error('Smart scheduler error:', err)
      }
    }

    return NextResponse.json(appointment)
  } catch (error) {
    console.error('Error updating appointment:', error)
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 })
  }
}

// DELETE - Delete appointment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requireAuthAndRole(SCHEDULING_ROLES)

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Check if appointment exists and belongs to this hospital
    const appointment = await prisma.appointment.findFirst({
      where: { id, hospitalId },
      include: { treatments: true },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Don't allow deletion if treatments are linked
    if (appointment.treatments.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete appointment with linked treatments. Cancel it instead.' },
        { status: 400 }
      )
    }

    // Delete appointment (reminders will cascade)
    await prisma.appointment.delete({
      where: { id },
    })

    return NextResponse.json({ message: 'Appointment deleted successfully' })
  } catch (error) {
    console.error('Error deleting appointment:', error)
    return NextResponse.json({ error: 'Failed to delete appointment' }, { status: 500 })
  }
}
