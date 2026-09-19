'use client'

import React, { useMemo } from 'react'
import { ToothViewModel, ToothSurfaceKey } from '../types/odontogram'
import { getToothGeometry } from '../geometry/tooth-paths'
import { ToothSurfaces } from './ToothSurfaces'
import { ConditionOverlay } from './ConditionOverlay'

interface ToothSVGProps {
  tooth: ToothViewModel
  onSurfaceClick?: (surface: ToothSurfaceKey, e: React.MouseEvent) => void
  interactive?: boolean
  className?: string
}

export function ToothSVG({
  tooth,
  onSurfaceClick,
  interactive = true,
  className = '',
}: ToothSVGProps) {
  // Compute precision mathematical vector geometry
  const geometry = useMemo(() => {
    return getToothGeometry(tooth.group, tooth.position, tooth.side)
  }, [tooth.group, tooth.position, tooth.side])

  const isUpper = tooth.position === 'upper'
  const isMissing = tooth.isMissing

  return (
    <svg
      viewBox="0 0 60 100"
      className={`w-full h-full overflow-visible transition-transform duration-200 ${className}`}
      aria-hidden="true"
    >
      <defs>
        {/* Anatomical Enamel Gradient */}
        <linearGradient id={`enamel-grad-${tooth.number}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="50%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#f1f5f9" />
        </linearGradient>

        {/* Dentin / Root Gradient */}
        <linearGradient
          id={`root-grad-${tooth.number}`}
          x1="0%"
          y1={isUpper ? '0%' : '100%'}
          x2="0%"
          y2={isUpper ? '100%' : '0%'}
        >
          <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fef9c3" stopOpacity="0.6" />
        </linearGradient>
      </defs>

      {/* 1. ANATOMICAL ROOT LAYER */}
      {!tooth.isImplant && (
        <path
          d={geometry.rootOutline}
          fill={isMissing ? 'none' : `url(#root-grad-${tooth.number})`}
          stroke={isMissing ? '#94a3b8' : '#cbd5e1'}
          strokeWidth={isMissing ? 1.2 : 1.5}
          strokeDasharray={isMissing ? '3 3' : undefined}
          strokeLinejoin="round"
          className="transition-colors"
        />
      )}

      {/* 2. PULP CHAMBER BASE (Subtle internal vascular shadow) */}
      {!tooth.isRootCanal && !tooth.isImplant && !isMissing && (
        <path
          d={geometry.pulpOutline}
          fill="#fee2e2"
          fillOpacity={0.4}
          stroke="#fca5a5"
          strokeWidth={0.8}
        />
      )}

      {/* 3. ANATOMICAL CROWN BASE LAYER */}
      <path
        d={geometry.crownOutline}
        fill={isMissing ? 'none' : `url(#enamel-grad-${tooth.number})`}
        stroke={isMissing ? '#94a3b8' : '#64748b'}
        strokeWidth={isMissing ? 1.2 : 1.6}
        strokeDasharray={isMissing ? '3 3' : undefined}
        strokeLinejoin="round"
        className="transition-colors"
      />

      {/* 4. INTERACTIVE SURFACES (M, D, O, B, L) */}
      <ToothSurfaces
        tooth={tooth}
        geometry={geometry}
        onSurfaceClick={onSurfaceClick}
        interactive={interactive}
      />

      {/* 5. GUM LINE / CERVICAL MARGIN */}
      {!isMissing && (
        <path
          d={geometry.gumLinePath}
          fill="none"
          stroke="#f43f5e"
          strokeWidth={0.9}
          strokeOpacity={0.6}
        />
      )}

      {/* 6. CONDITION OVERLAYS (Implants, Crowns, RCT, Fractures, Lesions, etc.) */}
      <ConditionOverlay tooth={tooth} geometry={geometry} />
    </svg>
  )
}
