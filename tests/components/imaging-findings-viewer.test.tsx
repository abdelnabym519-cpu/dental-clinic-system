// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'

import { LanguageProvider } from '@/components/providers/language-provider'
import { translateText } from '@/lib/i18n/dictionary'
// ISSUE 6 — Arabic-only: assertions resolve through the same translator.
const tr = (s: string) => translateText('ar-EG', s)
import { FindingsViewer } from '@/components/imaging/FindingsViewer'
import { FindingCard } from '@/components/imaging/FindingCard'

// Phase 20 (D5) — the findings viewer must paint the REAL Liodon bounding
// boxes: one SVG rect per finding, in original-image pixel coordinates,
// coloured by condition, labelled "condition (confidence%)", and filterable
// by a minimum-confidence threshold.

const FINDINGS = [
  {
    condition: 'caries',
    tooth_number: null,
    confidence: 0.94,
    bounding_box: { x: 100, y: 50, width: 200, height: 120, x2: 300, y2: 170, coordinate_space: 'original_image', units: 'pixels' },
  },
  {
    condition: 'impacted_tooth',
    tooth_number: null,
    confidence: 0.5,
    bounding_box: { x: 400, y: 300, width: 150, height: 90, x2: 550, y2: 390, coordinate_space: 'original_image', units: 'pixels' },
  },
]

function renderViewer(props = {}) {
  return render(
    <LanguageProvider initialLocale="ar-EG">
      <FindingsViewer
        imageUrl="/api/uploads/hosp-1/study-1/original.jpg"
        findings={FINDINGS}
        {...props}
      />
    </LanguageProvider>
  )
}

// jsdom reports naturalWidth 0; the viewer sizes its overlay from it, so
// stub the measured size and fire load the way a browser would.
function loadNaturalSize(container, width, height) {
  const img = container.querySelector('img')
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  fireEvent.load(img)
}

describe('FindingsViewer — bounding box overlay', () => {
  it('draws one SVG rect per finding at the pixel coordinates Liodon emitted', () => {
    const { container } = renderViewer()
    loadNaturalSize(container, 800, 600)

    const rects = container.querySelectorAll('[data-testid="findings-overlay"] rect')
    expect(rects).toHaveLength(2)
    // Finding 1 — caries box in original pixels.
    expect(rects[0].getAttribute('x')).toBe('100')
    expect(rects[0].getAttribute('y')).toBe('50')
    expect(rects[0].getAttribute('width')).toBe('200')
    expect(rects[0].getAttribute('height')).toBe('120')
    expect(rects[0].getAttribute('stroke')).toBe('#ef4444') // caries = red
    // Finding 2 — impacted_tooth, purple.
    expect(rects[1].getAttribute('x')).toBe('400')
    expect(rects[1].getAttribute('stroke')).toBe('#8b5cf6')
  })

  it('labels each box with the condition and confidence percentage', () => {
    const { container } = renderViewer()
    loadNaturalSize(container, 800, 600)
    expect(screen.getByText('تسوس (94%)')).toBeTruthy()
    expect(screen.getByText('سن مطمور (50%)')).toBeTruthy()
  })

  it('clicking a box reports its finding index', () => {
    const onFindingClick = vi.fn()
    const { container } = renderViewer({ onFindingClick })
    loadNaturalSize(container, 800, 600)
    const rects = container.querySelectorAll('[data-testid="findings-overlay"] rect')
    fireEvent.click(rects[0])
    expect(onFindingClick).toHaveBeenCalledWith(0)
    fireEvent.click(rects[1])
    expect(onFindingClick).toHaveBeenCalledWith(1)
  })

  it('filters low-confidence findings with the minimum-confidence slider', () => {
    const { container } = renderViewer()
    loadNaturalSize(container, 800, 600)
    const slider = container.querySelector('input[type="range"]')
    fireEvent.change(slider, { target: { value: '80' } })
    const rects = container.querySelectorAll('[data-testid="findings-overlay"] rect')
    expect(rects).toHaveLength(1)
    expect(screen.queryByText('سن مطمور (50%)')).toBeNull()
    expect(screen.getByText('تسوس (94%)')).toBeTruthy()
  })

  it('can hide the overlays entirely', () => {
    const { container } = renderViewer()
    loadNaturalSize(container, 800, 600)
    expect(container.querySelectorAll('[data-testid="findings-overlay"] rect')).toHaveLength(2)
    fireEvent.click(screen.getByRole('switch'))
    expect(container.querySelectorAll('[data-testid="findings-overlay"] rect')).toHaveLength(0)
  })

  it('switches to the annotated image when available', () => {
    const { container } = renderViewer({ annotatedUrl: '/api/uploads/hosp-1/study-1/annotated.png' })
    const img = container.querySelector('img')
    expect(img.getAttribute('src')).toContain('original.jpg')
    fireEvent.click(screen.getByText('الصورة المظللة بالذكاء الاصطناعي'))
    expect(img.getAttribute('src')).toContain('annotated.png')
  })

  it('unknown conditions get the fallback colour and raw label', () => {
    const { container } = renderViewer({
      findings: [
        {
          condition: 'cyst',
          tooth_number: null,
          confidence: 0.8,
          bounding_box: { x: 1, y: 2, width: 3, height: 4, x2: 4, y2: 6 },
        },
      ],
    })
    loadNaturalSize(container, 800, 600)
    const rect = container.querySelector('[data-testid="findings-overlay"] rect')
    expect(rect.getAttribute('stroke')).toBe('#0ea5e9')
    expect(screen.getByText('cyst (80%)')).toBeTruthy()
  })
})

