'use client'

import React, { useMemo } from 'react'
import { ToothViewModel, ToothSurfaceKey } from '../types/odontogram'
import { getToothGeometry, VolBlob } from '../geometry/tooth-paths'
import { ToothSurfaces } from './ToothSurfaces'
import { ConditionOverlay } from './ConditionOverlay'

interface ToothSVGProps {
  tooth: ToothViewModel
  onSurfaceClick?: (surface: ToothSurfaceKey, e: React.MouseEvent) => void
  interactive?: boolean
  className?: string
}

/** Recessed occlusal groove: soft dark line + faint light edge (subtle, not printed). */
function Engrave({ d, offset = 0.55 }: { d: string; offset?: number }) {
  return (
    <>
      <path d={d} fill="none" stroke="#6B5632" strokeOpacity={0.36} strokeWidth={0.9} strokeLinecap="round" />
      <path
        d={d}
        fill="none"
        stroke="#FFFDF3"
        strokeOpacity={0.18}
        strokeWidth={0.5}
        strokeLinecap="round"
        transform={`translate(${offset},${offset})`}
      />
    </>
  )
}

/** Faint longitudinal striation on root / crown surfaces. */
function SubtleLine({ d, offset = 0.5 }: { d: string; offset?: number }) {
  return (
    <>
      <path d={d} fill="none" stroke="#6B5632" strokeOpacity={0.18} strokeWidth={0.7} strokeLinecap="round" />
      <path
        d={d}
        fill="none"
        stroke="#FFFDF3"
        strokeOpacity={0.2}
        strokeWidth={0.45}
        strokeLinecap="round"
        transform={`translate(${offset},${offset})`}
      />
    </>
  )
}

function Blob({ b, n, shade }: { b: VolBlob; n: number; shade: boolean }) {
  const fill = b.radial ? `url(#${shade ? 'cuspShadeR' : 'cuspLightR'}-${n})` : b.fill
  return (
    <ellipse
      cx={b.cx}
      cy={b.cy}
      rx={b.rx}
      ry={b.ry}
      fill={fill}
      fillOpacity={b.radial ? b.opacity : b.opacity}
      filter={b.blur ? `url(#blur${b.blur === 'wide' ? 'W' : 'S'}-${n})` : undefined}
    />
  )
}

