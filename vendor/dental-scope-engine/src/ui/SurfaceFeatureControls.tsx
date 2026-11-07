import { navigate } from '../app/router';
import { actions, useApp } from '../state/store';
import { STUDY_TEXT } from '../i18n/study';
import { nameOf } from '../i18n';
import { useServices } from './context';
export function SurfaceFeatureControls({ fdi }: { fdi: number }) {
  const { registry, engine } = useServices();
  const lang = useApp(s => s.lang), enabled = useApp(s => s.surfaceFeatures), selected = useApp(s => s.selectedId);
  const text = STUDY_TEXT[lang];
  const features = registry.descendants(`tooth-${fdi}`).filter(s => s.surfaceFeature);
  const show = async () => {
    if (enabled) { actions.setSurfaceFeatures(false); return; }
    const anterior = registry.require(`tooth-${fdi}`).tooth!.type.includes('incisor') || registry.require(`tooth-${fdi}`).tooth!.type === 'canine';
    await engine.studyToothSurface(fdi, anterior ? 'inner' : 'occlusal'); actions.setSurfaceFeatures(true);
  };
  return <section className="ds-study-controls" aria-label={text.features}>
    <div className="ds-label-sm">{text.features}</div>
    <div className="ds-chip-row">{(['occlusal', 'inner', 'facial', 'mesial', 'distal'] as const).map(view => <button type="button" data-tour={`surface-view-${view}`} className="ds-chip ds-chip--button" key={view} onClick={() => void engine.studyToothSurface(fdi, view)}>{text[view]}</button>)}</div>
    <button type="button" data-tour="surface-features-toggle" className={`ds-chip ds-chip--button${enabled ? ' is-active' : ''}`} aria-pressed={enabled} onClick={() => void show()}>{enabled ? text.hide : text.show}</button>
    {enabled && <div className="ds-chip-row">{features.map(feature => <button type="button" data-tour={feature.id} className={`ds-chip ds-chip--button${selected === feature.id ? ' is-active' : ''}`} key={feature.id} onClick={() => void navigate(() => engine.selectFromUI(feature.id, { focus: true }))}>{nameOf(feature, lang)}</button>)}</div>}
    <p className="ds-evidence">{text.note}</p>
  </section>;
}
