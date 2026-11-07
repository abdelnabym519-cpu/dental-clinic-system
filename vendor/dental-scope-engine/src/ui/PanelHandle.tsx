import { useRef } from 'react';
import { useT } from '../i18n';
import { actions, useApp, type CollapsiblePanel } from '../state/store';

/** Which way each panel slides to tuck away: left panel → left, detail → right, dock → down. */
const DIR: Record<CollapsiblePanel, { axis: 'x' | 'y'; sign: 1 | -1 }> = {
  layers: { axis: 'x', sign: -1 },
  detail: { axis: 'x', sign: 1 },
  dock: { axis: 'y', sign: 1 },
};

/**
 * Small tab on a panel's inner edge. Click to hide/show the panel, or drag it:
 * toward the screen edge hides it, back toward the centre brings it in.
 */
export function PanelHandle({ panel }: { panel: CollapsiblePanel }) {
  const collapsed = useApp((s) => s.collapsed[panel]);
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const d = DIR[panel];
  const m = useT();

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    start.current = { x: e.clientX, y: e.clientY };
    dragged.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s0 = start.current;
    start.current = null;
    if (!s0) return;
    const delta = (d.axis === 'x' ? e.clientX - s0.x : e.clientY - s0.y) * d.sign;
    if (Math.abs(delta) > 24) {
      dragged.current = true;
      actions.setCollapsed(panel, delta > 0);
    }
  };
  const onClick = () => {
    // a drag already decided; a plain click toggles
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    actions.setCollapsed(panel, !collapsed);
  };

  const label = collapsed ? m.showPanel(m.panelName[panel]) : m.hidePanel(m.panelName[panel]);
  return (
    <button
      type="button"
      className={`ds-panel-handle ds-panel-handle--${panel}${collapsed ? ' is-collapsed' : ''}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={onClick}
      aria-label={label}
      aria-expanded={!collapsed}
      title={`${label} (${m.clickOrDrag})`}
    >
      <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 6-6 6 6 6" />
      </svg>
    </button>
  );
}
