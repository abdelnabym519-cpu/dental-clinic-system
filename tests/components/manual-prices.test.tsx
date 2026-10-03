// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Issue 7 — manual prices. Contract under test:
//   1. treatments/new: selecting a procedure must NOT overwrite a manually
//      typed cost (no fixed-catalog auto-population).
//   2. treatment-plans/new: adding an item without a typed cost is blocked
//      with a clear Arabic message (no silent basePrice default).
//   3. treatment-plans/[id]: the estimated cost of an existing plan item is
//      editable inline; saving PUTs the full items array with the new cost
//      and every other field (status included) preserved.
// Only line total / subtotal / VAT 14% / grand total are ever auto-calculated.
// ---------------------------------------------------------------------------

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/treatments',
}))

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))

vi.mock('lucide-react', async (importOriginal) => {
  const icon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement('svg', { ...props, ref, 'data-testid': `lucide-${name}` })
    )
  const actual = (await importOriginal()) as any
  return new Proxy(actual, { get: (_: any, p: string) => actual[p] || icon(p) })
})

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, onClick, ...props }: any) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: React.forwardRef((props: any, ref: any) => <input ref={ref} {...props} />),
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: React.forwardRef((props: any, ref: any) => <textarea ref={ref} {...props} />),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}))

function deepCloneWith(children: React.ReactNode, props: Record<string, any>): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child
    const el = child as any
    const merged = { ...props, ...el.props }
    if (el.props?.children) merged.children = deepCloneWith(el.props.children, props)
    return React.cloneElement(el, merged)
  })
}

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select-root" data-value={value}>
      {deepCloneWith(children, { onValueChange })}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children, onValueChange }: any) => (
    <div data-testid="select-content">{deepCloneWith(children, { onValueChange })}</div>
  ),
  SelectItem: ({ children, value, onValueChange }: any) => (
    <div data-testid={`select-item-${value}`} onClick={() => onValueChange?.(value)}>
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children, ...props }: any) => <td {...props}>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
}))

vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }))

vi.mock('@/components/ui/separator', () => ({
  Separator: (props: any) => <hr {...props} />,
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: any) => <div data-testid="progress" data-value={value} />,
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: (props: any) => <div data-testid="skeleton" {...props} />,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/treatments/dental-chart', () => ({
  DentalChart: () => <div data-testid="dental-chart-stub" />,
}))

vi.mock('@/lib/treatment-utils', () => ({
  procedureCategoryConfig: {
    RESTORATIVE: { label: 'ترميمي', color: 'text-blue-700', bgColor: 'bg-blue-100', icon: 'Wrench' },
  },
  treatmentStatusConfig: {},
  treatmentPlanStatusConfig: {},
  treatmentPlanItemStatusConfig: {},
  formatCurrency: (val: number | string) => `EGP ${Number(val).toLocaleString('en-EG')}`,
  formatDate: (d: any) => String(d),
  calculatePlanProgress: () => 0,
}))

import { LanguageProvider } from '@/components/providers/language-provider'
import TreatmentsNewPage from '@/app/(dashboard)/treatments/new/page'
import PlanNewPage from '@/app/(dashboard)/treatments/plans/new/page'
import PlanDetailPage from '@/app/(dashboard)/treatments/plans/[id]/page'

const PROCEDURE = {
  id: 'proc-1',
  code: 'D2392',
  name: 'حشوة كومبوزيت',
  category: 'RESTORATIVE',
  basePrice: 500,
  defaultDuration: 45,
  isActive: true,
  description: null,
}

function mount(ui: React.ReactNode) {
  return render(<LanguageProvider initialLocale="ar-EG">{ui}</LanguageProvider>)
}

