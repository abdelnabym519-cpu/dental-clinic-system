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
      className={`w-full h-full overflow-visible transition-transform duration-200 drop-shadow-2xs ${className}`}
      aria-hidden="true"
    >
      <defs>
        {/* Realistic Enamel 3D Linear Gradient */}
        <linearGradient
          id={`enamel-grad-${tooth.number}`}
          x1="0%"
          y1={isUpper ? '0%' : '100%'}
          x2="0%"
          y2={isUpper ? '100%' : '0%'}
        >
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="25%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#e2e8f0" />
        </linearGradient>

        {/* Dentin / Cementum Anatomical Root Gradient */}
        <linearGradient
          id={`root-grad-${tooth.number}`}
          x1="0%"
          y1={isUpper ? '0%' : '100%'}
          x2="0%"
          y2={isUpper ? '100%' : '0%'}
        >
          <stop offset="0%" stopColor="#fef08a" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#fde047" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#fef9c3" stopOpacity="0.75" />
        </linearGradient>

        {/* Pulp Chamber & Vascular Gradient */}
        <linearGradient
          id={`pulp-grad-${tooth.number}`}
          x1="0%"
          y1={isUpper ? '0%' : '100%'}
          x2="0%"
          y2={isUpper ? '100%' : '0%'}
        >
          <stop offset="0%" stopColor="#fb7185" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#fecdd3" stopOpacity="0.5" />
        </linearGradient>

        {/* Enamel Crown Shadow/Highlight Filter */}
        <filter id={`tooth-shadow-${tooth.number}`} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow
            dx="0.5"
            dy="1"
            stdDeviation="0.8"
            floodColor="#0f172a"
            floodOpacity="0.12"
          />
        </filter>
      </defs>

      {/* 1. ANATOMICAL ROOT LAYER */}
      {!tooth.isImplant && (
        <g className="root-anatomy-group">
          {/* Main Root Body */}
          <path
            d={geometry.rootOutline}
            fill={isMissing ? 'none' : `url(#root-grad-${tooth.number})`}
            stroke={isMissing ? '#94a3b8' : '#475569'}
            strokeWidth={isMissing ? 1.2 : 1.6}
            strokeDasharray={isMissing ? '3 3' : undefined}
            strokeLinejoin="round"
            className="transition-colors"
          />

          {/* Longitudinal Root Groove & Developmental Lines */}
          {geometry.rootDetails && !isMissing && (
            <g className="root-developmental-grooves opacity-75">
              {geometry.rootDetails.map((detail, i) => (
                <path
                  key={`root-detail-${i}`}
                  d={detail}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth={1.0}
                  strokeLinecap="round"
                />
              ))}
            </g>
          )}

          {/* Root Furcation Separation Line (Multi-rooted molars/premolars) */}
          {geometry.rootSeparationPath && !isMissing && (
            <path
              d={geometry.rootSeparationPath}
              fill="none"
              stroke="#334155"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeDasharray="2 2"
              opacity={0.85}
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
            stroke="#f87171"
            strokeWidth={0.9}
            strokeLinejoin="round"
          />
          {/* Natural Root Canal Pathways */}
          {geometry.rootCanalPaths.map((canal, i) => (
            <path
              key={`natural-canal-${i}`}
              d={canal}
              fill="none"
              stroke="#f87171"
              strokeWidth={0.9}
              strokeOpacity={0.65}
              strokeDasharray="2 2"
            />
          ))}
        </g>
      )}

      {/* 3. ANATOMICAL CROWN BASE LAYER */}
      <g className="crown-anatomy-group">
        {/* Enamel Crown Shell */}
        <path
          d={geometry.crownOutline}
          fill={isMissing ? 'none' : `url(#enamel-grad-${tooth.number})`}
          stroke={isMissing ? '#94a3b8' : '#1e293b'}
          strokeWidth={isMissing ? 1.2 : 1.9}
          strokeDasharray={isMissing ? '3 3' : undefined}
          strokeLinejoin="round"
          className="transition-colors"
        />

        {/* Anatomical Cusp Facets, Mamelons, Lobes & Marginal Ridges */}
        {geometry.crownDetails && !isMissing && (
          <g className="crown-anatomical-details opacity-80">
            {geometry.crownDetails.map((detail, i) => (
              <path
                key={`crown-detail-${i}`}
                d={detail}
                fill="none"
                stroke="#64748b"
                strokeWidth={1.1}
                strokeLinecap="round"
              />
            ))}
          </g>
        )}

        {/* Cusp / Incisal Specular Highlights (3D Enamel Sheen) */}
        {geometry.cuspHighlights && !isMissing && (
          <g className="cusp-highlights-group opacity-90">
            {geometry.cuspHighlights.map((highlight, i) => (
              <path
                key={`highlight-${i}`}
                d={highlight}
                fill="none"
                stroke="#ffffff"
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            ))}
          </g>
        )}

        {/* Anatomical Developmental Fissures & Grooves */}
        {geometry.fissurePaths && !isMissing && (
          <g className="fissure-grooves-group opacity-75">
            {geometry.fissurePaths.map((fissure, i) => (
              <path
                key={`fissure-${i}`}
                d={fissure}
                fill="none"
                stroke="#334155"
                strokeWidth={1.2}
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
              stroke="#94a3b8"
              strokeWidth={1.0}
              strokeOpacity={0.7}
            />
          )}
          <path
            d={geometry.gumLinePath}
            fill="none"
            stroke="#f43f5e"
            strokeWidth={1.4}
            strokeOpacity={0.85}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* 6. DIAGNOSTIC CONDITION OVERLAYS (Implants, Crowns, RCT, Fractures, Lesions) */}
      <ConditionOverlay tooth={tooth} geometry={geometry} />
    </svg>
  )
}
