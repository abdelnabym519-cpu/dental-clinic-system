import { useEffect, useRef, useState } from 'react';
import { DEVELOPMENT_STAGES, DEVELOPMENT_TEETH, developmentId, developmentNotation, developmentStatus } from '../anatomy/development';
import { DEVELOPMENT_SOURCES } from '../content/developmentAnatomy';
import { nameOf, useLang } from '../i18n';
import { DEVELOPMENT_TEXT } from '../i18n/development';
import { actions, useApp } from '../state/store';
import { useServices } from './context';

/** Discrete, keyboard-accessible timeline; the final stop is the existing adult atlas. */
export function DevelopmentTimeline() {
  const { engine } = useServices();
  const lang = useLang();
  const text = DEVELOPMENT_TEXT[lang];
  const stage = useApp((s) => s.developmentStage);
  const playing = useApp((s) => s.developmentPlaying);
  const index = stage ? DEVELOPMENT_STAGES.findIndex((s) => s.id === stage) : DEVELOPMENT_STAGES.length;
  const [initialIndex] = useState(index);
  const displayedIndex = useRef(index);
  const slider = useRef<HTMLInputElement>(null);
  useEffect(() => engine.subscribeDevelopmentProgress((position) => {
    displayedIndex.current = position;
    if (slider.current) slider.current.value = String(position);
  }), [engine]);
  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) actions.pauseDevelopment(); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => { document.removeEventListener('visibilitychange', pauseWhenHidden); actions.pauseDevelopment(); };
  }, []);
  const current = stage ? text.stages[stage].title : text.atlas;
  const age = stage ? `${DEVELOPMENT_STAGES[index].years} ${text.years}` : '';
  return (
    <div className="ds-panel ds-development-timeline">
      <div className="ds-development-heading"><span>{text.title}</span><strong aria-live="polite">{current}{age ? ` · ${age}` : ''}</strong></div>
      <button type="button" className={`ds-development-play${playing ? ' is-active' : ''}`} aria-label={playing ? text.pause : stage ? text.play : text.replay} onClick={() => playing ? actions.pauseDevelopment() : actions.playDevelopment()}><span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span> {playing ? text.pause : stage ? text.play : text.replay}</button>
      <input ref={slider} type="range" min={0} max={DEVELOPMENT_STAGES.length} step="any" defaultValue={initialIndex} aria-label={text.stage} aria-valuetext={`${current} ${age}`} onChange={(e) => {
        actions.setDevelopmentStage(DEVELOPMENT_STAGES[Math.round(Number(e.currentTarget.value))]?.id ?? null);
        e.currentTarget.value = String(displayedIndex.current);
      }} onKeyDown={(e) => {
        const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'PageUp' ? 2 : e.key === 'PageDown' ? -2 : 0;
        if (!delta && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? DEVELOPMENT_STAGES.length : Math.max(0, Math.min(DEVELOPMENT_STAGES.length, index + delta));
        actions.setDevelopmentStage(DEVELOPMENT_STAGES[next]?.id ?? null);
      }} />
      <div className="ds-development-stops">
        {DEVELOPMENT_STAGES.map((s) => <button key={s.id} data-tour={`development-${s.id}`} type="button" className={stage === s.id ? 'is-active' : ''} aria-pressed={stage === s.id} aria-label={`${text.stages[s.id].title}, ${s.years} ${text.years}`} title={text.stages[s.id].title} onClick={() => actions.setDevelopmentStage(s.id)}>{s.years}</button>)}
        <button type="button" className={stage === null ? 'is-active' : ''} aria-pressed={stage === null} data-tour="development-adult" aria-label={text.atlas} onClick={() => actions.setDevelopmentStage(null)}>{text.adult}</button>
      </div>
    </div>
  );
}

export function DevelopmentTools() {
  const lang = useLang();
  const text = DEVELOPMENT_TEXT[lang];
  const show = useApp((s) => s.developmentShowUnerupted);
  const soft = useApp((s) => s.developmentSoftTissue);
  return <div className="ds-development-tools">
    <label><input type="checkbox" checked={show} onChange={(e) => actions.setDevelopmentShowUnerupted(e.currentTarget.checked)} />{text.showUnerupted}</label>
    <label><input type="checkbox" checked={soft} onChange={(e) => actions.setDevelopmentSoftTissue(e.currentTarget.checked)} />{text.softTissue}</label>
  </div>;
}

export function DevelopmentPanel() {
  const { registry } = useServices();
  const lang = useLang();
  const text = DEVELOPMENT_TEXT[lang];
  const stage = useApp((s) => s.developmentStage)!;
  const show = useApp((s) => s.developmentShowUnerupted);
  const numbering = useApp((s) => s.numbering);
  const teeth = DEVELOPMENT_TEETH.filter((t) => {
    const status = developmentStatus(t, stage);
    return status !== 'absent' && (show || status !== 'unerupted');
  });
  return <div className="ds-development-panel">
    <h2>{text.stages[stage].title}</h2>
    <p>{text.stages[stage].summary}</p>
    <p className="ds-development-draft">{text.draft}</p>
    <div className="ds-development-legend">
      {(['primary', 'unerupted', 'erupting', 'erupted'] as const).map((status) => <span key={status}><i className={`ds-development-dot is-${status}`} />{text.status[status]}</span>)}
    </div>
    <p className="ds-layer-hint">{text.note}</p>
    <p className="ds-layer-hint">{text.skullNote}</p>
    <p className="ds-layer-hint">{text.excluded}</p>
    <h3>{text.teeth}</h3>
    <div className="ds-development-tooth-list">
      {teeth.map((t) => {
        const id = developmentId(t.fdi);
        const status = developmentStatus(t, stage);
        return <span key={id} className="ds-development-tooth" title={`${nameOf(registry.require(id), lang)} · ${text.status[status]}`}>
          <i className={`ds-development-dot is-${t.dentition === 'primary' && status === 'erupting' ? 'primary' : status}`} />
          <span>{developmentNotation(t)[numbering]}</span>
          <span className="sr-only">{nameOf(registry.require(id), lang)}, {text.status[status]}</span>
        </span>;
      })}
    </div>
    <p className="ds-evidence">{text.sources}: {DEVELOPMENT_SOURCES.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>)}</p>
  </div>;
}
