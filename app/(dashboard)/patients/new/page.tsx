'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import { DuplicateDetector } from '@/components/ai/duplicate-detector'
import { EGYPT_GOVERNORATES } from '@/lib/egypt-governorates'

const BLOOD_GROUPS = [
  { value: 'A_POSITIVE', label: 'A+' },
  { value: 'A_NEGATIVE', label: 'A-' },
  { value: 'B_POSITIVE', label: 'B+' },
  { value: 'B_NEGATIVE', label: 'B-' },
  { value: 'AB_POSITIVE', label: 'AB+' },
  { value: 'AB_NEGATIVE', label: 'AB-' },
  { value: 'O_POSITIVE', label: 'O+' },
  { value: 'O_NEGATIVE', label: 'O-' },
]

export default function NewPatientPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    age: '',
    gender: '',
    bloodGroup: '',
    phone: '',
    alternatePhone: '',
    email: '',
    address: '',
    city: '',
    state: 'القاهرة',
    pincode: '',
    aadharNumber: '',
    occupation: '',
    referredBy: '',
    referralCode: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelation: '',
  })

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!form.firstName || !form.lastName || !form.phone) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'First name, last name, and phone are required.',
      })
      return
    }

    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
      }

      if (form.dateOfBirth) payload.dateOfBirth = form.dateOfBirth
      if (form.age) payload.age = parseInt(form.age)
      if (form.gender) payload.gender = form.gender
      if (form.bloodGroup) payload.bloodGroup = form.bloodGroup
      if (form.alternatePhone) payload.alternatePhone = form.alternatePhone
      if (form.email) payload.email = form.email
      if (form.address) payload.address = form.address
      if (form.city) payload.city = form.city
      if (form.state) payload.state = form.state
      if (form.pincode) payload.pincode = form.pincode
      if (form.aadharNumber) payload.aadharNumber = form.aadharNumber
      if (form.occupation) payload.occupation = form.occupation
      if (form.referredBy) payload.referredBy = form.referredBy
      if (form.referralCode) payload.referralCode = form.referralCode
      if (form.emergencyContactName) payload.emergencyContactName = form.emergencyContactName
      if (form.emergencyContactPhone) payload.emergencyContactPhone = form.emergencyContactPhone
      if (form.emergencyContactRelation)
        payload.emergencyContactRelation = form.emergencyContactRelation

      const response = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error || `Failed to create patient (${response.status})`)
      }

      const patient = await response.json()

      toast({
        title: 'Patient Created',
        description: `Patient ${form.firstName} ${form.lastName} has been registered successfully.`,
      })

      router.push(`/patients/${patient.id}`)
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create patient',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/patients">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t('New Patient')}</h1>
          <p className="text-muted-foreground">{t('Register a new patient')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ui.personal_information')}</CardTitle>
            <CardDescription>{t('ui.basic_details_of_the_patient')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">{t("First Name *")}</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) => updateField('firstName', e.target.value)}
                placeholder={t('ui.enter_first_name')}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">{t("Last Name *")}</Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={(e) => updateField('lastName', e.target.value)}
                placeholder={t('ui.enter_last_name')}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth">{t('ui.date_of_birth')}</Label>
              <Input
                id="dateOfBirth"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => updateField('dateOfBirth', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="age">{t('ui.age')}</Label>
              <Input
                id="age"
                type="number"
                value={form.age}
                onChange={(e) => updateField('age', e.target.value)}
                placeholder={t('ui.age')}
                min="0"
                max="150"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">{t('ui.gender')}</Label>
              <Select value={form.gender} onValueChange={(v) => updateField('gender', v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('ui.select_gender')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">{t('ui.male')}</SelectItem>
                  <SelectItem value="FEMALE">{t('ui.female')}</SelectItem>
                  <SelectItem value="OTHER">{t('ui.other')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bloodGroup">{t('ui.blood_group')}</Label>
              <Select value={form.bloodGroup} onValueChange={(v) => updateField('bloodGroup', v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('ui.select_blood_group')} />
                </SelectTrigger>
                <SelectContent>
                  {BLOOD_GROUPS.map((bg) => (
                    <SelectItem key={bg.value} value={bg.value}>
                      {t(bg.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Contact Information */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ui.contact_information')}</CardTitle>
            <CardDescription>{t('ui.phone_email_and_address_details')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">{t("Phone *")}</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder={t('ui.enter_phone_number')}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="alternatePhone">{t('ui.alternate_phone')}</Label>
              <Input
                id="alternatePhone"
                value={form.alternatePhone}
                onChange={(e) => updateField('alternatePhone', e.target.value)}
                placeholder={t('ui.alternate_phone_number')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t('ui.email')}</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder={t('ui.enter_email_address')}
              />
            </div>
            <div className="space-y-2 md:col-span-2 lg:col-span-3">
              <Label htmlFor="address">{t('ui.address')}</Label>
              <Textarea
                id="address"
                value={form.address}
                onChange={(e) => updateField('address', e.target.value)}
                placeholder={t('ui.enter_full_address')}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">{t('ui.city')}</Label>
              <Input
                id="city"
                value={form.city}
                onChange={(e) => updateField('city', e.target.value)}
                placeholder={t('ui.city')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">{t("Governorate (المحافظة)")}</Label>
              <Input
                id="state"
                value={form.state}
                onChange={(e) => updateField('state', e.target.value)}
                placeholder="القاهرة"
                list="egypt-governorates"
              />
<datalist id="egypt-governorates">
                  {EGYPT_GOVERNORATES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {t(g.label)}
                    </option>
                  ))}
                </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pincode">{t('ui.postal_code')}</Label>
              <Input
                id="pincode"
                value={form.pincode}
                onChange={(e) => updateField('pincode', e.target.value)}
                placeholder={t('ui.postal_code_2')}
              />
            </div>
          </CardContent>
        </Card>

        {/* Additional Details */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ui.additional_details')}</CardTitle>
            <CardDescription>{t('ui.id_occupation_and_referral_information')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="aadharNumber">{t("National ID (الرقم القومي)")}</Label>
              <Input
                id="aadharNumber"
                value={form.aadharNumber}
                onChange={(e) => updateField('aadharNumber', e.target.value)}
                placeholder={t("14-digit national ID")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="occupation">{t('ui.occupation')}</Label>
              <Input
                id="occupation"
                value={form.occupation}
                onChange={(e) => updateField('occupation', e.target.value)}
                placeholder={t('ui.enter_occupation')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referredBy">{t('ui.referred_by')}</Label>
              <Input
                id="referredBy"
                value={form.referredBy}
                onChange={(e) => updateField('referredBy', e.target.value)}
                placeholder={t('ui.referral_source')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referralCode">{t('ui.referral_code')}</Label>
              <Input
                id="referralCode"
                value={form.referralCode}
                onChange={(e) => updateField('referralCode', e.target.value)}
                placeholder={t("e.g. REF-A3B2K9")}
              />
            </div>
          </CardContent>
        </Card>

        {/* Emergency Contact */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ui.emergency_contact')}</CardTitle>
            <CardDescription>{t('ui.emergency_contact_information')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="emergencyContactName">{t('ui.contact_name')}</Label>
              <Input
                id="emergencyContactName"
                value={form.emergencyContactName}
                onChange={(e) => updateField('emergencyContactName', e.target.value)}
                placeholder={t('ui.emergency_contact_name')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emergencyContactPhone">{t('ui.contact_phone')}</Label>
              <Input
                id="emergencyContactPhone"
                value={form.emergencyContactPhone}
                onChange={(e) => updateField('emergencyContactPhone', e.target.value)}
                placeholder={t('ui.emergency_contact_phone')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emergencyContactRelation">{t('ui.relation')}</Label>
              <Input
                id="emergencyContactRelation"
                value={form.emergencyContactRelation}
                onChange={(e) => updateField('emergencyContactRelation', e.target.value)}
                placeholder={t("e.g. Spouse, Parent")}
              />
            </div>
          </CardContent>
        </Card>

        {/* Duplicate Detection */}
        <DuplicateDetector
          firstName={form.firstName}
          lastName={form.lastName}
          phone={form.phone}
          email={form.email}
          dateOfBirth={form.dateOfBirth}
          onSelect={(existingId) => router.push(`/patients/${existingId}`)}
        />

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Link href="/patients">
            <Button type="button" variant="outline">{t('ui.cancel')}</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('ui.creating')}</>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {t('Create Patient')}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
