'use client'

/**
 * DenToRa — Interactive Dental Chart: REAL 3D view (Stage E/F/N).
 *
 * React Three Fiber (three 0.186 / R3F 9). Original procedural tooth
 * geometry — no external or proprietary assets. Performance contract
 * (Stage N): `frameloop="demand"` (zero idle rendering), shared geometry
 * and material instances (per-tooth meshes are required for per-tooth
 * raycast picking — instancing would couple pointer hits), no per-frame
 * state updates, explicit disposal of shared GPU resources on unmount.
 * Per-tooth interactions: orbit / zoom / pan, hover highlight, click
 * selection — selection lives in the shared dental-chart store (Stage G),
 * so 2D and 3D are always synchronized.
 */

import * as THREE from 'three'
import { Canvas, invalidate, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useEffect, useMemo, useRef } from 'react'
import { FDI_TEETH, groupOf } from '@/lib/dental-chart/fdi'
import { TOOTH_COLORS, type ToothTreatmentStatus } from '@/lib/dental-chart/clinical-status'
import { useDentalChartStore } from '@/lib/dental-chart/chart-state'
import { toothTransform, toothDimensions, ARCH_Y, type ToothDimensions } from './tooth-3d'

// ─── shared GPU resources (created once, disposed on unmount) ───────────────

interface SharedResources {
  crownGeoms: Record<string, THREE.BufferGeometry>
  cuspGeom: THREE.SphereGeometry
  rootGeom: THREE.CylinderGeometry
  socketGeom: THREE.CylinderGeometry
  statusMaterials: Record<ToothTreatmentStatus, THREE.MeshStandardMaterial>
  selectedMaterial: THREE.MeshStandardMaterial
  hoverMaterial: THREE.MeshStandardMaterial
  dispose: () => void
}

let shared: SharedResources | null = null

function getShared(): SharedResources {
  if (shared) return shared

  const crownGeoms: Record<string, THREE.BufferGeometry> = {}
  for (const group of ['incisor', 'canine', 'premolar', 'molar'] as const) {
    const d = dimFor(group)
    const geom = new THREE.CylinderGeometry(d.crownTop, d.crownBottom, d.crownHeight, d.segments)
    geom.scale(1, 1, d.flattenZ) // buccal flattening (original stylization)
    crownGeoms[group] = geom
  }

  const cuspGeom = new THREE.SphereGeometry(0.07, 12, 8)
  const rootGeom = new THREE.CylinderGeometry(0.035, 0.11, 1, 6) // unit height, scaled per tooth
  const socketGeom = new THREE.CylinderGeometry(0.13, 0.05, 0.16, 8)

  const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...extra })

  const statusMaterials = {
    healthy: std(TOOTH_COLORS.healthy),
    affected: std(TOOTH_COLORS.affected),
    planned: std(TOOTH_COLORS.planned),
    in_progress: std(TOOTH_COLORS.in_progress),
    completed: std(TOOTH_COLORS.completed),
    missing: std(TOOTH_COLORS.missing, { transparent: true, opacity: 0.35 }),
  }
  const selectedMaterial = std('#fde68a', {
    emissive: new THREE.Color('#f59e0b'),
    emissiveIntensity: 0.85,
  })
  const hoverMaterial = std('#f8fafc', {
    emissive: new THREE.Color('#94a3b8'),
    emissiveIntensity: 0.35,
  })

  shared = {
    crownGeoms,
    cuspGeom,
    rootGeom,
    socketGeom,
    statusMaterials,
    selectedMaterial,
    hoverMaterial,
    dispose: () => {
      Object.values(crownGeoms).forEach((g) => g.dispose())
      cuspGeom.dispose()
      rootGeom.dispose()
      socketGeom.dispose()
      Object.values(statusMaterials).forEach((m) => m.dispose())
      selectedMaterial.dispose()
      hoverMaterial.dispose()
      shared = null
    },
  }
  return shared
}

function dimFor(group: string): ToothDimensions {
  switch (group) {
    case 'incisor':
      return { crownTop: 0.13, crownBottom: 0.17, crownHeight: 0.34, rootHeight: 0.4, segments: 4, flattenZ: 0.62, cusps: 0 }
    case 'canine':
      return { crownTop: 0.07, crownBottom: 0.17, crownHeight: 0.38, rootHeight: 0.46, segments: 4, flattenZ: 0.75, cusps: 0 }
    case 'premolar':
      return { crownTop: 0.17, crownBottom: 0.15, crownHeight: 0.3, rootHeight: 0.4, segments: 8, flattenZ: 0.85, cusps: 2 }
    default:
      return { crownTop: 0.22, crownBottom: 0.17, crownHeight: 0.3, rootHeight: 0.38, segments: 8, flattenZ: 0.95, cusps: 4 }
  }
}

// ─── per-tooth component ────────────────────────────────────────────────────

