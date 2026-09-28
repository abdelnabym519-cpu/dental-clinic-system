'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Image as ImageIcon, Maximize2, Minus, Plus } from 'lucide-react'

import { useLanguage } from '@/components/providers/language-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  findingColor,
  findingConfidence,
  isBoxFinding,
  isLandmarkFinding,
  isSegmentFinding,
  LANDMARK_COLOR,
  type ImagingFinding,
} from '@/components/imaging/types'

// Phase 20 (D5) — X-ray viewer with REAL engine result overlays.
// Phase 19B (D15) — two overlay grammars:
//   - box findings (Liodon / Implant AI): rects in original-image pixel
//     coordinates (the 19A behaviour, unchanged);
//   - landmark findings (Orthodontic AI): numbered dots at (x, y) — the 38
//     cephalometric points in the cropped original's pixel space (top-left
//     origin unchanged, so they place directly on the original image).
// The overlay is an SVG whose viewBox equals the image's natural size, so
// pixel coordinates land exactly on the image no matter the zoom or pan.
// The original image is never modified — the "annotated" view is a separate
// object the AI stack produced.

interface FindingsViewerProps {
  imageUrl: string
  annotatedUrl?: string | null
  findings: ImagingFinding[]
  readonly?: boolean
  selectedFinding?: number | null
  onFindingClick?: (index: number) => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 8

export function FindingsViewer({
  imageUrl,
  annotatedUrl,
  findings,
  readonly = false,
  selectedFinding = null,
  onFindingClick,
}: FindingsViewerProps) {
  const { t } = useLanguage()

  const [view, setView] = useState<'original' | 'annotated'>('original')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [showFindings, setShowFindings] = useState(true)
  const [minConfidence, setMinConfidence] = useState(0)
  const [natural, setNatural] = useState({ width: 0, height: 0 })

  const containerRef = useRef<HTMLDivElement>(null)
  const panState = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  })

  const activeSrc = view === 'annotated' && annotatedUrl ? annotatedUrl : imageUrl

  const visibleFindings = useMemo(
    () =>
      findings.filter((f) => {
        const c = findingConfidence(f)
        // Findings with no certainty value (MeshSegNet segments) are always
        // shown — there is no score to filter on and none is invented.
        return c === null || c * 100 >= minConfidence
      }),
    [findings, minConfidence]
  )

  // Reset the viewport when the study (or the image source) changes.
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setNatural({ width: 0, height: 0 })
  }, [activeSrc])

  const zoomBy = useCallback(
    (factor: number) => {
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)))
    },
    []
  )

  // Wheel zoom with a non-passive listener so the page never scrolls along
  // with the viewer.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return
    panState.current = { active: true, startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    const s = panState.current
    if (!s.active) return
    setPan({ x: s.baseX + (e.clientX - s.startX), y: s.baseY + (e.clientY - s.startY) })
  }
  const stopPanning = () => {
    panState.current.active = false
  }

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const conditionLabel = (c: string) => {
    const key = `imaging.condition.${c}`
    const out = t(key)
    return out === key ? c : out
  }

  // Label font size in image pixels — keeps labels legible at both 300px and
  // 3000px wide images.
  const labelSize = natural.width ? Math.max(13, Math.round(natural.width / 90)) : 16
  const boxStroke = natural.width ? Math.max(1.5, Math.round(natural.width / 900)) : 2

  // Legend from the findings actually present (19B: box conditions, the
  // landmark set, or segment classes — never the whole static colour table).
  const legend = useMemo(() => {
    const items: { key: string; label: string; color: string }[] = []
    const boxSeen = new Set<string>()
    const segSeen = new Set<number>()
    let landmarks = false
    for (const f of findings) {
      if (isBoxFinding(f) && !boxSeen.has(f.condition)) {
        boxSeen.add(f.condition)
        items.push({ key: `box-${f.condition}`, label: conditionLabel(f.condition), color: findingColor(f.condition) })
      } else if (isLandmarkFinding(f)) {
        landmarks = true
      } else if (isSegmentFinding(f) && !segSeen.has(f.class_id)) {
        // MeshSegNet's neutral vocabulary is the recorded identity (no
        // official label-to-tooth-name map exists) — shown as-is.
        segSeen.add(f.class_id)
        items.push({ key: `seg-${f.class_id}`, label: f.class_name, color: findingColor(f.class_name) })
      }
    }
    if (landmarks) {
      items.push({
        key: 'landmarks',
        label: t('imaging.landmarks', { count: findings.filter(isLandmarkFinding).length }),
        color: LANDMARK_COLOR,
      })
    }
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings, t])

  return (
    <Card>
      <CardContent className="p-3">
        {/* Toolbar */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setView('original')}
              className={view === 'original' ? 'bg-accent' : ''}
              title={t('imaging.original_image')}
            >
              <ImageIcon className="h-4 w-4" />
              <span className="hidden md:inline">{t('imaging.original_image')}</span>
            </Button>
            {annotatedUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setView('annotated')}
                className={view === 'annotated' ? 'bg-accent' : ''}
                title={t('imaging.ai_annotated')}
              >
                <Crosshair className="h-4 w-4" />
                <span className="hidden md:inline">{t('imaging.ai_annotated')}</span>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" onClick={() => zoomBy(1 / 1.25)} title={t('imaging.zoom_out')}>
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <Button size="icon" variant="outline" onClick={() => zoomBy(1.25)} title={t('imaging.zoom_in')}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" onClick={resetView} title={t('imaging.zoom_reset')}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={showFindings} onCheckedChange={setShowFindings} disabled={readonly && findings.length === 0} />
              {showFindings ? t('imaging.hide_findings') : t('imaging.show_findings')}
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t('imaging.min_confidence')} {minConfidence}%
              <input
                type="range"
                min={0}
                max={90}
                step={5}
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                className="h-4 w-28 accent-primary"
              />
            </label>
          </div>
        </div>

        {/* Image + overlay */}
        <div
          ref={containerRef}
          className="relative w-full overflow-hidden rounded-lg bg-zinc-950"
          style={{ maxHeight: 560 }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={stopPanning}
          onMouseLeave={stopPanning}
        >
          <div
            className="relative flex min-h-[240px] items-center justify-center"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: panState.current.active ? 'none' : 'transform 0.15s ease',
              cursor: zoom > 1 ? (panState.current.active ? 'grabbing' : 'grab') : 'default',
            }}
          >
            <img
              src={activeSrc}
              alt={t('imaging.original_image')}
              className="max-h-[560px] max-w-full select-none object-contain"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget
                setNatural({ width: el.naturalWidth, height: el.naturalHeight })
              }}
            />
            {showFindings && natural.width > 0 && (
              <svg
                data-testid="findings-overlay"
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${natural.width} ${natural.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {visibleFindings.map((f, vi) => {
                  const idx = findings.indexOf(f)
                  const selected = selectedFinding === idx

                  // Orthodontic AI — numbered landmark dot (1..38, the same
                  // numbering as the engine's own overlay PNG).
                  if (isLandmarkFinding(f)) {
                    const dotR = labelSize * 0.85
                    const left = f.x > dotR
                    return (
                      <g key={`lm-${f.landmark_id}-${vi}`}>
                        <circle
                          cx={f.x}
                          cy={f.y}
                          r={dotR}
                          fill={LANDMARK_COLOR}
                          fillOpacity={selected ? 0.85 : 0.4}
                          stroke={selected ? '#ffffff' : LANDMARK_COLOR}
                          strokeWidth={selected ? boxStroke * 2 : boxStroke}
                          vectorEffect="non-scaling-stroke"
                          className="pointer-events-auto cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation()
                            onFindingClick?.(idx)
                          }}
                        />
                        <text
                          x={left ? f.x - dotR - boxStroke : f.x + dotR + boxStroke}
                          y={f.y + labelSize * 0.35}
                          fill="#ffffff"
                          fontSize={labelSize}
                          fontWeight={600}
                          stroke="#09090b"
                          strokeWidth={labelSize / 5}
                          paintOrder="stroke"
                          textAnchor={left ? 'end' : 'start'}
                        >
                          {f.landmark_id + 1}
                        </text>
                      </g>
                    )
                  }

                  // MeshSegNet — 3D segments have no 2D overlay position.
                  if (!isBoxFinding(f)) return null

                  const bb = f.bounding_box
                  const color = findingColor(f.condition)
                  // Label through the dictionary (i18n audit): the condition
                  // is already translated, the template itself is a key.
                  const label = t('imaging.finding_label', {
                    condition: conditionLabel(f.condition),
                    pct: Math.round((f.confidence ?? 0) * 100),
                  })
                  const labelY = bb.y > labelSize * 1.6 ? bb.y - labelSize * 0.4 : bb.y + bb.height + labelSize
                  return (
                    <g key={`${bb.x}-${bb.y}-${vi}`}>
                      <rect
                        x={bb.x}
                        y={bb.y}
                        width={bb.width}
                        height={bb.height}
                        fill={color}
                        fillOpacity={selected ? 0.28 : 0.12}
                        stroke={color}
                        strokeWidth={selected ? boxStroke * 2.4 : boxStroke}
                        vectorEffect="non-scaling-stroke"
                        rx={2}
                        className="pointer-events-auto cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation()
                          onFindingClick?.(idx)
                        }}
                      />
                      <text
                        x={bb.x}
                        y={labelY}
                        fill={color}
                        fontSize={labelSize}
                        fontWeight={600}
                        stroke="#09090b"
                        strokeWidth={labelSize / 5}
                        paintOrder="stroke"
                      >
                        {label}
                      </text>
                    </g>
                  )
                })}
              </svg>
            )}
          </div>
        </div>

        {/* Legend */}
        {findings.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {legend.map((item) => (
              <span key={item.key} className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
            ))}
            <span className="ml-auto">
              {t('imaging.findings_count', { count: visibleFindings.length })}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
