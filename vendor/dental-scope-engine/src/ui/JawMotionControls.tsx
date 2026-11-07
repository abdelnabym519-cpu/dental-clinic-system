import { useEffect, useRef, useState } from 'react';
import { useLang, useT } from '../i18n';
import { FEEDBACK_TEXT } from '../i18n/feedback';
import { actions, getState, useApp } from '../state/store';
import { useServices } from './context';
import { IconPause, IconPlay, IconReset, IconClose, IconLabel, IconSection } from './icons';

export function JawMotionControls() {
  const { engine } = useServices();
  const lang = useLang();
  const t = FEEDBACK_TEXT[lang];
  const m = useT();
  const playing = useApp((s) => s.jawPlaying);
  const opening = useApp((s) => s.jawOpening);
  const clip = useApp((s) => s.clip.enabled);
  const labels = useApp((s) => s.labels);
  const forcedReduction = new URLSearchParams(window.location.search).get('motion') === 'reduce';
  const [reduced, setReduced] = useState(() => forcedReduction || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const slider = useRef<HTMLInputElement>(null);
  const readout = useRef<HTMLOutputElement>(null);
  useEffect(() => engine.subscribeJawProgress((value) => {
    if (slider.current) { slider.current.value = String(value); slider.current.setAttribute('aria-valuetext', `${Math.round(value * 100)}%`); }
    if (readout.current) readout.current.textContent = `${Math.round(value * 100)}%`;
  }), [engine]);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => {
      const value = forcedReduction || query.matches;
      setReduced(value);
      if (value && getState().jawPlaying) engine.pauseJaw();
    };
    query.addEventListener('change', stop);
    return () => { query.removeEventListener('change', stop); if (getState().jawControls) engine.pauseJaw(); };
  }, [engine, forcedReduction]);
  return <section className="ds-jaw-controls" aria-label={t.jawMotion}>
    <div className="ds-jaw-row">
      <button type="button" className="ds-play" disabled={reduced} onClick={() => playing ? engine.pauseJaw() : engine.playJaw()} aria-label={playing ? t.pauseJaw : t.playJaw} title={reduced ? t.reducedMotion : playing ? t.pauseJaw : t.playJaw}>{playing ? <IconPause /> : <IconPlay />}</button>
      <label className="ds-slider" htmlFor="jaw-opening"><span className="ds-slider-head"><span>{t.jawOpening}</span><output ref={readout}>{Math.round(opening * 100)}%</output></span>
        <input id="jaw-opening" ref={slider} type="range" className="ds-range" min="0" max="1" step="0.01" defaultValue={opening} onChange={(e) => actions.setJawOpening(Number(e.target.value))} aria-label={t.jawOpening} />
        <span className="ds-slider-ends"><span>{t.jawClosed}</span><span>{t.jawOpen}</span></span>
      </label>
      <button type="button" className="ds-icon-btn" onClick={() => actions.setJawOpening(0)} aria-label={t.resetJaw} title={t.resetJaw}><IconReset /></button>
      <button type="button" className="ds-icon-btn" onClick={() => engine.closeJaw()} aria-label={m.backToMouth} title={m.backToMouth}><IconClose /></button>
    </div>
    <div className="ds-jaw-row"><button type="button" className="ds-link-btn" onClick={() => void engine.showJaw('right')}>{t.rightJoint}</button><button type="button" className="ds-link-btn" onClick={() => void engine.showJaw('left')}>{t.leftJoint}</button>
      <button type="button" className={`ds-tool${clip ? ' is-active' : ''}`} aria-pressed={clip} onClick={() => actions.setClip({ enabled: !clip })}><IconSection />{m.section}</button>
      <button type="button" className={`ds-tool${labels ? ' is-active' : ''}`} aria-pressed={labels} onClick={() => actions.toggleLabels()}><IconLabel />{m.labels}</button>
    </div>
    <p className="ds-evidence">{t.schematicMotion}</p>
    {reduced && <p className="ds-evidence">{t.reducedMotion}</p>}
  </section>;
}