export function ToothSVG({
  tooth,
  onSurfaceClick,
  interactive = true,
  className = '',
}: ToothSVGProps) {
  const geometry = useMemo(
    () => getToothGeometry(tooth.group, tooth.position, tooth.side, tooth.number),
    [tooth.group, tooth.position, tooth.side, tooth.number]
  )

  const isUpper = tooth.position === 'upper'
  const missing = tooth.isMissing
  const n = tooth.number
  const engraveOffset = isUpper ? 0.55 : -0.55

  const hasTable = Boolean(geometry.occlusalTablePath)

  return (
    <svg
      viewBox="0 0 64 100"
      className={`w-full h-full overflow-visible ${className}`}
      aria-hidden="true"
    >
      <defs>
        {/* Warm porcelain enamel: thin (light) at the occlusal edge, thicker (deeper) at the cervical */}
        <linearGradient id={`enamel-${n}`} x1="0" y1="0" x2="0.12" y2="1">
          {isUpper ? (
            <>
              <stop offset="0" stopColor="#E1CDA0" />
              <stop offset="0.36" stopColor="#F0E6CB" />
              <stop offset="0.75" stopColor="#F9F4E6" />
              <stop offset="1" stopColor="#FDFBF4" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#FDFBF4" />
              <stop offset="0.27" stopColor="#F9F4E6" />
              <stop offset="0.66" stopColor="#F0E6CB" />
              <stop offset="1" stopColor="#E1CDA0" />
            </>
          )}
        </linearGradient>

        {/* Cementum root trunk: matte cream-tan cylindrical volume (desaturated, narrow highlight) */}
        <linearGradient id={`rootCyl-${n}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#AD8C48" />
          <stop offset="0.3" stopColor="#DECB94" />
          <stop offset="0.48" stopColor="#F1E2B8" />
          <stop offset="0.68" stopColor="#D9BC80" />
          <stop offset="1" stopColor="#93712F" />
        </linearGradient>

        {/* Raised cusp volume highlight (soft radial) */}
        <radialGradient id={`cuspLightR-${n}`}>
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="0.45" stopColor="#FFFBEA" stopOpacity="0.6" />
          <stop offset="1" stopColor="#FFFBEA" stopOpacity="0" />
        </radialGradient>

        {/* Cusp base / fossa shadow (soft radial) */}
        <radialGradient id={`cuspShadeR-${n}`}>
          <stop offset="0" stopColor="#7A6030" stopOpacity="0.6" />
          <stop offset="1" stopColor="#7A6030" stopOpacity="0" />
        </radialGradient>

        <filter id={`blurS-${n}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1" />
        </filter>
        <filter id={`blurW-${n}`} x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="2" />
        </filter>

        <clipPath id={`crownClip-${n}`}>
          <path d={geometry.crownOutline} />
        </clipPath>
      </defs>

      {/* ══ 1. ROOT SYSTEM: furcation depth, volumetric trunks, apex shadow ══ */}
      {!tooth.isImplant && (
        <g className="root-system">
          {geometry.furcationShadows.map((d, i) => (
            <path key={`fur-${i}`} d={d} fill="#4A340C" fillOpacity={0.5} filter={`url(#blurS-${n})`} />
          ))}
          {geometry.rootTrunks.map((d, i) => (
            <path
              key={`trunk-${i}`}
              d={d}
              fill={missing ? 'none' : `url(#rootCyl-${n})`}
              stroke={missing ? '#94A3B8' : '#7A5A22'}
              strokeOpacity={missing ? 0.8 : 0.45}
              strokeWidth={missing ? 1.1 : 0.8}
              strokeDasharray={missing ? '3 3' : undefined}
              strokeLinejoin="round"
            />
          ))}
          {!missing &&
            geometry.rootApexShadows.map((a, i) => (
              <ellipse
                key={`apex-${i}`}
                cx={a.cx}
                cy={a.cy}
                rx={a.rx}
                ry={a.ry}
                fill={a.fill}
                fillOpacity={a.opacity}
                filter={`url(#blurS-${n})`}
              />
            ))}
          {!missing &&
            geometry.rootGrooves.map((d, i) => <SubtleLine key={`rg-${i}`} d={d} offset={engraveOffset * 0.7} />)}
          {!tooth.isRootCanal &&
            !missing &&
            geometry.rootCanalPaths.map((d, i) => (
              <path
                key={`canal-${i}`}
                d={d}
                fill="none"
                stroke="#8B5E34"
                strokeOpacity={0.32}
                strokeWidth={0.9}
                strokeLinecap="round"
              />
            ))}
        </g>
      )}

      {/* ══ 2. ENAMEL CROWN BODY ══ */}
      <path
        d={geometry.crownOutline}
        fill={missing ? 'none' : `url(#enamel-${n})`}
        stroke={missing ? '#94A3B8' : '#B49B6B'}
        strokeOpacity={missing ? 0.8 : 0.55}
        strokeWidth={missing ? 1.1 : 1}
        strokeDasharray={missing ? '3 3' : undefined}
        strokeLinejoin="round"
      />

      {/* ══ 3. INTERIOR VOLUMETRIC SHADING (clipped to enamel silhouette) ══ */}
      {!missing && (
        <g clipPath={`url(#crownClip-${n})`}>
          {geometry.crownShades.map((b, i) => (
            <Blob key={`shade-${i}`} b={b} n={n} shade={false} />
          ))}

          {/* Translucent pulp chamber — faint, deep inside the enamel */}
          <path d={geometry.pulpOutline} fill="#7A4A3A" fillOpacity={0.14} />

          {hasTable && (
            <g>
              <path d={geometry.occlusalTablePath as string} fill="#CDBA8C" fillOpacity={0.42} />
              {geometry.tableTopShade && <Blob b={geometry.tableTopShade} n={n} shade={false} />}
              {geometry.occlusalShades.map((b, i) => (
                <Blob key={`oshade-${i}`} b={b} n={n} shade={false} />
              ))}
              {geometry.occlusalGrooves.map((d, i) => (
                <Engrave key={`og-${i}`} d={d} offset={engraveOffset} />
              ))}
              {geometry.occlusalRidges?.map((d, i) => (
                <path
                  key={`ridge-${i}`}
                  d={d}
                  fill="none"
                  stroke="#FFFBEA"
                  strokeOpacity={0.4}
                  strokeWidth={1}
                  strokeLinecap="round"
                />
              ))}
            </g>
          )}

          {geometry.crownLights.map((b, i) => (
            <Blob key={`light-${i}`} b={b} n={n} shade={false} />
          ))}
        </g>
      )}

      {/* ══ 4. INTERACTIVE 5-SURFACE ZONES (clipped to the enamel silhouette) ══ */}
      <g clipPath={`url(#crownClip-${n})`}>
        <ToothSurfaces
          tooth={tooth}
          geometry={geometry}
          onSurfaceClick={onSurfaceClick}
          interactive={interactive}
        />
      </g>

      {/* ══ 5. GUM MARGIN & CERVICAL LINE ══ */}
      {!missing && (
        <g className="cervical-margin" pointerEvents="none">
          {geometry.cervicalLinePath && (
            <path
              d={geometry.cervicalLinePath}
              fill="none"
              stroke="#B08D4F"
              strokeOpacity={0.35}
              strokeWidth={0.7}
            />
          )}
          <path
            d={geometry.gumLinePath}
            fill="none"
            stroke="#E89AA4"
            strokeOpacity={0.7}
            strokeWidth={1.1}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* ══ 6. DIAGNOSTIC CONDITION OVERLAYS ══ */}
      <ConditionOverlay tooth={tooth} geometry={geometry} />
    </svg>
  )
}
