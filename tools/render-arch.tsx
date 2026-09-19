/**
 * Visual verification harness.
 *
 * SSR-renders the REAL <ToothSVG> components (same code path as the browser),
 * composes them into arch-sheet SVG documents and rasterizes them with
 * @resvg/resvg-js so the rendered pixels can be inspected.
 *
 * Run: npx tsx tools/render-arch.tsx
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
import path from 'node:path'
import { ToothSVG } from '../components/dental-chart/odontogram/ToothSVG'
import {
  ToothViewModel,
  DentalCondition,
  ToothAnatomyGroup,
  ToothPosition,
  ToothSide,
} from '../components/dental-chart/types/odontogram'
import { getToothSpecificType } from '../components/dental-chart/geometry/tooth-paths'

const NAMES: Record<number, string> = {
  11: 'Upper R Central Incisor', 12: 'Upper R Lateral Incisor', 13: 'Upper R Canine',
  14: 'Upper R First Premolar', 15: 'Upper R Second Premolar', 16: 'Upper R First Molar',
  17: 'Upper R Second Molar', 18: 'Upper R Third Molar',
  21: 'Upper L Central Incisor', 22: 'Upper L Lateral Incisor', 23: 'Upper L Canine',
  24: 'Upper L First Premolar', 25: 'Upper L Second Premolar', 26: 'Upper L First Molar',
  27: 'Upper L Second Molar', 28: 'Upper L Third Molar',
  31: 'Lower L Central Incisor', 32: 'Lower L Lateral Incisor', 33: 'Lower L Canine',
  34: 'Lower L First Premolar', 35: 'Lower L Second Premolar', 36: 'Lower L First Molar',
  37: 'Lower L Second Molar', 38: 'Lower L Third Molar',
  41: 'Lower R Central Incisor', 42: 'Lower R Lateral Incisor', 43: 'Lower R Canine',
  44: 'Lower R First Premolar', 45: 'Lower R Second Premolar', 46: 'Lower R First Molar',
  47: 'Lower R Second Molar', 48: 'Lower R Third Molar',
}

function groupOf(n: number): ToothAnatomyGroup {
  const d = n % 10
  if (d === 1 || d === 2) return 'incisor'
  if (d === 3) return 'canine'
  if (d === 4 || d === 5) return 'premolar'
  return 'molar'
}
function positionOf(n: number): ToothPosition {
  return Math.floor(n / 10) <= 2 ? 'upper' : 'lower'
}
function sideOf(n: number): ToothSide {
  const q = Math.floor(n / 10)
  return q === 1 || q === 4 ? 'right' : 'left'
}

function makeTooth(
  number: number,
  condition: DentalCondition = 'HEALTHY',
  surfaces: Partial<Record<'mesial' | 'distal' | 'occlusal' | 'buccal' | 'lingual', boolean>> = {}
): ToothViewModel {
  const isMissing = condition === 'MISSING' || condition === 'EXTRACTION'
  return {
    number,
    fdiNotation: String(number),
    name: NAMES[number],
    group: groupOf(number),
    specificType: getToothSpecificType(number),
    position: positionOf(number),
    side: sideOf(number),
    quadrant: Math.floor(number / 10) as 1 | 2 | 3 | 4,
    rootCount: 1,
    canalCount: 1,
    condition,
    severity: 'MILD',
    surfaces: {
      mesial: Boolean(surfaces.mesial),
      distal: Boolean(surfaces.distal),
      occlusal: Boolean(surfaces.occlusal),
      buccal: Boolean(surfaces.buccal),
      lingual: Boolean(surfaces.lingual),
    },
    history: [],
    isMissing,
    isImplant: condition === 'IMPLANT',
    isCrown: condition === 'CROWN',
    isBridge: condition === 'BRIDGE',
    isRootCanal: condition === 'ROOT_CANAL',
    isFractured: condition === 'FRACTURED',
    hasAbscess: condition === 'ABSCESS',
    hasPeriodontal: condition === 'PERIODONTAL',
    hasMobility: condition === 'MOBILITY',
    hasSensitivity: condition === 'SENSITIVE',
  }
}

/** SSR-render one tooth's SVG markup, repositioned as a nested <svg>. */
function placeTooth(tooth: ToothViewModel, x: number, y: number, w: number, h: number): string {
  const markup = renderToStaticMarkup(
    React.createElement(ToothSVG, { tooth, interactive: false })
  )
  const repositioned = markup.replace(
    /^<svg/,
    `<svg x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"`
  )
  return repositioned
}

function cellWidth(tooth: ToothViewModel): number {
  const g = tooth.group
  if (g === 'molar') return 66
  if (g === 'incisor' && tooth.number % 10 === 1) return 52
  if (g === 'incisor' && tooth.number % 10 === 2) return 55
  return 59
}

function label(x: number, y: number, text: string, size = 13, anchor: 'start' | 'middle' = 'middle', color = '#475569') {
  return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="bold">${text}</text>`
}

function sheet(title: string, body: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#F8FAFC"/>
  <rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="2" rx="18"/>
  ${label(width / 2, 44, title, 22)}
  ${body}
</svg>`
}

function toPng(svg: string, outPath: string, width: number) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: '#F8FAFC' })
  fs.writeFileSync(outPath, resvg.render().asPng())
  console.log('wrote', outPath)
}