describe('FindingCard', () => {
  it('shows condition, confidence bar value and the accept checkbox in review mode', () => {
    render(
      <LanguageProvider initialLocale="ar-EG">
        <FindingCard
          finding={FINDINGS[0]}
          index={0}
          reviewMode
          reviewChecked
          onReviewToggle={() => {}}
          onSelect={() => {}}
        />
      </LanguageProvider>
    )
    expect(screen.getByText('تسوس')).toBeTruthy()
    expect(screen.getByText('94%')).toBeTruthy()
    expect(screen.getByRole('checkbox')).toBeTruthy()
  })

  it('does not invent a severity or tooth number when the model emitted none', () => {
    const { container } = render(
      <LanguageProvider initialLocale="ar-EG">
        <FindingCard finding={FINDINGS[1]} index={1} />
      </LanguageProvider>
    )
    expect(screen.getByText('سن مطمور')).toBeTruthy()
    expect(container.textContent).not.toMatch(/High|Medium|Low/i)
    expect(container.textContent).not.toContain('Tooth')
  })

  it('shows the tooth number only when one is available', () => {
    render(
      <LanguageProvider initialLocale="ar-EG">
        <FindingCard
          finding={{ ...FINDINGS[0], tooth_number: 16 }}
          index={0}
        />
      </LanguageProvider>
    )
    expect(screen.getByText(/السن 16/)).toBeTruthy()
  })
})

// Phase 19B (D15) — the Orthodontic AI landmark shape: 38 numbered dots in
// the cropped original's pixel space (top-left origin unchanged → they place
// directly on the original image), the same 1-based numbering as the
// engine's own overlay PNG.
const LANDMARKS = Array.from({ length: 38 }, (_, i) => ({
  landmark_id: i,
  landmark_name: String(i),
  x: 100 + i * 20,
  y: 150 + (i % 10) * 30,
  score: 0.9,
  coordinate_space: 'cropped_original_image',
}))

describe('FindingsViewer — cephalometric landmark overlay (19B)', () => {
  it('draws one numbered SVG circle per landmark at its pixel position', () => {
    const { container } = renderViewer({ findings: LANDMARKS })
    loadNaturalSize(container, 800, 600)

    const circles = container.querySelectorAll('[data-testid="findings-overlay"] circle')
    expect(circles).toHaveLength(38)
    expect(circles[0].getAttribute('cx')).toBe('100')
    expect(circles[0].getAttribute('cy')).toBe('150')
    expect(circles[10].getAttribute('cx')).toBe('300')
    expect(circles[0].getAttribute('fill')).toBe('#ef4444') // the engine's own red

    // 1-based numbering, matching the engine overlay
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('38')).toBeTruthy()
  })

  it('clicking a landmark reports its finding index', () => {
    const onFindingClick = vi.fn()
    const { container } = renderViewer({ findings: LANDMARKS, onFindingClick })
    loadNaturalSize(container, 800, 600)
    const circles = container.querySelectorAll('[data-testid="findings-overlay"] circle')
    fireEvent.click(circles[5])
    expect(onFindingClick).toHaveBeenCalledWith(5)
  })

  it('legend shows the landmark set, not the box conditions', () => {
    const { container } = renderViewer({ findings: LANDMARKS })
    loadNaturalSize(container, 800, 600)
    expect(screen.getByText('38 نقطة سيفالومترية')).toBeTruthy()
    expect(screen.queryByText('Caries (94%)')).toBeNull()
  })

  it('filters landmarks by score with the minimum-confidence slider', () => {
    const { container } = renderViewer({
      findings: [
        { landmark_id: 0, landmark_name: '0', x: 10, y: 10, score: 0.9, coordinate_space: 'cropped_original_image' },
        { landmark_id: 1, landmark_name: '1', x: 20, y: 20, score: 0.3, coordinate_space: 'cropped_original_image' },
      ],
    })
    loadNaturalSize(container, 800, 600)
    const slider = container.querySelector('input[type="range"]')
    fireEvent.change(slider, { target: { value: '50' } })
    const circles = container.querySelectorAll('[data-testid="findings-overlay"] circle')
    expect(circles).toHaveLength(1)
    expect(circles[0].getAttribute('cx')).toBe('10')
  })
})

describe('FindingCard — 19B result shapes', () => {
  it('landmark card: number, the model name + point, score bar', () => {
    render(
      <LanguageProvider initialLocale="ar-EG">
        <FindingCard
          finding={{ landmark_id: 7, landmark_name: '7', x: 123.4, y: 456.7, score: 0.83, coordinate_space: 'cropped_original_image' }}
          index={7}
        />
      </LanguageProvider>
    )
    expect(screen.getByText('نقطة 8')).toBeTruthy()
    expect(screen.getByText('7 · (123, 457)')).toBeTruthy()
    expect(screen.getByText('83%')).toBeTruthy()
  })

  it('landmark card without a score never invents one', () => {
    render(
      <LanguageProvider initialLocale="ar-EG">
        <FindingCard
          finding={{ landmark_id: 0, landmark_name: '0', x: 1, y: 2, score: null, coordinate_space: 'cropped_original_image' }}
          index={0}
        />
      </LanguageProvider>
    )
    expect(screen.getByText('هذا النموذج لا يُصدر مستوى ثقة')).toBeTruthy()
  })

  it('segment card: neutral class + cell count, no confidence bar', () => {
    render(
      <LanguageProvider initialLocale="ar-EG">
        <FindingCard finding={{ class_id: 3, class_name: 'Tooth_3', point_count: 355 }} index={0} />
      </LanguageProvider>
    )
    expect(screen.getByText('Tooth_3')).toBeTruthy()
    expect(screen.getByText('355 خلية')).toBeTruthy()
    expect(screen.getByText('هذا النموذج لا يُصدر مستوى ثقة')).toBeTruthy()
  })
})
