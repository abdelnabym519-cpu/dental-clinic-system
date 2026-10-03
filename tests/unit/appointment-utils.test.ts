import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  appointmentStatusConfig,
  appointmentTypeConfig,
  priorityConfig,
  formatTime,
  formatDate,
  formatDateForApi,
  isToday,
  getPatientName,
  getDoctorName,
} from '@/lib/appointment-utils'

describe('Appointment Utils - appointmentStatusConfig', () => {
  it('should have all required status types', () => {
    const statuses = [
      'SCHEDULED',
      'CONFIRMED',
      'CHECKED_IN',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
      'RESCHEDULED',
    ]
    statuses.forEach((status) => {
      expect(appointmentStatusConfig[status]).toBeDefined()
      expect(appointmentStatusConfig[status].label).toBeTruthy()
      expect(appointmentStatusConfig[status].color).toBeTruthy()
      expect(appointmentStatusConfig[status].bgColor).toBeTruthy()
    })
  })

  it('should have correct labels', () => {
    expect(appointmentStatusConfig.SCHEDULED.label).toBe('مجدول')
    expect(appointmentStatusConfig.CONFIRMED.label).toBe('مؤكد')
    expect(appointmentStatusConfig.CHECKED_IN.label).toBe('تم الوصول')
    expect(appointmentStatusConfig.IN_PROGRESS.label).toBe('جاري')
    expect(appointmentStatusConfig.COMPLETED.label).toBe('مكتمل')
    expect(appointmentStatusConfig.CANCELLED.label).toBe('ملغي')
    expect(appointmentStatusConfig.NO_SHOW.label).toBe('لم يحضر')
    expect(appointmentStatusConfig.RESCHEDULED.label).toBe('معاد جدولته')
  })

  it('should have proper Tailwind color classes', () => {
    expect(appointmentStatusConfig.COMPLETED.color).toMatch(/text-.*-\d+/)
    expect(appointmentStatusConfig.COMPLETED.bgColor).toMatch(/bg-.*-\d+/)
  })
})

describe('Appointment Utils - appointmentTypeConfig', () => {
  it('should have all required appointment types', () => {
    const types = ['CONSULTATION', 'PROCEDURE', 'FOLLOW_UP', 'EMERGENCY', 'CHECK_UP']
    types.forEach((type) => {
      expect(appointmentTypeConfig[type]).toBeDefined()
      expect(appointmentTypeConfig[type].label).toBeTruthy()
    })
  })

  it('should have correct labels', () => {
    expect(appointmentTypeConfig.CONSULTATION.label).toBe('استشارة')
    expect(appointmentTypeConfig.PROCEDURE.label).toBe('إجراء')
    expect(appointmentTypeConfig.FOLLOW_UP.label).toBe('متابعة')
    expect(appointmentTypeConfig.EMERGENCY.label).toBe('طوارئ')
    expect(appointmentTypeConfig.CHECK_UP.label).toBe('فحص دوري')
  })
})

describe('Appointment Utils - priorityConfig', () => {
  it('should have all required priority levels', () => {
    const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
    priorities.forEach((priority) => {
      expect(priorityConfig[priority]).toBeDefined()
      expect(priorityConfig[priority].label).toBeTruthy()
    })
  })

  it('should have correct labels', () => {
    expect(priorityConfig.LOW.label).toBe('منخفض')
    expect(priorityConfig.NORMAL.label).toBe('عادي')
    expect(priorityConfig.HIGH.label).toBe('عالي')
    expect(priorityConfig.URGENT.label).toBe('عاجل')
  })
})

describe('Appointment Utils - formatTime', () => {
  it('should convert 24h to 12h format - AM', () => {
    expect(formatTime('09:00')).toBe('9:00 ص')
    expect(formatTime('00:30')).toBe('12:30 ص')
    expect(formatTime('11:45')).toBe('11:45 ص')
  })

  it('should convert 24h to 12h format - PM', () => {
    expect(formatTime('13:00')).toBe('1:00 م')
    expect(formatTime('12:00')).toBe('12:00 م')
    expect(formatTime('23:59')).toBe('11:59 م')
    expect(formatTime('18:30')).toBe('6:30 م')
  })

  it('should handle midnight and noon', () => {
    expect(formatTime('00:00')).toBe('12:00 ص')
    expect(formatTime('12:00')).toBe('12:00 م')
  })

  it('should pad minutes correctly', () => {
    expect(formatTime('09:05')).toBe('9:05 ص')
    expect(formatTime('14:01')).toBe('2:01 م')
  })
})

