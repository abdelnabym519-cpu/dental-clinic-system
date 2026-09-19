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
  // Compute precision mathematical anatomical vector geometry
  const geometry = useMemo(() => {
    return getToothGeometry(tooth.group, tooth.position, tooth.side, tooth.number)
  }, [tooth.group, tooth.position, tooth.side, tooth.number])

  const isUpper = tooth.position === 'upper'
  const isMissing = tooth.isMissing

  return (
    <svg
      viewBox="0 0 60 100"
      className={`w-full h-full overflow-visible transition-transform duration-200 ${className}`}
      aria-hidden="true"
    >
      <defs>
        {/* High Realism Enamel Gradient */}
        <linearGradient
          id={`enamel-grad-${tooth.number}`}
          x1="0%"
          y1={isUpper ? '0%' : '100%'}
          x2="0%"
          y2={isUpper ? '100%' : '0%'}
        >
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="30%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#e2e8f0" />
        </linearGradient>

        {/* Dentin / Cementum Root Gradient */}
        <linearGradient
          id={`root-grad-${tooth.number}`}
          x1="0%"
          y1={isUpper ? '0%' : '100%'}
          x2="0%"
          y2={isUpper ? '100%' : '0%'}
        >
          <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#fde68a" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#fef9c3" stopOpacity="0.6" />
        </linearGradient>

        {/* Pulp Vascular Gradient */}
        <linearGradient
          id={`pulp-grad-${tooth.number}`}
          x1="0%"
          y1={isUpper ? '0%' : '100%'}
          x2="0%"
          y2={isUpper ? '100%' : '0%'}
        >
          <stop offset="0%" stopColor="#fda4af" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#fee2e2" stopOpacity="0.4" />
        </linearGradient>
      </defs>

      {/* 1. ANATOMICAL ROOT LAYER */}
      {!tooth.isImplant && (
        <g className="root-anatomy-group">
          <path
            d={geometry.rootOutline}
            fill={isMissing ? 'none' : `url(#root-grad-${tooth.number})`}
            stroke={isMissing ? '#94a3b8' : '#cbd5e1'}
            strokeWidth={isMissing ? 1.2 : 1.5}
            strokeDasharray={isMissing ? '3 3' : undefined}
            strokeLinejoin="round"
            className="transition-colors"
          />

          {/* Root Furcation Separation Line / Shadow (Multi-rooted molars/premolars) */}
          {geometry.rootSeparationPath && !isMissing && (
            <path
              d={geometry.rootSeparationPath}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeDasharray="1 1"
              opacity={0.7}
            />
          )}
        </g>
      )}

      {/* 2. PULP CHAMBER & ROOT CANAL VASCULAR TRACE */}
      {!tooth.isRootCanal && !tooth.isImplant && !isMissing && (
        <g className="pulp-anatomy-group">
          {/* Coronal Pulp Chamber */}
          <path
            d={geometry.pulpOutline}
            fill={`url(#pulp-grad-${tooth.number})`}
            stroke="#fca5a5"
            strokeWidth={0.75}
            strokeLinejoin="round"
          />
          {/* Subtle Root Canal Pathways */}
          {geometry.rootCanalPaths.map((canal, i) => (
            <path
              key={`natural-canal-${i}`}
              d={canal}
              fill="none"
              stroke="#fca5a5"
              strokeWidth={0.75}
              strokeOpacity={0.5}
              strokeDasharray="2 2"
            />
          ))}
        </g>
      )}

      {/* 3. ANATOMICAL CROWN BASE LAYER */}
      <g className="crown-anatomy-group">
        <path
          d={geometry.crownOutline}
          fill={isMissing ? 'none' : `url(#enamel-grad-${tooth.number})`}
          stroke={isMissing ? '#94a3b8' : '#64748b'}
          strokeWidth={isMissing ? 1.2 : 1.6}
          strokeDasharray={isMissing ? '3 3' : undefined}
          strokeLinejoin="round"
          className="transition-colors"
        />

        {/* Cusp / Ridge Highlights (Subtle Enamel Reflections) */}
        {geometry.cuspHighlights && !isMissing && (
          <g className="cusp-highlights-group opacity-60">
            {geometry.cuspHighlights.map((highlight, i) => (
              <path
                key={`highlight-${i}`}
                d={highlight}
                fill="none"
                stroke="#ffffff"
                strokeWidth={1.2}
                strokeLinecap="round"
              />
            ))}
          </g>
        )}

        {/* Anatomical Developmental Fissures & Grooves */}
        {geometry.fissurePaths && !isMissing && (
          <g className="fissure-grooves-group opacity-40">
            {geometry.fissurePaths.map((fissure, i) => (
              <path
                key={`fissure-${i}`}
                d={fissure}
                fill="none"
                stroke="#475569"
                strokeWidth={0.9}
                strokeLinecap="round"
              />
            ))}
          </g>
        )}
      </g>

      {/* 4. INTERACTIVE 5-SURFACE HITBOXES & RESTORATIVE FILLS */}
      <ToothSurfaces
        tooth={tooth}
        geometry={geometry}
        onSurfaceClick={onSurfaceClick}
        interactive={interactive}
      />

      {/* 5. GUM LINE / CERVICAL MARGIN (CEJ) */}
      {!isMissing && (
        <g className="cervical-margin-group">
          {geometry.cervicalLinePath && (
            <path
              d={geometry.cervicalLinePath}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth={0.75}
              strokeOpacity={0.6}
            />
          )}
          <path
            d={geometry.gumLinePath}
            fill="none"
            stroke="#f43f5e"
            strokeWidth={1.1}
            strokeOpacity={0.65}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* 6. DIAGNOSTIC CONDITION OVERLAYS (Implants, Crowns, RCT, Fractures, Lesions) */}
      <ConditionOverlay tooth={tooth} geometry={geometry} />
    </svg>
  )
}
