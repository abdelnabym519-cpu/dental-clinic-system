import { navigate } from '../app/router';
import { useApp } from '../state/store';
import { useServices } from './context';
import { SINUS_NOTE, STUDY_TEXT } from '../i18n/study';
import { nameOf } from '../i18n';
import { styleFor, styleKeyFor } from '../engine/materials';
export function SinusControls() {
  const study = useApp(s => s.studyView), lang = useApp(s => s.lang);
  const { registry, engine } = useServices();
  if (study !== 'sinuses') return null;
  const text = STUDY_TEXT[lang];
  const groups = ['maxillary-sinus', 'frontal-sinus', 'sphenoidal-sinus'];
  return <section className="ds-study-controls" aria-label={text.sinuses}>
    <p className="ds-layer-hint">{text.sinusHint}</p>
    <p className="ds-evidence">{SINUS_NOTE[lang]}</p>
    <div className="ds-chip-row">{groups.map(id => <button type="button" key={id} className="ds-chip ds-chip--button ds-sinus-chip" onClick={() => void navigate(() => engine.selectFromUI(id, { focus: true }))}><span className="ds-sinus-swatch" style={{ background: styleFor(styleKeyFor(id, ['sinus'])).color }} aria-hidden="true" />{nameOf(registry.require(id), lang)}</button>)}</div>
    <select className="ds-study-select" aria-label={text.sinusView} value="" onChange={e => { if (e.target.value) void navigate(() => engine.selectFromUI(e.target.value, { focus: true })); }}>
      <option value="">{text.sinusView}</option>{groups.flatMap(id => ['right', 'left'].map(side => <option key={`${id}-${side}`} value={`${id}-${side}`}>{nameOf(registry.require(`${id}-${side}`), lang)}</option>))}
    </select>
  </section>;
}
