import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { handleCancellationWaitlist } from '@/lib/services/smart-scheduler'
import { findConflictingAppointment } from '@/lib/services/appointment-conflict.service'
import { isValidTime } from '@/lib/agenda-utils'

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
      appointmentType,
      status,
      priority,
      chiefComplaint,
      notes,
      doctorId,
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

    // Never trust a client-supplied doctorId: verify it belongs to this hospital.
    if (doctorId !== undefined) {
      const doctor = await prisma.staff.findFirst({
        where: { id: doctorId, hospitalId },
      })
      if (!doctor) {
        return NextResponse.json({ error: 'Doctor not found' }, { status: 404 })
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
    }

    // Handle cancellation
    if (status === 'CANCELLED') {
      updateData.cancelledAt = new Date()
      if (body.cancellationReason) {
        updateData.cancellationReason = body.cancellationReason
      }
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
