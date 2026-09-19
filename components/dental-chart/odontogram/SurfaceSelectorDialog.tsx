'use client'

import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ToothViewModel,
  DentalCondition,
  SeverityLevel,
  ToothSurfaceKey,
} from '../types/odontogram'
import { DENTAL_CONDITION_CONFIG } from '../adapters/dental-chart-adapter'
import { ToothHistoryTimeline } from './ToothHistoryTimeline'
import { Loader2, Check } from 'lucide-react'

interface SurfaceSelectorDialogProps {
  tooth: ToothViewModel | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (payload: {
    toothNumber: number
    condition: DentalCondition
    severity: SeverityLevel
    mesial: boolean
    distal: boolean
    occlusal: boolean
    buccal: boolean
    lingual: boolean
    notes?: string
  }) => Promise<void>
  isSaving?: boolean
}

const SURFACES_CONFIG: {
  key: ToothSurfaceKey
  label: string
  short: string
  desc: string
}[] = [
  { key: 'mesial', label: 'Mesial (M)', short: 'M', desc: 'Facing toward midline' },
  { key: 'occlusal', label: 'Occlusal/Incisal (O)', short: 'O', desc: 'Biting/chewing surface' },
  { key: 'distal', label: 'Distal (D)', short: 'D', desc: 'Facing away from midline' },
  { key: 'buccal', label: 'Buccal/Vestibular (B)', short: 'B', desc: 'Facing cheek or lip' },
  { key: 'lingual', label: 'Lingual/Palatal (L)', short: 'L', desc: 'Facing tongue or palate' },
]

export function SurfaceSelectorDialog({
  tooth,
  open,
  onOpenChange,
  onSave,
  isSaving = false,
}: SurfaceSelectorDialogProps) {
  const [condition, setCondition] = useState<DentalCondition>('CARIES')
  const [severity, setSeverity] = useState<SeverityLevel>('MILD')
  const [notes, setNotes] = useState('')
  const [surfaces, setSurfaces] = useState({
    mesial: false,
    distal: false,
    occlusal: false,
    buccal: false,
    lingual: false,
  })

  // Synchronize initial form values whenever selected tooth changes
  useEffect(() => {
    if (tooth) {
      if (tooth.activeEntry) {
        setCondition((tooth.activeEntry.condition as DentalCondition) || 'CARIES')
        setSeverity((tooth.activeEntry.severity as SeverityLevel) || 'MILD')
        setNotes(tooth.activeEntry.notes || '')
        setSurfaces({
          mesial: !!tooth.activeEntry.mesial,
          distal: !!tooth.activeEntry.distal,
          occlusal: !!tooth.activeEntry.occlusal,
          buccal: !!tooth.activeEntry.buccal,
          lingual: !!tooth.activeEntry.lingual,
        })
      } else {
        setCondition(tooth.condition === 'HEALTHY' ? 'CARIES' : tooth.condition)
        setSeverity('MILD')
        setNotes('')
        setSurfaces({
          mesial: tooth.surfaces.mesial,
          distal: tooth.surfaces.distal,
          occlusal: tooth.surfaces.occlusal,
          buccal: tooth.surfaces.buccal,
          lingual: tooth.surfaces.lingual,
        })
      }
    }
  }, [tooth])

  if (!tooth) return null

  const handleToggleSurface = (key: ToothSurfaceKey) => {
    setSurfaces((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const handleSelectAllSurfaces = () => {
    setSurfaces({
      mesial: true,
      distal: true,
      occlusal: true,
      buccal: true,
      lingual: true,
    })
  }

  const handleClearSurfaces = () => {
    setSurfaces({
      mesial: false,
      distal: false,
      occlusal: false,
      buccal: false,
      lingual: false,
    })
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave({
      toothNumber: tooth.number,
      condition,
      severity,
      ...surfaces,
      notes: notes.trim() || undefined,
    })
  }

  const currentConditionConfig = DENTAL_CONDITION_CONFIG[condition]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl">
        <form onSubmit={handleFormSubmit}>
          <DialogHeader className="pb-3 border-b border-border/60">
            <div className="flex items-center justify-between gap-3">
              <div>
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  <span>Tooth #{tooth.number}</span>
                  <Badge variant="outline" className="text-xs font-medium">
                    {tooth.name}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs mt-1">
                  Quadrant {tooth.quadrant} •{' '}
                  {tooth.position === 'upper' ? 'Maxillary' : 'Mandibular'} •{' '}
                  {tooth.side === 'right' ? 'Right' : 'Left'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* 1. Condition Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Clinical Condition</Label>
              <Select
                value={condition}
                onValueChange={(val) => setCondition(val as DentalCondition)}
              >
                <SelectTrigger className="w-full h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {Object.entries(DENTAL_CONDITION_CONFIG).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentConditionConfig && (
                <p className="text-[11px] text-muted-foreground">
                  {currentConditionConfig.description}
                </p>
              )}
            </div>

            {/* 2. Severity Level */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Severity</Label>
              <Select value={severity} onValueChange={(val) => setSeverity(val as SeverityLevel)}>
                <SelectTrigger className="w-full h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MILD">Mild</SelectItem>
                  <SelectItem value="MODERATE">Moderate</SelectItem>
                  <SelectItem value="SEVERE">Severe</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 3. Interactive Surface Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Surfaces Affected</Label>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={handleSelectAllSurfaces}
                    className="text-primary hover:underline"
                  >
                    All
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={handleClearSurfaces}
                    className="text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SURFACES_CONFIG.map((surf) => {
                  const isChecked = surfaces[surf.key]
                  return (
                    <label
                      key={surf.key}
                      htmlFor={`checkbox-${surf.key}`}
                      className={`
                        flex items-center justify-between p-2 rounded-lg border text-left text-xs
                        transition-all duration-150 cursor-pointer select-none
                        ${
                          isChecked
                            ? 'bg-primary/10 border-primary text-foreground font-semibold shadow-2xs'
                            : 'bg-muted/30 border-border hover:bg-muted/60 text-muted-foreground'
                        }
                      `}
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={surf.key}
                          checked={isChecked}
                          onCheckedChange={() => handleToggleSurface(surf.key)}
                        />
                        <span>
                          <strong className="font-bold">{surf.short}</strong> -{' '}
                          {surf.label.split(' ')[0]}
                        </span>
                      </div>
                      {isChecked && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                    </label>
                  )
                })}
              </div>
            </div>

            {/* 4. Clinical Observations & Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Clinical Notes & Observations</Label>
              <Textarea
                rows={2}
                placeholder="Enter diagnostic findings, planned restoration material, or symptoms..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-xs resize-none"
              />
            </div>

            {/* 5. Historical Record Timeline */}
            <div className="space-y-1.5 pt-2 border-t border-border/60">
              <Label className="text-xs font-semibold">History</Label>
              <ToothHistoryTimeline entries={tooth.history} />
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border/60">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving} className="gap-1.5">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
