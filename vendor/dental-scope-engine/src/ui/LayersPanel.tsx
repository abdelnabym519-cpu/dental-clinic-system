import { SinusControls } from './SinusControls';
import { VesselControls } from './VesselControls';
import { useMemo } from 'react';
import { CATEGORIES, PRESETS, type CategoryState } from '../anatomy/categories';
import type { CategoryId } from '../anatomy/types';
import { useT, useLang } from '../i18n';
import { FEEDBACK_TEXT } from '../i18n/feedback';
import { actions, useApp } from '../state/store';
import { useServices } from './context';
import { IconCheck, IconGhost, IconLayers, IconReset, IconTree } from './icons';
import { PanelHandle } from './PanelHandle';
import { StructureTree } from './StructureTree';
import { NerveControls } from './NerveControls';
import { DevelopmentPanel } from './DevelopmentControls';
import { DEVELOPMENT_TEXT } from '../i18n/development';
import { interfaceText } from '../i18n/interface';

export function LayersPanel() {
  const panel = useApp((s) => s.panel);
  const mobileOpen = useApp((s) => s.mobileSheet === 'layers');
  const collapsed = useApp((s) => s.collapsed.layers);
  const development = useApp((s) => s.developmentStage !== null);
  const lang = useLang();
  const m = useT();
  return (
    <aside className={`ds-panel ds-layers${mobileOpen ? ' is-mobile-open' : ''}${collapsed ? ' is-collapsed' : ''}`} aria-label={m.layersAria}>
      <PanelHandle panel="layers" />
      <div className="ds-tabs" role="tablist" aria-label={m.panelTabs}>
        <button type="button" role="tab" aria-selected={development || panel === 'layers'} className={development || panel === 'layers' ? 'is-active' : ''} onClick={() => actions.setPanel('layers')}>
          <IconLayers size={14} /> {development ? DEVELOPMENT_TEXT[lang].title : m.layers}
        </button>
        {!development && <button type="button" role="tab" aria-selected={panel === 'tree'} className={panel === 'tree' ? 'is-active' : ''} onClick={() => actions.setPanel('tree')}>
          <IconTree size={14} /> {m.structures}
        </button>}
      </div>
      {development ? <DevelopmentPanel /> : panel === 'layers' ? <Categories /> : <StructureTree />}
    </aside>
  );
}

function Categories() {
  const lang = useLang();
  const { registry, engine } = useServices();
  const studyView = useApp(s => s.studyView);
  const cats = useApp((s) => s.categories);
  const hiddenCount = useApp((s) => Object.keys(s.hidden).length + Object.keys(s.ghosted).length);
  const isolate = useApp((s) => s.isolateId);
  const counts = useMemo(() => registry.countByCategory(), [registry]);
  const m = useT();
  const presetActive = PRESETS.find((p) => CATEGORIES.every((c) => (p.state[c.id] ?? 'off') === cats[c.id]))?.id;
  const groups = useMemo(() => {
    const m = new Map<string, typeof CATEGORIES>();
    for (const c of CATEGORIES) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, []);
  const visibilityNote = [hiddenCount ? m.adjusted(hiddenCount) : '', isolate ? m.isolated : ''].filter(Boolean).join(' · ');

  return (
    <>
      <div className="ds-layer-scroll">
        <div className="ds-segmented ds-segmented--fill" role="radiogroup" aria-label={m.layerPresets}>
          {PRESETS.map((p) => (
            <button key={p.id} data-tour={`preset-${p.id}`} type="button" role="radio" aria-checked={presetActive === p.id} className={presetActive === p.id ? 'is-active' : ''} onClick={() => p.id === 'vessels' || p.id === 'sinuses' || p.id === 'nerves' ? void engine.showStudyView(p.id) : actions.applyStudyPreset(p.id)}>
              {p.id === 'nerve-muscles' ? FEEDBACK_TEXT[lang].nervesMuscles : m.preset[p.id] ?? p.label}
            </button>
          ))}
        </div>
        <VesselControls />
        <SinusControls />
        {cats.nerves !== 'off' && studyView !== 'vessels' && <NerveControls />}
        <div className="ds-layer-list">
          {groups.map(([group, list]) => (
            <div key={group} className="ds-layer-group" role="list" aria-label={m.group[group] ?? group}>
              <div className="ds-layer-group-title">{m.group[group] ?? group}</div>
              {list.map((c) => (
                <CategoryRow key={c.id} id={c.id} label={m.category[c.id] ?? c.label} color={c.color} planned={!!c.planned} count={c.id === 'permanent-teeth' ? registry.teeth().length : counts[c.id] ?? 0} state={cats[c.id]} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="ds-panel-footer">
        <span>{visibilityNote}</span>
        <button type="button" className="ds-link-btn" onClick={() => actions.resetVisibility()}>
          <IconReset size={13} /> {m.reset}
        </button>
      </div>
    </>
  );
}

function CategoryRow({ id, label, color, count, state, planned }: { id: CategoryId; label: string; color: string; count: number; state: CategoryState; planned: boolean }) {
  const m = useT();
  const text = interfaceText(useLang());
  if (planned) {
    return (
      <div className="ds-layer-row is-planned" role="listitem" title={m.notModeled}>
        <span className="ds-dot-toggle is-static" style={{ '--dot': color } as React.CSSProperties} aria-hidden="true">
          <span className="ds-dot-toggle-dot" />
        </span>
        <span className="ds-layer-name">{label}</span>
        <span className="ds-soon">{m.planned}</span>
      </div>
    );
  }
  const on = state !== 'off';
  if (id === 'primary-teeth') return (
    <div className="ds-layer-row" role="listitem">
      <button type="button" className="ds-primary-dentition ds-layer-name" onClick={() => actions.setDevelopmentStage('primary')}>{text.primaryDentition}</button>
      <span className="ds-count" title={`${count} ${text.toothCount}`}>{count}</span>
    </div>
  );
  const countLabel = `${count} ${id === 'permanent-teeth' ? text.toothCount : text.meshCount}`;
  return (
    <div className={`ds-layer-row${on ? '' : ' is-off'}`} role="listitem">
      {/* the layer's own colour is the visibility toggle: filled with a check when shown, outlined when hidden */}
      <button
        type="button"
        className={`ds-dot-toggle${on ? ' is-on' : ''}${state === 'ghost' ? ' is-ghost' : ''}`}
        style={{ '--dot': color, '--dot-ink': inkOn(color) } as React.CSSProperties}
        onClick={() => actions.setCategory(id, on ? 'off' : 'on')}
        aria-pressed={on}
        aria-label={m.showX(label)}
        title={on ? m.hideX(label) : m.showX(label)}
      >
        <span className="ds-dot-toggle-dot" aria-hidden="true">
          <IconCheck size={11} strokeWidth={2.6} />
        </span>
      </button>
      <button type="button" className="ds-layer-name" onClick={() => actions.showOnlyCategory(id)} title={m.showOnlyX(label)} aria-label={m.showOnlyX(label)}>
        {label}
      </button>
      <span className="ds-count" title={countLabel} aria-label={countLabel}>{count}</span>
      <button
        type="button"
        className={`ds-ghost-btn${state === 'ghost' ? ' is-active' : ''}`}
        onClick={() => actions.setCategory(id, state === 'ghost' ? 'on' : 'ghost')}
        aria-pressed={state === 'ghost'}
        aria-label={m.translucentX(label)}
        title={m.translucent}
      >
        <IconGhost size={14} />
      </button>
    </div>
  );
}

/** Check-mark colour that stays legible on a layer colour: ink on light swatches, white on dark ones. */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? '#17150f' : '#ffffff';
}
