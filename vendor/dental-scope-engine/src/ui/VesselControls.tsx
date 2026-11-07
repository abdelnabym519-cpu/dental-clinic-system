import { navigate } from '../app/router';
import { actions, useApp } from '../state/store';
import { STUDY_TEXT } from '../i18n/study';
import { useServices } from './context';
import { nameOf } from '../i18n';
export function VesselControls() {
  const { registry, engine } = useServices();
  const lang = useApp(s => s.lang), study = useApp(s => s.studyView), side = useApp(s => s.vesselSide), mode = useApp(s => s.vesselMode);
  const text = STUDY_TEXT[lang];
  if (study !== 'vessels') return null;
  const vessels = [...registry.byId.values()].filter(s => s.meshes.length && s.categories.some(c => c === 'arteries' || c === 'veins') && (side === 'both' || s.id.endsWith(`-${side}`)) && (mode === 'both' || s.categories.includes(mode)));
  return <section className="ds-study-controls" aria-label={text.vessels}>
    <p className="ds-layer-hint">{text.vesselHint}</p>
    <div className="ds-chip-row">{(['both', 'arteries', 'veins'] as const).map(value => <button type="button" className={`ds-chip ds-chip--button${mode === value ? ' is-active' : ''}`} aria-pressed={mode === value} key={value} onClick={() => actions.setVesselMode(value)}>{value === 'both' ? text.both : text[value]}</button>)}</div>
    <div className="ds-chip-row">{(['both', 'right', 'left'] as const).map(value => <button type="button" className={`ds-chip ds-chip--button${side === value ? ' is-active' : ''}`} aria-pressed={side === value} key={value} onClick={() => actions.setVesselSide(value)}>{value === 'both' ? text.allSides : text[value]}</button>)}</div>
    <select className="ds-study-select" aria-label={text.vesselView} value="" onChange={e => { if (e.target.value) void navigate(() => engine.selectFromUI(e.target.value, { focus: true })); }}>
      <option value="">{text.vesselView}</option>{vessels.map(vessel => <option key={vessel.id} value={vessel.id}>{nameOf(vessel, lang)}</option>)}
    </select>
  </section>;
}
