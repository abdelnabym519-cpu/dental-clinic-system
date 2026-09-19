'use client'

import React from 'react'
import { ToothViewModel } from '../types/odontogram'
import { ToothGeometryPaths } from '../geometry/tooth-paths'

interface ConditionOverlayProps {
  tooth: ToothViewModel
  geometry: ToothGeometryPaths
}

export function ConditionOverlay({ tooth, geometry }: ConditionOverlayProps) {
  const { isUpper } = {
    isUpper: tooth.position === 'upper',
  }

  const apices =
    geometry.apices && geometry.apices.length > 0 ? geometry.apices : [geometry.apexCenter]

  return (
    <g className="condition-overlays pointer-events-none select-none">
      {/* 1. IMPLANT FIXTURE */}
      {tooth.isImplant && (
        <g className="implant-layer animate-in fade-in duration-300">
          {/* Titanium fixture body */}
          <path
            d={geometry.implantOutline}
            fill="#06b6d4"
            fillOpacity={0.85}
            stroke="#0891b2"
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          {/* Thread grooves */}
          {geometry.implantThreads.map((thread, i) => (
            <path
              key={`thread-${i}`}
              d={thread}
              stroke="#e0f2fe"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          ))}
          {/* Abutment hex interface */}
          <circle
            cx={geometry.apexCenter.x}
            cy={isUpper ? 46 : 54}
            r={3.5}
            fill="#0e7490"
            stroke="#cffafe"
            strokeWidth={1}
          />
        </g>
      )}

      {/* 2. PROSTHETIC CROWN */}
      {tooth.isCrown && (
        <g className="crown-layer animate-in fade-in duration-300">
          <path
            d={geometry.crownCapOutline}
            fill="#f59e0b"
            fillOpacity={0.85}
            stroke="#b45309"
            strokeWidth={2}
          />
          {/* Crown margin highlight */}
          <path
            d={isUpper ? 'M 14,52 Q 30,55 46,52' : 'M 14,48 Q 30,45 46,48'}
            stroke="#fef3c7"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* 3. ROOT CANAL OBTURATION (RCT) */}
      {tooth.isRootCanal && !tooth.isImplant && (
        <g className="rct-layer animate-in fade-in duration-300">
          {/* Obturated root canals */}
          {geometry.rootCanalPaths.map((canal, i) => (
            <path
              key={`canal-${i}`}
              d={canal}
              fill="none"
              stroke="#ec4899"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="drop-shadow-sm"
            />
          ))}
          {/* Pulp chamber seal */}
          <path
            d={geometry.pulpOutline}
            fill="#f472b6"
            fillOpacity={0.85}
            stroke="#db2777"
            strokeWidth={1.2}
          />
        </g>
      )}

      {/* 4. FRACTURE CRACK LINE */}
      {tooth.isFractured && (
        <path
          d={geometry.fractureCrackPath}
          fill="none"
          stroke="#be123c"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="miter"
          strokeDasharray="1 1"
          className="drop-shadow-sm animate-pulse"
        />
      )}

      {/* 5. PERIAPICAL ABSCESS LESION (Multi-Apices Supported) */}
      {tooth.hasAbscess && !tooth.isMissing && (
        <g className="abscess-layer">
          {apices.map((apex, i) => (
            <g key={`abscess-apex-${i}`}>
              <circle
                cx={apex.x}
                cy={apex.y}
                r={4.5}
                fill="#eab308"
                fillOpacity={0.85}
                stroke="#ca8a04"
                strokeWidth={1.2}
              />
              <circle cx={apex.x} cy={apex.y} r={2} fill="#fef08a" />
            </g>
          ))}
        </g>
      )}

      {/* 6. PERIODONTAL BONE RECESSION / POCKET */}
      {tooth.hasPeriodontal && (
        <g className="periodontal-layer">
          <path
            d={geometry.gumLinePath}
            fill="none"
            stroke="#14b8a6"
            strokeWidth={2.5}
            strokeDasharray="2 2"
          />
          <path
            d={
              isUpper
                ? `M 10,${geometry.apexCenter.y + 16} L 50,${geometry.apexCenter.y + 16}`
                : `M 10,${geometry.apexCenter.y - 16} L 50,${geometry.apexCenter.y - 16}`
            }
            fill="none"
            stroke="#0d9488"
            strokeWidth={1.5}
          />
        </g>
      )}

      {/* 7. TOOTH MOBILITY VECTORS */}
      {tooth.hasMobility && (
        <g className="mobility-layer">
          <path
            d="M 12,50 L 6,50 M 8,47 L 5,50 L 8,53"
            stroke="#6366f1"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
          <path
            d="M 48,50 L 54,50 M 52,47 L 55,50 L 52,53"
            stroke="#6366f1"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* 8. SENSITIVITY INDICATOR */}
      {tooth.hasSensitivity && (
        <g className="sensitivity-layer">
          <path
            d="M 24,50 L 28,45 L 32,55 L 36,50"
            fill="none"
            stroke="#0284c7"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* 9. MISSING / EXTRACTED GHOSTING OVERLAY */}
      {tooth.isMissing && (
        <g className="missing-layer">
          {/* Diagonal Strike-through Cross */}
          <line
            x1={8}
            y1={8}
            x2={52}
            y2={92}
            stroke="#94a3b8"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <line
            x1={52}
            y1={8}
            x2={8}
            y2={92}
            stroke="#94a3b8"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </g>
      )}
    </g>
  )
}
