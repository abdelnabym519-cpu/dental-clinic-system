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
import { Separator } from '@/components/ui/separator'
import { ArrowLeft, Loader2, Eye, EyeOff } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { EGYPT_GOVERNORATES } from '@/lib/egypt-governorates'

export default function NewStaffPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [formData, setFormData] = useState({
    // Basic Info
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    alternatePhone: '',
    role: '',
    password: '',

    // Personal Details
    dateOfBirth: '',
    gender: '',
    address: '',
    city: '',
    state: 'القاهرة',
    pincode: '',

    // Documents
    aadharNumber: '',
    panNumber: '',

    // Professional
    qualification: '',
    specialization: '',
    licenseNumber: '',
    joiningDate: new Date().toISOString().split('T')[0],

    // Financial
    salary: '',
    bankAccountNo: '',
    bankIfsc: '',

    // Emergency
    emergencyContact: '',
    emergencyPhone: '',
  })

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    if (
      !formData.firstName ||
      !formData.lastName ||
      !formData.email ||
      !formData.phone ||
      !formData.role ||
      !formData.password
    ) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please fill in all required fields',
      })
      return
    }

    if (formData.password.length < 6) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Password must be at least 6 characters',
      })
      return
    }

    try {
      setLoading(true)

      const response = await fetch('/api/staff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create staff member')
      }

      const staff = await response.json()

      toast({
        title: 'Success',
        description: t('Staff member {name} created successfully', { name: `${staff.firstName} ${staff.lastName}` }),
      })

      router.push('/staff')
    } catch (error: any) {
      console.error('Error creating staff:', error)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create staff member',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/staff">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Add New Staff')}</h1>
          <p className="text-muted-foreground">{t('Create a new staff member account')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Account Information */}
          <Card>
            <CardHeader>
              <CardTitle>{t('Account Information')}</CardTitle>
              <CardDescription>{t('Login credentials and role assignment')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">{t("First Name *")}</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => handleChange('firstName', e.target.value)}
                    placeholder={t('ui.enter_first_name')}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">{t("Last Name *")}</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => handleChange('lastName', e.target.value)}
                    placeholder={t('ui.enter_last_name')}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t("Email *")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder={t("staff@yourclinic.com")}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t("Password *")}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    placeholder={t('Enter password')}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">{t("Role *")}</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) => handleChange('role', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('ui.select_role')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">{t('ui.admin')}</SelectItem>
                    <SelectItem value="DOCTOR">{t('ui.doctor')}</SelectItem>
                    <SelectItem value="RECEPTIONIST">{t('ui.receptionist')}</SelectItem>
                    <SelectItem value="LAB_TECH">{t('ui.lab_technician')}</SelectItem>
                    <SelectItem value="ACCOUNTANT">{t('ui.accountant')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle>{t('ui.contact_information')}</CardTitle>
              <CardDescription>{t('ui.phone_and_address_details')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="phone">{t("Phone Number *")}</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="01012345678"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alternatePhone">{t('ui.alternate_phone')}</Label>
                  <Input
                    id="alternatePhone"
                    value={formData.alternatePhone}
                    onChange={(e) => handleChange('alternatePhone', e.target.value)}
                    placeholder="01012345678"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">{t('ui.address')}</Label>
                <Textarea
                  id="address"
                  value={formData.address}
                  onChange={(e) => handleChange('address', e.target.value)}
                  placeholder={t('ui.enter_full_address')}
                  rows={2}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="city">{t('ui.city')}</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => handleChange('city', e.target.value)}
                    placeholder="القاهرة"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">{t("Governorate (المحافظة)")}</Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={(e) => handleChange('state', e.target.value)}
                    list="egypt-governorates"
                    placeholder="القاهرة"
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
                    value={formData.pincode}
                    onChange={(e) => handleChange('pincode', e.target.value)}
                    placeholder="11513"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Personal Details */}
          <Card>
            <CardHeader>
              <CardTitle>{t('ui.personal_details')}</CardTitle>
              <CardDescription>{t('ui.personal_and_identification_information')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dateOfBirth">{t('ui.date_of_birth')}</Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={(e) => handleChange('dateOfBirth', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gender">{t('ui.gender')}</Label>
                  <Select
                    value={formData.gender}
                    onValueChange={(value) => handleChange('gender', value)}
                  >
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
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="aadharNumber">{t("National ID (الرقم القومي)")}</Label>
                  <Input
                    id="aadharNumber"
                    value={formData.aadharNumber}
                    onChange={(e) => handleChange('aadharNumber', e.target.value)}
                    placeholder={t("14-digit national ID")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="panNumber">{t("Commercial Register (السجل التجاري)")}</Label>
                  <Input
                    id="panNumber"
                    value={formData.panNumber}
                    onChange={(e) => handleChange('panNumber', e.target.value)}
                    placeholder={t('CR number')}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Professional Details */}
          <Card>
            <CardHeader>
              <CardTitle>{t('ui.professional_details')}</CardTitle>
              <CardDescription>{t('ui.qualifications_and_employment_information')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="qualification">{t('ui.qualification')}</Label>
                  <Input
                    id="qualification"
                    value={formData.qualification}
                    onChange={(e) => handleChange('qualification', e.target.value)}
                    placeholder={t('BDS, MDS')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="specialization">{t('ui.specialization')}</Label>
                  <Input
                    id="specialization"
                    value={formData.specialization}
                    onChange={(e) => handleChange('specialization', e.target.value)}
                    placeholder={t('Orthodontics, Endodontics')}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="licenseNumber">{t('ui.license_number')}</Label>
                  <Input
                    id="licenseNumber"
                    value={formData.licenseNumber}
                    onChange={(e) => handleChange('licenseNumber', e.target.value)}
                    placeholder="TN/12345"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="joiningDate">{t('ui.joining_date')}</Label>
                  <Input
                    id="joiningDate"
                    type="date"
                    value={formData.joiningDate}
                    onChange={(e) => handleChange('joiningDate', e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Financial Details */}
          <Card>
            <CardHeader>
              <CardTitle>{t('ui.financial_details')}</CardTitle>
              <CardDescription>{t('Salary and bank account information')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="salary">{t("Monthly Salary (EGP)")}</Label>
                <Input
                  id="salary"
                  type="number"
                  value={formData.salary}
                  onChange={(e) => handleChange('salary', e.target.value)}
                  placeholder="50000"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bankAccountNo">{t('ui.bank_account_no')}</Label>
                  <Input
                    id="bankAccountNo"
                    value={formData.bankAccountNo}
                    onChange={(e) => handleChange('bankAccountNo', e.target.value)}
                    placeholder="1234567890"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bankIfsc">{t('ui.swift_bic_code')}</Label>
                  <Input
                    id="bankIfsc"
                    value={formData.bankIfsc}
                    onChange={(e) => handleChange('bankIfsc', e.target.value)}
                    placeholder={t('NBEGEGCX')}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Emergency Contact */}
          <Card>
            <CardHeader>
              <CardTitle>{t('ui.emergency_contact')}</CardTitle>
              <CardDescription>{t('Contact person in case of emergency')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="emergencyContact">{t('ui.contact_name')}</Label>
                <Input
                  id="emergencyContact"
                  value={formData.emergencyContact}
                  onChange={(e) => handleChange('emergencyContact', e.target.value)}
                  placeholder={t('Full name')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyPhone">{t('ui.contact_phone')}</Label>
                <Input
                  id="emergencyPhone"
                  value={formData.emergencyPhone}
                  onChange={(e) => handleChange('emergencyPhone', e.target.value)}
                  placeholder="01012345678"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 mt-6">
          <Link href="/staff">
            <Button variant="outline" type="button">{t('ui.cancel')}</Button>
          </Link>
          <Button type="submit" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("Create Staff Member")}
          </Button>
        </div>
      </form>
    </div>
  )
}
