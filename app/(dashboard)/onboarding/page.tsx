'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Loader2,
  Building2,
  Clock,
  CreditCard,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Checkbox } from '@/components/ui/checkbox'
import { EGYPT_GOVERNORATES } from '@/lib/egypt-governorates'

const onboardingSchema = z.object({
  tagline: z.string().optional(),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  pincode: z
    .string()
    .regex(/^[1-9]\d{4}$/, 'Postal code must be 5 digits (11111-99999)'),
  alternatePhone: z.string().optional(),
  website: z.string().optional(),
  gstNumber: z.string().optional(),
  registrationNo: z.string().optional(),
  workingHours: z.string().optional(),
  upiId: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNo: z.string().optional(),
  bankIfsc: z.string().optional(),
  bankAccountName: z.string().optional(),
})

type OnboardingFormData = z.infer<typeof onboardingSchema>

const defaultWorkingHours = {
  monday: { open: '09:00', close: '18:00', closed: false },
  tuesday: { open: '09:00', close: '18:00', closed: false },
  wednesday: { open: '09:00', close: '18:00', closed: false },
  thursday: { open: '09:00', close: '18:00', closed: false },
  friday: { open: '09:00', close: '18:00', closed: false },
  saturday: { open: '09:00', close: '14:00', closed: false },
  sunday: { open: null, close: null, closed: true },
}

const steps = [
  { id: 1, title: 'Clinic Details', icon: Building2 },
  { id: 2, title: 'Working Hours', icon: Clock },
  { id: 3, title: 'Payment Setup', icon: CreditCard },
  { id: 4, title: 'Complete', icon: CheckCircle2 },
]

