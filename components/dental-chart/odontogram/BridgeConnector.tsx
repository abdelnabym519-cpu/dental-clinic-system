'use client'

import React from 'react'
import { ToothViewModel } from '../types/odontogram'

interface BridgeConnectorProps {
  viewModels: Record<number, ToothViewModel>
  position: 'upper' | 'lower'
}

export function BridgeConnector({ viewModels, position }: BridgeConnectorProps) {
  // Find teeth in this jaw with BRIDGE condition
  const bridgeTeeth = Object.values(viewModels).filter((t) => t.position === position && t.isBridge)

  if (bridgeTeeth.length === 0) return null

  return (
    <div className="bridge-spans-container pointer-events-none absolute inset-0 z-20">
      {/* Visual badge indicator for active bridge spans */}
      <div
        className={`
          absolute left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-semibold
          bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 shadow-xs
          ${position === 'upper' ? 'top-1' : 'bottom-1'}
        `}
      >
        Fixed Bridge Span: {bridgeTeeth.map((t) => t.number).join(', ')}
      </div>
    </div>
  )
}