describe('Appointment Utils - formatDate', () => {
  it('should format Date object correctly', () => {
    const date = new Date('2024-06-15')
    const result = formatDate(date)
    expect(result).toContain('١٥')
    expect(result).toContain('٢٠٢٤')
  })

  it('should format date string correctly', () => {
    const result = formatDate('2024-01-20')
    expect(result).toContain('٢٠')
    expect(result).toContain('٢٠٢٤')
  })

  it('uses the Arabic (Egypt) locale format — Issue 6 Arabic-only', () => {
    const date = new Date('2024-06-15')
    const result = formatDate(date)
    // Arabic month name (يونيو = June)
    expect(result).toMatch(/يونيو/)
  })
})

describe('Appointment Utils - formatDateForApi', () => {
  it('should format date as YYYY-MM-DD', () => {
    const date = new Date('2024-06-15T10:30:00')
    expect(formatDateForApi(date)).toBe('2024-06-15')
  })

  it('should pad month and day correctly', () => {
    const date = new Date('2024-01-05')
    expect(formatDateForApi(date)).toBe('2024-01-05')
  })

  it('should handle year boundaries', () => {
    const date = new Date('2024-12-31')
    expect(formatDateForApi(date)).toBe('2024-12-31')
  })
})

describe('Appointment Utils - isToday', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T10:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return true for today', () => {
    expect(isToday('2024-06-15')).toBe(true)
    expect(isToday(new Date('2024-06-15'))).toBe(true)
    expect(isToday(new Date('2024-06-15T23:59:59'))).toBe(true)
  })

  it('should return false for yesterday', () => {
    expect(isToday('2024-06-14')).toBe(false)
    expect(isToday(new Date('2024-06-14'))).toBe(false)
  })

  it('should return false for tomorrow', () => {
    expect(isToday('2024-06-16')).toBe(false)
    expect(isToday(new Date('2024-06-16'))).toBe(false)
  })

  it('should return false for different year', () => {
    expect(isToday('2023-06-15')).toBe(false)
  })
})

describe('Appointment Utils - getPatientName', () => {
  it('should return full patient name', () => {
    const patient = { firstName: 'Rahul', lastName: 'Sharma' }
    expect(getPatientName(patient)).toBe('Rahul Sharma')
  })

  it('should handle single word names', () => {
    const patient = { firstName: 'Prince', lastName: '' }
    expect(getPatientName(patient)).toBe('Prince ')
  })

  it('should handle special characters in names', () => {
    const patient = { firstName: "O'Brien", lastName: 'Jr.' }
    expect(getPatientName(patient)).toBe("O'Brien Jr.")
  })
})

describe('Appointment Utils - getDoctorName', () => {
  it('should return doctor name with Dr. prefix', () => {
    const doctor = { firstName: 'Priya', lastName: 'Patel' }
    expect(getDoctorName(doctor)).toBe('د. Priya Patel')
  })

  it('should handle doctor with single name', () => {
    const doctor = { firstName: 'Anand', lastName: '' }
    expect(getDoctorName(doctor)).toBe('د. Anand ')
  })
})

describe('Appointment Utils - Status Color Consistency', () => {
  it('should use green for completed/success statuses', () => {
    expect(appointmentStatusConfig.COMPLETED.color).toContain('green')
    expect(appointmentStatusConfig.COMPLETED.bgColor).toContain('green')
  })

  it('should use red for error/critical statuses', () => {
    expect(appointmentStatusConfig.NO_SHOW.color).toContain('red')
    expect(priorityConfig.URGENT.color).toContain('red')
    expect(appointmentTypeConfig.EMERGENCY.color).toContain('red')
  })

  it('should use muted/neutral colors for neutral statuses', () => {
    expect(appointmentStatusConfig.CANCELLED.color).toContain('muted')
    expect(priorityConfig.LOW.color).toContain('muted')
  })
})