// ══════════════════════════════════════════════════════════════════════════════
// SHEET 1 — full healthy arch (mirrors ArchGrid order)
// ══════════════════════════════════════════════════════════════════════════════
function archSheet(): string {
  const upperOrder = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
  const lowerOrder = [41, 42, 43, 44, 45, 46, 47, 48, 38, 37, 36, 35, 34, 33, 32, 31]
  const scale = 1.2
  const cellH = 132
  const gap = 4

  function row(order: number[], top: number, numberOnTop: boolean): string {
    let x = 60
    let out = ''
    const midIndex = order.indexOf(21) // midline between 11 and 21 (upper) / between 48 and 38 (lower)
    order.forEach((num, i) => {
      const tooth = makeTooth(num)
      const w = cellWidth(tooth)
      const tw = 64 * scale
      const th = 100 * scale
      const y = numberOnTop ? top : top + (cellH - th)
      out += placeTooth(tooth, x + (w - tw) / 2, y, tw, th)
      out += label(x + w / 2, numberOnTop ? top - 8 : top + cellH + 18, String(num), 12)
      x += w + gap
      if (i === midIndex - 1) {
        // midline marker after tooth 11 / 48
        out += `<line x1="${x - gap / 2}" y1="${top - 14}" x2="${x - gap / 2}" y2="${top + cellH + 14}" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="6 4"/>`
        x += 14
      }
    })
    return out
  }

  const upperTop = 92
  const lowerTop = 92 + cellH + 66
  const body =
    row(upperOrder, upperTop, true) +
    `<line x1="40" y1="${upperTop + cellH + 33}" x2="1010" y2="${upperTop + cellH + 33}" stroke="#94A3B8" stroke-width="2" stroke-dasharray="10 6"/>` +
    label(525, upperTop + cellH + 30, 'OCCLUSAL PLANE', 11, 'middle', '#94A3B8') +
    row(lowerOrder, lowerTop, false)

  return sheet('DenToRa Odontogram — Healthy Permanent Dentition (FDI)', body, 1080, lowerTop + cellH + 70)
}

// ══════════════════════════════════════════════════════════════════════════════
// SHEET 2 — clinical condition variants
// ══════════════════════════════════════════════════════════════════════════════
function conditionsSheet(): string {
  const variants: Array<[number, DentalCondition, Partial<Record<'mesial' | 'distal' | 'occlusal' | 'buccal' | 'lingual', boolean>>, string]> = [
    [11, 'HEALTHY', {}, 'Healthy'],
    [12, 'CARIES', { occlusal: true }, 'Caries O'],
    [13, 'CROWN', {}, 'Crown'],
    [14, 'ROOT_CANAL', {}, 'RCT'],
    [15, 'CARIES', { mesial: true, occlusal: true, distal: true }, 'Caries MOD'],
    [16, 'IMPLANT', {}, 'Implant'],
    [17, 'MISSING', {}, 'Missing'],
    [18, 'FRACTURED', { buccal: true }, 'Fractured'],
    [41, 'HEALTHY', {}, 'Healthy'],
    [42, 'SENSITIVE', {}, 'Sensitive'],
    [43, 'MOBILITY', {}, 'Mobility'],
    [44, 'FILLED', { occlusal: true }, 'Filling O'],
    [45, 'ABSCESS', {}, 'Abscess'],
    [46, 'PERIODONTAL', {}, 'Periodontal'],
    [47, 'CROWN', {}, 'Crown'],
    [48, 'BRIDGE', {}, 'Bridge'],
  ]
  const scale = 1.2
  const cellW = 66
  const cellH = 132
  let out = ''
  variants.forEach(([num, cond, surf, tag], i) => {
    const x = 50 + i * (cellW + 6)
    const y = 110
    const tooth = makeTooth(num, cond, surf)
    const tw = 64 * scale
    out += placeTooth(tooth, x + (cellW - tw) / 2, y, tw, 100 * scale)
    out += label(x + cellW / 2, y - 10, String(num), 13)
    out += label(x + cellW / 2, y + 100 * scale + 22, tag, 10, 'middle', '#64748B')
  })
  return sheet('Diagnostic Condition Overlays (14 clinical states)', out, 1080, 330)
}

// ══════════════════════════════════════════════════════════════════════════════
// SHEET 3 — close-up class comparison (upper row, 11 → 18, large)
// ══════════════════════════════════════════════════════════════════════════════
function closeUpSheet(): string {
  const order = [11, 12, 13, 14, 15, 16, 17, 18]
  const scale = 1.55
  const cellW = 86
  let out = ''
  order.forEach((num, i) => {
    const x = 55 + i * (cellW + 8)
    const y = 120
    const tw = 64 * scale
    const th = 100 * scale
    out += placeTooth(makeTooth(num), x + (cellW - tw) / 2, y, tw, th)
    out += label(x + cellW / 2, y - 12, String(num), 15)
    out += label(x + cellW / 2, y + th + 26, NAMES[num].replace('Upper R ', ''), 9.5, 'middle', '#64748B')
  })
  return sheet('Maxillary Class Close-Up (11 → 18)', out, 900, 120 + 100 * scale + 70)
}

const outDir = path.resolve(process.cwd(), 'tools/preview')
fs.mkdirSync(outDir, { recursive: true })

toPng(archSheet(), path.join(outDir, 'arch-healthy.png'), 2160)
toPng(conditionsSheet(), path.join(outDir, 'arch-conditions.png'), 2160)
toPng(closeUpSheet(), path.join(outDir, 'closeup-maxillary.png'), 1800)
console.log('done')
