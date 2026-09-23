'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ArrowLeft,
  User,
  Phone,
  Search,
  Plus,
  Trash2,
  AlertCircle,
  Banknote,
  Calculator,
  FileText,
} from 'lucide-react'
import {
  formatCurrency,
  calculateInvoiceTotals,
  vatConfig,
  paymentTermsOptions,
} from '@/lib/billing-utils'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  email: string | null
}

interface UnbilledTreatment {
  treatmentId: string
  treatmentNo: string
  description: string
  procedure: {
    code: string
    name: string
  } | null
  doctor: string | null
  toothNumbers: string | null
  quantity: number
  unitPrice: number
  taxable: boolean
}

interface InvoiceItem {
  id: string
  treatmentId: string | null
  description: string
  quantity: number
  unitPrice: number
  taxable: boolean
}

export default function NewInvoicePage() {
  const { locale } = useLanguage()
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const preSelectedPatientId = searchParams.get('patientId')

  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Patient selection
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [patientSearch, setPatientSearch] = useState('')
  const [showPatientDropdown, setShowPatientDropdown] = useState(false)

  // Unbilled treatments
  const [unbilledTreatments, setUnbilledTreatments] = useState<UnbilledTreatment[]>([])
  const [loadingTreatments, setLoadingTreatments] = useState(false)

  // Invoice items
  const [items, setItems] = useState<InvoiceItem[]>([])

  // Invoice settings
  const [discountType, setDiscountType] = useState<'PERCENTAGE' | 'FIXED'>('FIXED')
  const [discountValue, setDiscountValue] = useState(0)
  const [paymentTermDays, setPaymentTermDays] = useState(0)
  const [notes, setNotes] = useState('')
  const [termsAndConditions, setTermsAndConditions] = useState(() =>
    t(
      '1. Payment is due within the specified payment terms.\n2. Please bring this invoice for reference during your next visit.'
    )
  )

  // Calculated totals
  const [totals, setTotals] = useState({
    subtotal: 0,
    discountAmount: 0,
    taxableAmount: 0,
    nonTaxableAmount: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    totalTax: 0,
    totalAmount: 0,
  })

  // Fetch patients for search
  useEffect(() => {
    const fetchPatients = async () => {
      try {
        const response = await fetch(`/api/patients?search=${patientSearch}&limit=10`)
        if (!response.ok) throw new Error(t('Failed to fetch patients'))
        const data = await response.json()
        setPatients(data.patients)
      } catch (error) {
        console.error('Error fetching patients:', error)
      }
    }

    if (patientSearch.length >= 2) {
      fetchPatients()
      setShowPatientDropdown(true)
    } else {
      setPatients([])
      setShowPatientDropdown(false)
    }
  }, [patientSearch])

  // Fetch pre-selected patient if provided
  useEffect(() => {
    if (preSelectedPatientId) {
      const fetchPatient = async () => {
        try {
          setLoading(true)
          const response = await fetch(`/api/patients?search=${preSelectedPatientId}`)
          if (!response.ok) throw new Error(t('Failed to fetch patient'))
          const data = await response.json()
          if (data.patients.length > 0) {
            setSelectedPatient(data.patients[0])
          }
        } catch (error) {
          console.error('Error fetching patient:', error)
        } finally {
          setLoading(false)
        }
      }
      fetchPatient()
    }
  }, [preSelectedPatientId])

  // Fetch unbilled treatments when patient is selected
  useEffect(() => {
    if (selectedPatient) {
      fetchUnbilledTreatments(selectedPatient.id)
    } else {
      setUnbilledTreatments([])
    }
  }, [selectedPatient])

  const fetchUnbilledTreatments = async (patientId: string) => {
    try {
      setLoadingTreatments(true)
      const response = await fetch(`/api/billing/unbilled-treatments?patientId=${patientId}`)
      if (!response.ok) throw new Error(t('Failed to fetch unbilled treatments'))
      const data = await response.json()
      setUnbilledTreatments(data.treatments)
    } catch (error) {
      console.error('Error fetching unbilled treatments:', error)
    } finally {
      setLoadingTreatments(false)
    }
  }

  // Calculate totals when items or discount changes
  useEffect(() => {
    const calculated = calculateInvoiceTotals(
      items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxable: item.taxable,
      })),
      discountType,
      discountValue
    )
    setTotals(calculated)
  }, [items, discountType, discountValue])

  const selectPatient = (patient: Patient) => {
    setSelectedPatient(patient)
    setPatientSearch('')
    setShowPatientDropdown(false)
    setItems([]) // Clear items when patient changes
  }

  const addTreatmentToInvoice = (treatment: UnbilledTreatment) => {
    const newItem: InvoiceItem = {
      id: `item-${Date.now()}`,
      treatmentId: treatment.treatmentId,
      description: treatment.description,
      quantity: treatment.quantity,
      unitPrice: treatment.unitPrice,
      taxable: treatment.taxable,
    }
    setItems([...items, newItem])
  }

  const addCustomItem = () => {
    const newItem: InvoiceItem = {
      id: `item-${Date.now()}`,
      treatmentId: null,
      description: '',
      quantity: 1,
      unitPrice: 0,
      taxable: true,
    }
    setItems([...items, newItem])
  }

  const updateItem = (id: string, field: keyof InvoiceItem, value: any) => {
    setItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)))
  }

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
  }

  const handleSubmit = async (status: 'DRAFT' | 'PENDING') => {
    if (!selectedPatient) {
      setError('Please select a patient')
      return
    }

    if (items.length === 0) {
      setError(t('Please add at least one item to the invoice'))
      return
    }

    // Validate items
    for (const item of items) {
      if (!item.description.trim()) {
        setError(t('All items must have a description'))
        return
      }
      if (item.quantity <= 0) {
        setError(t('Quantity must be greater than 0'))
        return
      }
      if (item.unitPrice < 0) {
        setError(t('Unit price cannot be negative'))
        return
      }
    }

    try {
      setSubmitting(true)
      setError('')

      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          items: items.map((item) => ({
            treatmentId: item.treatmentId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxable: item.taxable,
          })),
          discountType,
          discountValue,
          paymentTermDays,
          notes,
          termsAndConditions,
          status,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create invoice')
      }

      const invoice = await response.json()
      router.push(`/billing/invoices/${invoice.id}`)
    } catch (error: any) {
      setError(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/billing/invoices">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('ui.new_invoice')}</h1>
          <p className="text-muted-foreground">{t('Create a new invoice for a patient')}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Patient Selection */}
          <Card>
            <CardHeader>
              <CardTitle>{t('ui.patient_details')}</CardTitle>
              <CardDescription>{t('Search and select a patient')}</CardDescription>
            </CardHeader>
            <CardContent>
              {selectedPatient ? (
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                      <User className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <div className="font-medium">
                        {selectedPatient.firstName} {selectedPatient.lastName}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{selectedPatient.patientId}</span>
                        <span>•</span>
                        <Phone className="h-3 w-3" />
                        {selectedPatient.phone}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedPatient(null)
                      setItems([])
                    }}
                  >{t('ui.change')}</Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={t('Search by name, ID, or phone...')}
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    className="pl-9"
                  />
                  {showPatientDropdown && patients.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto">
                      {patients.map((patient) => (
                        <div
                          key={patient.id}
                          className="px-4 py-2 hover:bg-muted cursor-pointer"
                          onClick={() => selectPatient(patient)}
                        >
                          <div className="font-medium">
                            {patient.firstName} {patient.lastName}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {patient.patientId} • {patient.phone}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Unbilled Treatments */}
          {selectedPatient && (
            <Card>
              <CardHeader>
                <CardTitle>{t('Unbilled Treatments')}</CardTitle>
                <CardDescription>{t('Select treatments to add to the invoice')}</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingTreatments ? (
                  <div className="text-center py-4 text-muted-foreground">
                    {t('Loading treatments...')}
                  </div>
                ) : unbilledTreatments.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    {t('No unbilled treatments found')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {unbilledTreatments.map((treatment) => (
                      <div
                        key={treatment.treatmentId}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                      >
                        <div>
                          <div className="font-medium">{treatment.description}</div>
                          <div className="text-sm text-muted-foreground">
                            {treatment.treatmentNo}
                            {treatment.doctor && ` • ${treatment.doctor}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="font-medium">{formatCurrency(treatment.unitPrice, locale)}</div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addTreatmentToInvoice(treatment)}
                            disabled={items.some((i) => i.treatmentId === treatment.treatmentId)}
                          >
                            {items.some((i) => i.treatmentId === treatment.treatmentId) ? (
                              'Added'
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-1" />
                                {t('Add')}
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Invoice Items */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t('ui.invoice_items')}</CardTitle>
                  <CardDescription>{t('Items to be included in the invoice')}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={addCustomItem}>
                  <Plus className="h-4 w-4 mr-1" />
                  {t('Add Custom Item')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2" />
                  <p>{t('No items added yet')}</p>
                  <p className="text-sm">{t('Add treatments from above or add a custom item')}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40%]">{t('ui.description')}</TableHead>
                      <TableHead className="text-center">{t('ui.qty')}</TableHead>
                      <TableHead className="text-right">{t('ui.unit_price')}</TableHead>
                      <TableHead className="text-right">{t('ui.amount')}</TableHead>
                      <TableHead className="text-center">{t('Taxable')}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Input
                            value={item.description}
                            onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                            placeholder={t('Item description')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) =>
                              updateItem(item.id, 'quantity', parseInt(e.target.value) || 1)
                            }
                            className="w-20 text-center"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) =>
                              updateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)
                            }
                            className="w-28 text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(item.quantity * item.unitPrice, locale)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={item.taxable}
                            onCheckedChange={(checked) => updateItem(item.id, 'taxable', checked)}
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeItem(item.id)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>{t('Additional Information')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("Notes (visible on invoice)")}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('Any additional notes for the patient...')}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('ui.terms_conditions')}</Label>
                <Textarea
                  value={termsAndConditions}
                  onChange={(e) => setTermsAndConditions(e.target.value)}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Invoice Summary */}
        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                {t('Invoice Summary')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Discount */}
              <div className="space-y-2">
                <Label>{t('ui.discount')}</Label>
                <div className="flex gap-2">
                  <Select
                    value={discountType}
                    onValueChange={(value: 'PERCENTAGE' | 'FIXED') => setDiscountType(value)}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIXED">{t('Fixed Amount (EGP)')}</SelectItem>
                      <SelectItem value="PERCENTAGE">{t("% Percent")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="0"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* Payment Terms */}
              <div className="space-y-2">
                <Label>{t('ui.payment_terms')}</Label>
                <Select
                  value={paymentTermDays.toString()}
                  onValueChange={(value) => setPaymentTermDays(parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentTermsOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value.toString()}>
                        {t(option.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Totals */}
              <div className="border-t pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{t('ui.subtotal')}</span>
                  <span>{formatCurrency(totals.subtotal, locale)}</span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>{t('ui.discount')}</span>
                    <span>-{formatCurrency(totals.discountAmount, locale)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>{t("VAT (")}{vatConfig.rate}%)</span>
                  <span>{formatCurrency(totals.cgstAmount, locale)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>{t('ui.total')}</span>
                  <span className="text-primary">{formatCurrency(totals.totalAmount, locale)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-4">
                <Button
                  className="w-full"
                  onClick={() => handleSubmit('PENDING')}
                  disabled={submitting || !selectedPatient || items.length === 0}
                >
                  {submitting ? 'Creating...' : t("Create & Send Invoice")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSubmit('DRAFT')}
                  disabled={submitting || !selectedPatient || items.length === 0}
                >
                  {t('Save as Draft')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