export default function OnboardingPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const [currentStep, setCurrentStep] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [hospitalName, setHospitalName] = useState('')
  const [workingHours, setWorkingHours] = useState(defaultWorkingHours)

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<OnboardingFormData>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      tagline: '',
      address: '',
      city: '',
      state: '',
      pincode: '',
    },
  })

  useEffect(() => {
    fetchHospitalData()
  }, [])

  const fetchHospitalData = async () => {
    try {
      const response = await fetch('/api/onboarding')
      if (response.ok) {
        const data = await response.json()
        setHospitalName(data.name)
        if (data.onboardingCompleted) {
          router.push('/dashboard')
        }
        // Pre-fill form if data exists
        if (data.address) setValue('address', data.address)
        if (data.city) setValue('city', data.city)
        if (data.state) setValue('state', data.state)
        if (data.pincode) setValue('pincode', data.pincode)
        if (data.workingHours) {
          try {
            setWorkingHours(JSON.parse(data.workingHours))
          } catch {
            // Use defaults
          }
        }
      }
    } catch {
      // Ignore errors on initial fetch
    }
  }

  const handleWorkingHoursChange = (day: string, field: string, value: string | boolean) => {
    setWorkingHours((prev) => ({
      ...prev,
      [day]: {
        ...prev[day as keyof typeof prev],
        [field]: value,
      },
    }))
  }

  const onSubmit = async (data: OnboardingFormData) => {
    setIsLoading(true)

    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          workingHours: JSON.stringify(workingHours),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.error || 'Something went wrong. Please try again.',
        })
        return
      }

      setCurrentStep(4)
      toast({
        title: 'Setup complete!',
        description: 'Your clinic is ready to use.',
      })
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Something went wrong. Please try again.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const nextStep = () => setCurrentStep((prev) => Math.min(prev + 1, 3))
  const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 1))

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/5 p-4">
      <div className="max-w-2xl mx-auto pt-8">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex justify-between">
            {steps.map((step) => {
              const Icon = step.icon
              const isActive = currentStep === step.id
              const isComplete = currentStep > step.id
              return (
                <div key={step.id} className="flex flex-col items-center">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isComplete
                          ? 'bg-green-500 text-white'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="mt-2 text-xs text-muted-foreground">{t(step.title)}</span>
                </div>
              )
            })}
          </div>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">
              {currentStep === 4 ? t("You're all set!") : t("Setup {v1}", { v1: hospitalName || 'your clinic' })}
            </CardTitle>
            <CardDescription>
              {currentStep === 1 && t("Enter your clinic's location details")}
              {currentStep === 2 && t("Set your working hours")}
              {currentStep === 3 && t("Configure payment options (optional)")}
              {currentStep === 4 && t("Your clinic is ready to accept patients")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)}>
              {/* Step 1: Clinic Details */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="tagline">{t("Tagline (optional)")}</Label>
                    <Input
                      id="tagline"
                      placeholder={t('Your smile, our priority')}
                      {...register('tagline')}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address">{t("Address *")}</Label>
                    <Input id="address" placeholder={t("123, Main Street")} {...register('address')} />
                    {errors.address && (
                      <p className="text-sm text-destructive">{t(errors.address.message ?? '')}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city">{t("City *")}</Label>
                      <Input id="city" placeholder="القاهرة" {...register('city')} />
                      {errors.city && (
                        <p className="text-sm text-destructive">{t(errors.city.message ?? '')}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="state">{t('Governorate')} *</Label>
                      <Input
                        id="state"
                        placeholder="القاهرة"
                        list="egypt-governorates"
                        {...register('state')}
                      />
                      <datalist id="egypt-governorates">
                        {EGYPT_GOVERNORATES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {t(g.label)}
                    </option>
                  ))}
                      </datalist>
                      {errors.state && (
                        <p className="text-sm text-destructive">{t(errors.state.message ?? '')}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="pincode">{t("Postal Code *")}</Label>
                      <Input id="pincode" placeholder="11513" {...register('pincode')} />
                      {errors.pincode && (
                        <p className="text-sm text-destructive">{t(errors.pincode.message ?? '')}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="alternatePhone">{t('ui.alternate_phone')}</Label>
                      <Input
                        id="alternatePhone"
                        placeholder="01012345678"
                        {...register('alternatePhone')}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="website">{t('ui.website')}</Label>
                      <Input id="website" placeholder="www.myclinic.com" {...register('website')} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="gstNumber">{t('Tax ID')}</Label>
                      <Input
                        id="gstNumber"
                        placeholder="123456789"
                        {...register('gstNumber')}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="registrationNo">{t('ui.registration_number')}</Label>
                    <Input
                      id="registrationNo"
                      placeholder={t('MED-2024-12345')}
                      {...register('registrationNo')}
                    />
                  </div>
                </div>
              )}

              {/* Step 2: Working Hours */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  {Object.entries(workingHours).map(([day, hours]) => (
                    <div key={day} className="flex items-center gap-4">
                      <div className="w-24 font-medium capitalize">{day}</div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={!hours.closed}
                          onCheckedChange={(checked) =>
                            handleWorkingHoursChange(day, 'closed', !checked)
                          }
                        />
                        <span className="text-sm text-muted-foreground">{t('ui.open')}</span>
                      </div>
                      {!hours.closed && (
                        <>
                          <Input
                            type="time"
                            value={hours.open || '09:00'}
                            onChange={(e) => handleWorkingHoursChange(day, 'open', e.target.value)}
                            className="w-32"
                          />
                          <span className="text-muted-foreground">{t("to")}</span>
                          <Input
                            type="time"
                            value={hours.close || '18:00'}
                            onChange={(e) => handleWorkingHoursChange(day, 'close', e.target.value)}
                            className="w-32"
                          />
                        </>
                      )}
                      {hours.closed && (
                        <span className="text-sm text-muted-foreground">{t('Closed')}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Step 3: Payment Setup */}
              {currentStep === 3 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('Configure your payment options for invoices. All fields are optional.')}
                  </p>

                  <div className="space-y-2">
                    <Label htmlFor="upiId">{t('ui.instapay_handle')}</Label>
                    <Input id="upiId" placeholder={t("clinic@instapay")} {...register('upiId')} />
                  </div>

                  <div className="border-t pt-4 mt-4">
                    <h4 className="font-medium mb-4">{t('Bank Details')}</h4>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="bankName">{t('ui.bank_name')}</Label>
                        <Input
                          id="bankName"
                          placeholder="البنك الأهلي المصري"
                          {...register('bankName')}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="bankAccountNo">{t('ui.account_number')}</Label>
                          <Input
                            id="bankAccountNo"
                            placeholder="1234567890"
                            {...register('bankAccountNo')}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bankIfsc">{t('ui.swift_bic_code')}</Label>
                          <Input
                            id="bankIfsc"
                            placeholder={t('NBEGEGCX')}
                            {...register('bankIfsc')}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="bankAccountName">{t('Account Holder Name')}</Label>
                        <Input
                          id="bankAccountName"
                          placeholder={t('Dr. Ahmed Mahmoud')}
                          {...register('bankAccountName')}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Complete */}
              {currentStep === 4 && (
                <div className="text-center py-8">
                  <div className="flex justify-center mb-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                      <CheckCircle2 className="h-8 w-8 text-green-600" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{t('Setup Complete!')}</h3>
                  <p className="text-muted-foreground mb-6">
                    {t("Your clinic is now ready. Start by adding your first patient or exploring the dashboard.")}
                  </p>
                  <Button onClick={() => router.push('/dashboard')} className="w-full">
                    {t('Go to Dashboard')}
                  </Button>
                </div>
              )}

              {/* Navigation Buttons */}
              {currentStep < 4 && (
                <div className="flex justify-between mt-6 pt-4 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={prevStep}
                    disabled={currentStep === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />{t('ui.back')}</Button>

                  {currentStep < 3 ? (
                    <Button type="button" onClick={nextStep}>{t('ui.next')}<ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  ) : (
                    <Button type="submit" disabled={isLoading}>
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {t("Complete Setup")}
                    </Button>
                  )}
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        {currentStep < 4 && (
          <p className="text-center text-sm text-muted-foreground mt-4">
            {t('You can always update these settings later from the Settings page.')}
          </p>
        )}
      </div>
    </div>
  )
}
