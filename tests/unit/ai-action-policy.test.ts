// @ts-nocheck
/**
 * Action Policy Registry — Phase 1.
 *
 * Proves the registry is complete (every AI intent is classified), that
 * classifications are sound (no write is readable-open, financial is
 * approval-gated, PATIENT role is excluded everywhere), and that the
 * parameter validators accept good input and reject malformed input.
 */
import { describe, it, expect } from 'vitest'
import {
  ACTION_POLICIES,
  POLICY_VERSION,
  STAFF_ROLES,
  knownActions,
  resolvePolicy,
} from '@/lib/ai/action-policy'

// The dispatcher in lib/ai/command-executors (executeIntent switch).
const EXECUTER_ACTIONS = [
  'create_patient', 'update_patient', 'search_patients', 'check_patient',
  'book_appointment', 'cancel_appointment', 'reschedule_appointment',
  'complete_appointment', 'show_appointments',
  'create_treatment', 'complete_treatment', 'show_treatments',
  'create_invoice', 'generate_invoice', 'record_payment', 'show_invoices',
  'check_overdue', 'show_revenue',
  'check_stock', 'low_stock', 'add_inventory_item', 'update_stock',
  'create_lab_order', 'update_lab_order', 'show_lab_orders',
  'create_prescription', 'show_prescriptions',
  'add_medication', 'search_medications',
  'show_staff', 'daily_summary',
]

describe('action policy registry — completeness', () => {
  it('classifies every executor action (no unclassified intent can run)', () => {
    for (const a of EXECUTER_ACTIONS) {
      expect(resolvePolicy(a), `policy missing for ${a}`).not.toBeNull()
    }
  })

  it('has no phantom policies (every policy maps to a real executor or a known alias)', () => {
    for (const a of knownActions()) {
      expect(EXECUTER_ACTIONS.includes(a), `policy without executor: ${a}`).toBe(true)
    }
  })

  it('unknown actions resolve to null (fail closed)', () => {
    expect(resolvePolicy('delete_all_patients')).toBeNull()
    expect(resolvePolicy('drop_database')).toBeNull()
    expect(resolvePolicy('')).toBeNull()
    expect(resolvePolicy('admin')).toBeNull()
  })

  it('exposes a policy version for fingerprint binding', () => {
    expect(Number.isInteger(POLICY_VERSION)).toBe(true)
    expect(POLICY_VERSION).toBeGreaterThan(0)
  })
})

describe('action policy registry — RBAC sanity', () => {
  it('no action allows the PATIENT role (portal accounts have no actions)', () => {
    for (const a of Object.values(ACTION_POLICIES)) {
      expect(a.roles, `${a.action} must not allow PATIENT`).not.toContain('PATIENT')
    }
  })

  it('every read action is available to all staff roles', () => {
    for (const a of Object.values(ACTION_POLICIES)) {
      if (a.riskLevel === 'READ') {
        for (const r of STAFF_ROLES) expect(a.roles, `${a.action} read should allow ${r}`).toContain(r)
      }
    }
  })

  it('financial actions restrict the actor to ACCOUNTANT/ADMIN and ADMIN-only approval', () => {
    for (const a of ['record_payment', 'create_invoice']) {
      const p = ACTION_POLICIES[a]
      expect(p.riskLevel).toBe('FINANCIAL')
      expect(p.roles).toEqual(expect.arrayContaining(['ACCOUNTANT']))
      expect(p.roles).not.toContain('RECEPTIONIST')
      expect(p.approvalRoles).toEqual(['ADMIN'])
    }
    // create_invoice = a new billing obligation → a human ALWAYS approves.
    // record_payment → approval is decided by the financial guardrails
    // (within limit+budget → auto-execute; over either or settings missing →
    // approval — fail closed).
    expect(ACTION_POLICIES.create_invoice.approvalRequired).toBe(true)
    expect(ACTION_POLICIES.record_payment.approvalRequired).toBe(false)
  })

  it('clinical writes are doctor-gated', () => {
    for (const a of ['create_treatment', 'complete_treatment', 'create_prescription', 'add_medication']) {
      const p = ACTION_POLICIES[a]
      expect(p.roles).toContain('DOCTOR')
      expect(p.roles).not.toContain('RECEPTIONIST')
    }
  })

  it('inventory mutations are admin-only', () => {
    expect(ACTION_POLICIES.add_inventory_item.roles).toEqual(['ADMIN'])
    expect(ACTION_POLICIES.update_stock.roles).toEqual(['ADMIN'])
  })

  it('external commitments (lab orders) require approval', () => {
    expect(ACTION_POLICIES.create_lab_order.approvalRequired).toBe(true)
    expect(ACTION_POLICIES.create_lab_order.riskLevel).toBe('EXTERNAL')
  })
})

