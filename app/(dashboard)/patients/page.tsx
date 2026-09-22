'use client'

import { useLanguage } from '@/components/providers/language-provider'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  User,
  MoreHorizontal,
  Eye,
  Edit,
  FileText,
  Phone,
  Mail,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ExportMenu } from '@/components/ui/export-menu'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  email: string
  gender: string
  age: number
  bloodGroup: string
  city: string
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function PatientsPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  const [genderFilter, setGenderFilter] = useState('all')
  const [bloodGroupFilter, setBloodGroupFilter] = useState('all')

  const fetchPatients = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (search) params.append('search', search)
      if (genderFilter && genderFilter !== 'all') params.append('gender', genderFilter)
      if (bloodGroupFilter && bloodGroupFilter !== 'all')
        params.append('bloodGroup', bloodGroupFilter)

      const response = await fetch(`/api/patients?${params}`)
      if (!response.ok) throw new Error('Failed to fetch patients')

      const data = await response.json()
      setPatients(data.patients)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching patients:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPatients()
  }, [pagination.page, search, genderFilter, bloodGroupFilter])

  const getGenderBadge = (gender: string) => {
    const colors = {
      MALE: 'bg-blue-100 text-blue-700',
      FEMALE: 'bg-pink-100 text-pink-700',
      OTHER: 'bg-purple-100 text-purple-700',
    }
    return (
      <Badge
        className={`${colors[gender as keyof typeof colors] || 'bg-muted text-muted-foreground'} border-0`}
      >
        {gender}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('patients.title')}</h1>
          <p className="text-muted-foreground">{t('Manage patient records and information')}</p>
        </div>
        <div className="flex gap-2">
          <ExportMenu
            filename="patients"
            getData={() =>
              patients.map((p) => ({
                'Patient ID': p.patientId,
                'First Name': p.firstName,
                'Last Name': p.lastName,
                Phone: p.phone,
                Email: p.email || '',
                Gender: p.gender,
                Age: p.age,
                'Blood Group': p.bloodGroup || '',
                City: p.city || '',
              }))
            }
          />
          <Link href="/patients/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              {t('New Patient')}
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('patients.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={genderFilter} onValueChange={setGenderFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t('Gender')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('All Genders')}</SelectItem>
                  <SelectItem value="MALE">{t('Male')}</SelectItem>
                  <SelectItem value="FEMALE">{t('Female')}</SelectItem>
                  <SelectItem value="OTHER">{t('Other')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={bloodGroupFilter} onValueChange={setBloodGroupFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t('Blood Group')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('All Blood Groups')}</SelectItem>
                  <SelectItem value="A+">A+</SelectItem>
                  <SelectItem value="A-">A-</SelectItem>
                  <SelectItem value="B+">B+</SelectItem>
                  <SelectItem value="B-">B-</SelectItem>
                  <SelectItem value="O+">O+</SelectItem>
                  <SelectItem value="O-">O-</SelectItem>
                  <SelectItem value="AB+">AB+</SelectItem>
                  <SelectItem value="AB-">{t("AB-")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Patients Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t('patients.patientId')}</TableHead>
                <TableHead>{t('patients.col.name')}</TableHead>
                <TableHead>{t('patients.contact')}</TableHead>
                <TableHead>{t('patients.gender')}</TableHead>
                <TableHead>{t('patients.age')}</TableHead>
                <TableHead>{t('patients.bloodGroup')}</TableHead>
                <TableHead>{t('patients.location')}</TableHead>
                <TableHead className="text-right">{t('patients.col.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : patients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <User className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">{t('patients.noResults')}</p>
                      <Link href="/patients/new">
                        <Button variant="outline" size="sm">
                          <Plus className="h-4 w-4 mr-2" />
{t('patients.addPatient')}{t("Add Patient")}
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                patients.map((patient) => (
                  <TableRow key={patient.id}>
                    <TableCell>
                      <div className="font-medium">{patient.patientId}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div className="font-medium">
                          {patient.firstName} {patient.lastName}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 text-sm">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {patient.phone}
                        </div>
                        {patient.email && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {patient.email}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getGenderBadge(patient.gender)}</TableCell>
                    <TableCell>
                      <div className="text-sm">{patient.age} {t('years')}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{patient.bloodGroup || 'N/A'}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">{patient.city || 'N/A'}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/patients/${patient.id}`)}>
                            <Eye className="h-4 w-4 mr-2" />
                            {t('View Details')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => router.push(`/patients/${patient.id}/edit`)}
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            {t('Edit')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => router.push(`/patients/${patient.id}/medical-history`)}
                          >
                            <FileText className="h-4 w-4 mr-2" />
                            {t('Medical History')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {!loading && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-4">
              <div className="text-sm text-muted-foreground">
                {t("Showing")} {(pagination.page - 1) * pagination.limit + 1} {t("to")}{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} {t("of")}{' '}
                {pagination.total} {t("patients")}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                  disabled={pagination.page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t('Previous')}
                </Button>
                <div className="text-sm">
                  {t("Page")} {pagination.page} {t("of")} {pagination.totalPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  {t('Next')}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
