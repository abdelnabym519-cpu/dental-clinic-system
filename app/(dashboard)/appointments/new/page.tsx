'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ArrowLeft, Calendar, Clock, User, Search, Check, Loader2, Video } from 'lucide-react'
import { formatTime } from '@/lib/appointment-utils'
import { CHIEF_COMPLAINT_EXAMPLES, COMPLAINT_HINT } from '@/lib/egypt-governorates'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  email: string | null
}

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

export default function NewAppointmentPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedPatientId = searchParams.get('patientId')

  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Data
  const [patients, setPatients] = useState<Patient[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Form state
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [selectedDoctor, setSelectedDoctor] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [duration, setDuration] = useState('30')
  const [appointmentType, setAppointmentType] = useState('CONSULTATION')
  const [priority, setPriority] = useState('NORMAL')
  const [chairNumber, setChairNumber] = useState('')
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [notes, setNotes] = useState('')
  const [isVirtual, setIsVirtual] = useState(false)

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [patientsRes, doctorsRes] = await Promise.all([
          fetch('/api/patients?all=true'),
          fetch('/api/staff/doctors'),
        ])

        if (patientsRes.ok) {
          const data = await patientsRes.json()
          setPatients(data.patients)

          // If preselected patient
          if (preselectedPatientId) {
            const patient = data.patients.find((p: Patient) => p.id === preselectedPatientId)
            if (patient) {
              setSelectedPatient(patient)
            }
          }
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
  }, [preselectedPatientId])

  // Fetch available time slots when doctor and date are selected
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
            setTimeSlots(data.slots)
          } else {
            setTimeSlots([])
            setError(data.reason || t('No slots available'))
          }
        }
      } catch (err) {
        console.error('Error fetching slots:', err)
      } finally {
        setLoadingSlots(false)
      }
    }

    fetchSlots()
  }, [selectedDoctor, selectedDate, duration])

  // Filter patients based on search
  const filteredPatients = patients.filter(
    (p) =>
      p.firstName.toLowerCase().includes(patientSearch.toLowerCase()) ||
      p.lastName.toLowerCase().includes(patientSearch.toLowerCase()) ||
      p.phone.includes(patientSearch) ||
      p.patientId.toLowerCase().includes(patientSearch.toLowerCase())
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!selectedPatient) {
      setError('Please select a patient')
      return
    }

    if (!selectedDoctor) {
      setError(t('Please select a doctor'))
      return
    }

    if (!selectedDate) {
      setError(t('Please select a date'))
      return
    }

    if (!selectedTime) {
      setError(t('Please select a time slot'))
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          doctorId: selectedDoctor,
          scheduledDate: selectedDate,
          scheduledTime: selectedTime,
          duration: parseInt(duration),
          appointmentType,
          priority,
          chairNumber: chairNumber ? parseInt(chairNumber) : null,
          chiefComplaint: chiefComplaint || null,
          notes: notes || null,
          isVirtual,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create appointment')
      }

      router.push('/appointments')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const getMinDate = () => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/appointments">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('ui.new_appointment')}</h1>
          <p className="text-muted-foreground">{t('Schedule a new appointment for a patient')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Patient Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />{t('ui.patient')}</CardTitle>
              <CardDescription>{t('Select the patient for this appointment')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedPatient ? (
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        {selectedPatient.firstName} {selectedPatient.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground">{selectedPatient.patientId}</p>
                      <p className="text-sm text-muted-foreground">{selectedPatient.phone}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPatient(null)}
                    >{t('ui.change')}</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder={t('Search patient by name, phone, or ID...')}
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border">
                    {filteredPatients.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        <p>{t('ui.no_patients_found')}</p>
                        <Link href="/patients/new">
                          <Button variant="link" size="sm">
                            {t('Add New Patient')}
                          </Button>
                        </Link>
                      </div>
                    ) : (
                      filteredPatients.slice(0, 5).map((patient) => (
                        <div
                          key={patient.id}
                          className="flex cursor-pointer items-center justify-between border-b p-3 last:border-0 hover:bg-muted/50"
                          onClick={() => {
                            setSelectedPatient(patient)
                            setPatientSearch('')
                          }}
                        >
                          <div>
                            <p className="font-medium">
                              {patient.firstName} {patient.lastName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {patient.patientId} | {patient.phone}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Doctor & Schedule */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />{t('ui.schedule')}</CardTitle>
              <CardDescription>{t('Select doctor, date, and time for the appointment')}</CardDescription>
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
                    min={getMinDate()}
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
                ) : !selectedDoctor || !selectedDate ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    {t('Select doctor and date to see available slots')}
                  </p>
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
              <CardDescription>{t('Additional information about the appointment')}</CardDescription>
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
                      <SelectItem value="1">{t("Chair 1")}</SelectItem>
                      <SelectItem value="2">{t("Chair 2")}</SelectItem>
                      <SelectItem value="3">{t("Chair 3")}</SelectItem>
                      <SelectItem value="4">{t("Chair 4")}</SelectItem>
                      <SelectItem value="5">{t("Chair 5")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-4 md:col-span-3">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <Video className="h-4 w-4 text-blue-600" />
                      {t("Virtual Visit (Video Consultation)")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t('Enable to create a tele-dentistry video consultation for this appointment')}
                    </p>
                  </div>
                  <Switch checked={isVirtual} onCheckedChange={setIsVirtual} />
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
          <Link href="/appointments">
            <Button type="button" variant="outline">{t('ui.cancel')}</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('ui.creating')}</>
            ) : (
              <>
                <Calendar className="mr-2 h-4 w-4" />{t('ui.book_appointment')}</>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