describe('action policy registry — validation', () => {
  const rec = (params) => ACTION_POLICIES.record_payment.validate(params)

  it('record_payment: both references missing → invalid', () => {
    expect(rec({})).not.toBeNull()
  })

  it('record_payment: non-positive / non-numeric amount → invalid', () => {
    expect(rec({ invoiceNo: 'INV-00001', amount: '0' })).not.toBeNull()
    expect(rec({ invoiceNo: 'INV-00001', amount: '-5' })).not.toBeNull()
    expect(rec({ invoiceNo: 'INV-00001', amount: 'abc' })).not.toBeNull()
  })

  it('record_payment: bad payment method → invalid', () => {
    expect(rec({ invoiceNo: 'INV-00001', method: 'CRYPTO' })).not.toBeNull()
  })

  it('record_payment: valid input passes', () => {
    expect(rec({ invoiceNo: 'INV-00001', amount: '1500', method: 'CASH' })).toBeNull()
    expect(rec({ patientName: 'Ahmed', amount: '200', method: 'INSTAPAY' })).toBeNull()
    expect(rec({ invoiceNo: 'INV-00001' })).toBeNull() // amount optional (full balance)
  })

  it('create_patient: required fields + type/enum bounds', () => {
    const v = ACTION_POLICIES.create_patient.validate
    expect(v({ firstName: 'A', lastName: 'B' })).not.toBeNull() // no phone
    expect(v({ firstName: 'A', lastName: 'B', phone: '0100' })).toBeNull()
    expect(v({ firstName: 'A', lastName: 'B', phone: '0100', age: '150' })).not.toBeNull()
    expect(v({ firstName: 'A', lastName: 'B', phone: '0100', age: 'abc' })).not.toBeNull()
    expect(v({ firstName: 'A', lastName: 'B', phone: '0100', gender: 'MALE' })).toBeNull()
    expect(v({ firstName: 'A', lastName: 'B', phone: '0100', gender: 'DRAGON' })).not.toBeNull()
    expect(v({ firstName: 'A', lastName: 'B', phone: '0100', dateOfBirth: 'not-a-date' })).not.toBeNull()
  })

  it('book_appointment: date/time/duration format', () => {
    const v = ACTION_POLICIES.book_appointment.validate
    expect(v({ patientName: 'X', date: '2026-13-99' })).not.toBeNull()
    expect(v({ patientName: 'X', time: '25:99' })).not.toBeNull()
    expect(v({ patientName: 'X', duration: '4' })).not.toBeNull()
    expect(v({ patientName: 'X', date: '2026-10-01', time: '10:30', duration: '30' })).toBeNull()
  })

  it('update_stock: positive integer quantity, valid type', () => {
    const v = ACTION_POLICIES.update_stock.validate
    expect(v({ itemName: 'Gloves', quantity: '0' })).not.toBeNull()
    expect(v({ itemName: 'Gloves', quantity: '2.5' })).not.toBeNull()
    expect(v({ itemName: 'Gloves', quantity: '10', type: 'explode' })).not.toBeNull()
    expect(v({ itemName: 'Gloves', quantity: '10', type: 'remove' })).toBeNull()
  })

  it('create_lab_order: workType enum enforced', () => {
    const v = ACTION_POLICIES.create_lab_order.validate
    expect(v({ patientName: 'X', workType: 'TATTOO' })).not.toBeNull()
    expect(v({ patientName: 'X', workType: 'CROWN' })).toBeNull()
  })

  it('show_revenue: period enum enforced', () => {
    const v = ACTION_POLICIES.show_revenue.validate
    expect(v({ period: 'last_ever' })).not.toBeNull()
    expect(v({ period: 'this_month' })).toBeNull()
  })
})