describe('Issue 7 — manual prices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treatments/new — selecting a procedure does NOT overwrite a manually typed cost', async () => {
    ;(global.fetch as any) = vi.fn((url: string) => {
      if (url.includes('/api/procedures')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ procedures: [PROCEDURE] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ patients: [], doctors: [] }) })
    })

    mount(<TreatmentsNewPage />)

    const cost = await screen.findByPlaceholderText('أدخل تكلفة العلاج')
    fireEvent.change(cost, { target: { value: '777.5' } })
    expect((cost as HTMLInputElement).value).toBe('777.5')

    fireEvent.click(screen.getByTestId('select-item-proc-1'))

    // the click really selected: the procedure summary panel appears
    await waitFor(() => {
      expect(screen.getByText('حشوة كومبوزيت')).toBeInTheDocument()
    })
    // …and the manually typed cost survived the selection untouched
    expect((screen.getByPlaceholderText('أدخل تكلفة العلاج') as HTMLInputElement).value).toBe(
      '777.5'
    )
  })

  it('treatment-plans/new — adding an item without a typed cost is blocked with an Arabic message', async () => {
    ;(global.fetch as any) = vi.fn((url: string) => {
      if (url.includes('/api/procedures')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ procedures: [PROCEDURE] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ patients: [] }) })
    })

    mount(<PlanNewPage />)

    fireEvent.click(await screen.findByTestId('select-item-proc-1'))
    fireEvent.click(screen.getByText('إضافة إجراء'))

    expect(
      screen.getByText('أدخل التكلفة التقديرية للإجراء قبل إضافته')
    ).toBeInTheDocument()
    // no item row appeared
    expect(screen.queryByText('D2392')).not.toBeInTheDocument()
  })

  it('treatment-plans/new — a manually typed cost is used verbatim for the plan item', async () => {
    ;(global.fetch as any) = vi.fn((url: string) => {
      if (url.includes('/api/procedures')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ procedures: [PROCEDURE] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ patients: [] }) })
    })

    mount(<PlanNewPage />)

    fireEvent.click(await screen.findByTestId('select-item-proc-1'))
    const costInput = screen.getByLabelText('التكلفة التقديرية')
    fireEvent.change(costInput, { target: { value: '1234.5' } })
    fireEvent.click(screen.getByText('إضافة إجراء'))

    await waitFor(() => {
      expect(screen.getByText('D2392')).toBeInTheDocument()
    })
    expect(screen.getAllByText('EGP 1,234.5').length).toBeGreaterThanOrEqual(1)
  })

  it('treatment-plans/[id] — inline cost edit PUTs the new cost and preserves every other field', async () => {
    const plan = {
      id: 'plan-1',
      planNumber: 'TP-1',
      title: 'خطة العلاج',
      notes: null,
      status: 'IN_PROGRESS',
      estimatedCost: 1500,
      estimatedDuration: 90,
      startDate: null,
      expectedEndDate: null,
      completedDate: null,
      consentGiven: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      patient: { id: 'p1', patientId: 'P-1', firstName: 'أحمد', lastName: 'سعيد', phone: '010', email: null, dateOfBirth: null, gender: null },
      items: [
        {
          id: 'item-1',
          priority: 1,
          toothNumbers: '16',
          estimatedCost: 500,
          notes: null,
          status: 'COMPLETED',
          procedure: { id: 'proc-1', code: 'D2392', name: 'حشوة', category: 'RESTORATIVE', basePrice: 500 },
        },
        {
          id: 'item-2',
          priority: 2,
          toothNumbers: null,
          estimatedCost: 1000,
          notes: 'ملاحظة',
          status: 'PENDING',
          procedure: { id: 'proc-2', code: 'D2740', name: 'تاج', category: 'RESTORATIVE', basePrice: 2500 },
        },
      ],
    }

    ;(global.fetch as any) = vi.fn((url: string, init?: any) => {
      if (url === '/api/treatment-plans/plan-1' && (!init || !init.method)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(plan) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    await act(async () => {
      mount(<PlanDetailPage params={Promise.resolve({ id: 'plan-1' })} />)
    })

    const costInput = await screen.findByTestId('plan-item-cost-item-2')
    const input = costInput.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('1000')
    fireEvent.change(input, { target: { value: '999' } })

    fireEvent.click(screen.getByText('حفظ'))

    await waitFor(() => {
      const putCall = (global.fetch as any).mock.calls.find(
        (c: any) => c[0] === '/api/treatment-plans/plan-1' && c[1]?.method === 'PUT'
      )
      expect(putCall).toBeTruthy()
      const body = JSON.parse(putCall[1].body)
      expect(body.items).toHaveLength(2)
      // the edited item carries the new manual price…
      const edited = body.items.find((i: any) => i.procedureId === 'proc-2')
      expect(edited.estimatedCost).toBe(999)
      // …and every other field survives the round-trip
      expect(edited.status).toBe('PENDING')
      expect(edited.notes).toBe('ملاحظة')
      const untouched = body.items.find((i: any) => i.procedureId === 'proc-1')
      expect(untouched.estimatedCost).toBe(500)
      expect(untouched.status).toBe('COMPLETED')
    })
  })
})