function ToothMesh({ n, status }: { n: number; status: ToothTreatmentStatus }) {
  const { selectedToothNumber, hoveredTooth, toggleSelectedTooth, setHoveredTooth } =
    useDentalChartStore()
  const res = getShared()
  const d = toothDimensions(n)
  const { position, rotationY, crownDown } = toothTransform(n)
  const groupRef = useRef<THREE.Group>(null)

  const isSelected = selectedToothNumber === n
  const isHovered = hoveredTooth === n && !isSelected

  const material = isSelected
    ? res.selectedMaterial
    : isHovered
      ? res.hoverMaterial
      : res.statusMaterials[status]

  // Crown points toward the occlusal plane; root extends the opposite way.
  const crownY = crownDown ? -d.crownHeight / 2 : d.crownHeight / 2
  const rootY = crownDown ? d.rootHeight / 2 : -d.rootHeight / 2

  const cusps = useMemo(() => {
    if (!d.cusps) return []
    const r = d.crownTop * 0.45
    const offs = d.cusps === 2 ? [[-r, 0], [r, 0]] : [[-r, -r], [r, -r], [-r, r], [r, r]]
    return offs.map(([cx, cz]) => [cx, d.crownHeight / 2 * 0.95, cz] as [number, number, number])
  }, [d.crownHeight, d.crownTop, d.cusps])

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[crownDown ? Math.PI : 0, rotationY, 0]}
      scale={isSelected ? 1.08 : isHovered ? 1.05 : 1}
      onClick={(e) => {
        e.stopPropagation()
        toggleSelectedTooth(n)
        invalidate()
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHoveredTooth(n)
        document.body.style.cursor = 'pointer'
        invalidate()
      }}
      onPointerOut={() => {
        setHoveredTooth(null)
        document.body.style.cursor = 'auto'
        invalidate()
      }}
    >
      {status !== 'missing' ? (
        <>
          {/* crown */}
          <mesh geometry={res.crownGeoms[groupKey(n)]} material={material} position={[0, crownY, 0]} />
          {/* cusps */}
          {cusps.map((c, i) => (
            <mesh key={i} geometry={res.cuspGeom} material={material} position={c} />
          ))}
          {/* root */}
          <mesh
            geometry={res.rootGeom}
            material={res.statusMaterials.missing}
            position={[0, rootY, 0]}
            scale={[1, d.rootHeight, 1]}
          />
        </>
      ) : (
        // missing tooth: only the healing socket remains
        <mesh geometry={res.socketGeom} material={res.statusMaterials.missing} />
      )}
    </group>
  )
}

function groupKey(n: number): string {
  return groupOf(n)
}

// ─── camera rig (preset views + reset) ──────────────────────────────────────

export type CameraPreset = 'default' | 'front' | 'top' | 'side'

const PRESETS: Record<CameraPreset, [number, number, number]> = {
  default: [3.4, 2.4, 5.4],
  front: [0, 0.15, 6.6],
  top: [0, 7, 0.01],
  side: [6.6, 0.6, 0],
}

function CameraRig({
  preset,
  controlsRef,
}: {
  preset: CameraPreset
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}) {
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const [x, y, z] = PRESETS[preset]
    camera.position.set(x, y, z)
    controlsRef.current?.target.set(0, 0, 0)
    controlsRef.current?.update()
    invalidate()
  }, [preset, camera, controlsRef])
  return null
}

// ─── scene ──────────────────────────────────────────────────────────────────

export default function DentalChart3D({
  statusByTooth,
  cameraPreset = 'default',
}: {
  statusByTooth: Record<number, ToothTreatmentStatus>
  cameraPreset?: CameraPreset
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const setSelectedTooth = useDentalChartStore((s) => s.setSelectedTooth)
  const setHoveredTooth = useDentalChartStore((s) => s.setHoveredTooth)

  // Dispose shared GPU resources when the 3D view unmounts (Stage N rule 5).
  useEffect(() => () => getShared() && shared?.dispose(), [])

  const teeth = useMemo(() => FDI_TEETH.map((n) => ({ n, status: statusByTooth[n] ?? 'healthy' })), [statusByTooth])

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: PRESETS.default, fov: 42 }}
      gl={{ antialias: true }}
      onPointerMissed={() => {
        setSelectedTooth(null)
        invalidate()
      }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color('#0f172a')
        invalidate()
      }}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 6, 5]} intensity={1.1} />
      <directionalLight position={[-5, 3, -4]} intensity={0.4} />

      {teeth.map(({ n, status }) => (
        <ToothMesh key={n} n={n} status={status} />
      ))}

      {/* occlusal plane guide (subtle) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, ARCH_Y]}>
        <ringGeometry args={[2.4, 3.6, 48]} />
        <meshBasicMaterial color="#1e293b" side={THREE.DoubleSide} />
      </mesh>

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping={false}
        minDistance={2.5}
        maxDistance={12}
        onChange={(() => invalidate()) as never}
      />
      <CameraRig preset={cameraPreset} controlsRef={controlsRef} />
    </Canvas>
  )
}
