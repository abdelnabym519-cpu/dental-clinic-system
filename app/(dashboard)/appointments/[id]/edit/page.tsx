'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Calendar, Clock, User, Check, Loader2, Save } from 'lucide-react'
import { formatTime, formatDate } from '@/lib/appointment-utils'
import { CHIEF_COMPLAINT_EXAMPLES, COMPLAINT_HINT } from '@/lib/egypt-governorates'

interface Doctor {
  id: string
  employeeId: string
  firstName: string
  lastName: string
  specialization: string | null
}

interface TimeSlot {
  time: string
  available: boolean
}

interface Appointment {
  id: string
  appointmentNo: string
  scheduledDate: string
  scheduledTime: string
  duration: number
  chairNumber: number | null
  appointmentType: string
  status: string
  priority: string
  chiefComplaint: string | null
  notes: string | null
  patientId: string
  doctorId: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
  }
  doctor: {
    id: string
    firstName: string
    lastName: string
  }
}

export default function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useLanguage()
  const { id } = use(params)
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Form state
  const [selectedDoctor, setSelectedDoctor] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [duration, setDuration] = useState('30')
  const [appointmentType, setAppointmentType] = useState('CONSULTATION')
  const [priority, setPriority] = useState('NORMAL')
  const [chairNumber, setChairNumber] = useState('none')
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [notes, setNotes] = useState('')

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [appointmentRes, doctorsRes] = await Promise.all([
          fetch(`/api/appointments/${id}`),
          fetch('/api/staff/doctors'),
        ])

        if (appointmentRes.ok) {
          const data = await appointmentRes.json()
          setAppointment(data)
          // Set form values
          setSelectedDoctor(data.doctorId)
          setSelectedDate(new Date(data.scheduledDate).toISOString().split('T')[0])
          setSelectedTime(data.scheduledTime)
          setDuration(data.duration.toString())
          setAppointmentType(data.appointmentType)
          setPriority(data.priority)
          setChairNumber(data.chairNumber?.toString() || '')
          setChiefComplaint(data.chiefComplaint || '')
          setNotes(data.notes || '')
        }

        if (doctorsRes.ok) {
          const data = await doctorsRes.json()
          setDoctors(data.doctors)
        }
      } catch (err) {
        console.error('Error fetching data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [id])

  // Fetch available time slots when doctor and date change
  useEffect(() => {
    const fetchSlots = async () => {
      if (!selectedDoctor || !selectedDate) {
        setTimeSlots([])
        return
      }

      setLoadingSlots(true)
      try {
        const response = await fetch(
          `/api/appointments/slots?doctorId=${selectedDoctor}&date=${selectedDate}&duration=${duration}`
        )

        if (response.ok) {
          const data = await response.json()
          if (data.available) {
            // Mark current time as available if it matches original appointment
            const slots = data.slots.map((slot: TimeSlot) => ({
              ...slot,
              available:
                slot.available ||
                (appointment &&
                  appointment.doctorId === selectedDoctor &&
                  new Date(appointment.scheduledDate).toISOString().split('T')[0] ===
                    selectedDate &&
                  slot.time === appointment.scheduledTime),
            }))
            setTimeSlots(slots)
          } else {
            setTimeSlots([])
          }
        }
      } catch (err) {
        console.error('Error fetching slots:', err)
      } finally {
        setLoadingSlots(false)
      }
    }

    fetchSlots()
  }, [selectedDoctor, selectedDate, duration, appointment])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!selectedDoctor) {
      setError('Please select a doctor')
      return
    }

    if (!selectedDate) {
      setError('Please select a date')
      return
    }

    if (!selectedTime) {
      setError('Please select a time slot')
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch(`/api/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId: selectedDoctor,
          scheduledDate: selectedDate,
          scheduledTime: selectedTime,
          duration: parseInt(duration),
          appointmentType,
          priority,
          chairNumber: chairNumber && chairNumber !== 'none' ? parseInt(chairNumber) : null,
          chiefComplaint: chiefComplaint || null,
          notes: notes || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update appointment')
      }

      router.push(`/appointments/${id}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!appointment) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">{t('ui.appointment_not_found')}</p>
        <Link href="/appointments">
          <Button variant="outline" className="mt-4">{t('ui.back_to_appointments')}</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/appointments/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Edit Appointment')}</h1>
          <p className="text-muted-foreground">{appointment.appointmentNo}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Patient Info (Read-only) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />{t('ui.patient')}</CardTitle>
              <CardDescription>
                {t('Patient cannot be changed for an existing appointment')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border p-4 bg-muted/50">
                <p className="font-medium">
                  {appointment.patient.firstName} {appointment.patient.lastName}
                </p>
                <p className="text-sm text-muted-foreground">{appointment.patient.patientId}</p>
                <p className="text-sm text-muted-foreground">{appointment.patient.phone}</p>
              </div>
            </CardContent>
          </Card>

          {/* Doctor & Schedule */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />{t('ui.schedule')}</CardTitle>
              <CardDescription>{t('Update the doctor, date, or time')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("Doctor *")}</Label>
                <Select value={selectedDoctor} onValueChange={setSelectedDoctor}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('ui.select_a_doctor')} />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((doctor) => (
                      <SelectItem key={doctor.id} value={doctor.id}>
                        {t("Dr.")} {doctor.firstName} {doctor.lastName}
                        {doctor.specialization && ` (${doctor.specialization})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('Date *')}</Label>
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value)
                      setSelectedTime('')
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('ui.duration')}</Label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">{t("15 minutes")}</SelectItem>
                      <SelectItem value="30">{t("30 minutes")}</SelectItem>
                      <SelectItem value="45">{t("45 minutes")}</SelectItem>
                      <SelectItem value="60">{t("1 hour")}</SelectItem>
                      <SelectItem value="90">{t("1.5 hours")}</SelectItem>
                      <SelectItem value="120">{t("2 hours")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Time Slots */}
              <div className="space-y-2">
                <Label>{t("Time Slot *")}</Label>
                {loadingSlots ? (
                  <div className="flex items-center gap-2 p-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />{t('ui.loading_available_slots')}</div>
                ) : timeSlots.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">{t('ui.no_available_slots_for_this_date')}</p>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {timeSlots.map((slot) => (
                      <Button
                        key={slot.time}
                        type="button"
                        variant={selectedTime === slot.time ? 'default' : 'outline'}
                        size="sm"
                        disabled={!slot.available}
                        className={
                          !slot.available
                            ? 'cursor-not-allowed opacity-50'
                            : selectedTime === slot.time
                              ? ''
                              : 'hover:bg-primary/10'
                        }
                        onClick={() => setSelectedTime(slot.time)}
                      >
                        {selectedTime === slot.time && <Check className="mr-1 h-3 w-3" />}
                        {formatTime(slot.time)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Appointment Details */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />{t('ui.appointment_details')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>{t('ui.appointment_type')}</Label>
                  <Select value={appointmentType} onValueChange={setAppointmentType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CONSULTATION">{t('ui.consultation')}</SelectItem>
                      <SelectItem value="PROCEDURE">{t('ui.procedure')}</SelectItem>
                      <SelectItem value="FOLLOW_UP">{t('ui.follow_up')}</SelectItem>
                      <SelectItem value="EMERGENCY">{t('ui.emergency')}</SelectItem>
                      <SelectItem value="CHECK_UP">{t('ui.check_up')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t('ui.priority')}</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">{t('ui.low')}</SelectItem>
                      <SelectItem value="NORMAL">{t('ui.normal')}</SelectItem>
                      <SelectItem value="HIGH">{t('ui.high')}</SelectItem>
                      <SelectItem value="URGENT">{t('ui.urgent')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t('ui.chair_number')}</Label>
                  <Select value={chairNumber} onValueChange={setChairNumber}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('ui.select_chair')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('Not assigned')}</SelectItem>
                      <SelectItem value="1">{t("Chair 1")}</SelectItem>
                      <SelectItem value="2">{t("Chair 2")}</SelectItem>
                      <SelectItem value="3">{t("Chair 3")}</SelectItem>
                      <SelectItem value="4">{t("Chair 4")}</SelectItem>
                      <SelectItem value="5">{t("Chair 5")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-3">
                  <Label>{t('ui.chief_complaint')}</Label>
                  <Input
                    placeholder={t("Patient's main concern or reason for visit ") + COMPLAINT_HINT}
                    value={chiefComplaint}
                    onChange={(e) => setChiefComplaint(e.target.value)}
                    list="chief-complaint-examples"
                  />
                  <datalist id="chief-complaint-examples">
                    {CHIEF_COMPLAINT_EXAMPLES.map((example) => (
                      <option key={example} value={example} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-2 md:col-span-3">
                  <Label>{t('ui.notes')}</Label>
                  <Input
                    placeholder={t('ui.additional_notes_about_the_appointment')}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-4">
          <Link href={`/appointments/${id}`}>
            <Button type="button" variant="outline">{t('ui.cancel')}</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('ui.saving')}</>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />{t('ui.save_changes')}</>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
