import { Fragment, useEffect, useRef } from 'react';
import { REPO_URL } from '../app/repo';
import { useT } from '../i18n';
import { actions, useApp } from '../state/store';
import { IconClose } from './icons';
import { interfaceText } from '../i18n/interface';
import { nameOf } from '../i18n';
import { useServices } from './context';
import { navigate } from '../app/router';

/** Loading stages, in order (their names are in the messages, `stage`). */
const STAGES = ['core', 'context', 'neurovascular'];

export function LoadingCard() {
  const ready = useApp((s) => s.ready);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);
  const request = useApp((s) => s.selectionRequest);
  const lang = useApp((s) => s.lang);
  const text = interfaceText(lang);
  const { engine, registry } = useServices();
  const m = useT();
  if (error) {
    return (
      <div className="ds-loading ds-panel" role="alert">
        <strong>{m.somethingWrong}</strong>
        <p>{error === 'load' ? m.loadError : error}</p>
        <button type="button" className="ds-secondary" onClick={() => void engine.retryAssets()}>{text.retry}</button>
      </div>
    );
  }
  if (request) return (
    <div className="ds-loading ds-panel is-compact" role={request.status === 'error' ? 'alert' : 'status'} aria-live="polite">
      <strong>{request.status === 'error' ? text.selectionError : text.loadingSelection}</strong>
      <p>{nameOf(registry.require(request.id), lang)}</p>
      {request.status === 'error' && <button type="button" className="ds-secondary" onClick={() => void navigate(() => engine.retrySelection())}>{text.retry}</button>}
    </div>
  );
  const pending = STAGES.filter((s) => (loading[s] ?? 0) < 1);
  if (ready && pending.length === 0) return null;
  const done = STAGES.reduce((a, s) => a + (loading[s] ?? 0), 0) / STAGES.length;
  return (
    <div className={`ds-loading ds-panel${ready ? ' is-compact' : ''}`} role="status" aria-live="polite">
      <div className="ds-loading-head">
        <span className="ds-spinner" aria-hidden="true" />
        <span>{ready ? m.loadingStage(m.stage[pending[0]] ?? '') : m.preparing}</span>
      </div>
      {!ready && (
        <>
          <div className="ds-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.max(0.04, done)})` }} />
          </div>
          <ul className="ds-loading-stages">
            {STAGES.map((s) => (
              <li key={s} className={(loading[s] ?? 0) >= 1 ? 'is-done' : ''}>
                {m.stage[s]}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** `text` with the first `word` set in italics. */
function withEm(text: string, word: string) {
  const i = text.indexOf(word);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <em>{word}</em>
      {text.slice(i + word.length)}
    </>
  );
}

/** The static about page for the active language (English at about/, translations at about/sv/ and about/de/). */
export function aboutPageHref(lang: string): string {
  return `${import.meta.env.BASE_URL}about/${lang === 'en' ? '' : `${lang}/`}`;
}

export function Footer() {
  const m = useT();
  const lang = useApp((s) => s.lang);
  return (
    <footer className="ds-footer">
      <p className="ds-disclaimer">
        {m.disclaimer}{' '}
        <button type="button" className="ds-link-btn" onClick={() => actions.openControls(true)}>
          {m.controlsTitle}
        </button>
        {' · '}
        <a className="ds-link-btn" href={aboutPageHref(lang)}>
          {m.about}
        </a>
      </p>
    </footer>
  );
}

export function AboutDialog() {
  const open = useApp((s) => s.aboutOpen || s.controlsOpen);
  const controls = useApp((s) => s.controlsOpen);
  const lang = useApp((s) => s.lang);
  const m = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => { actions.openAbout(false); actions.openControls(false); };
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      if (!d.open) d.showModal();
      d.querySelector<HTMLButtonElement>('button')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, controls]);
  return (
    <dialog ref={ref} className="ds-about ds-panel" onClose={close} aria-labelledby="ds-about-title">
      <button type="button" className="ds-icon-btn ds-icon-btn--ghost ds-about-close" onClick={close} aria-label={m.close}>
        <IconClose />
      </button>
      <h2 id="ds-about-title">{controls ? m.controlsTitle : m.aboutTitle}</h2>
      {controls ? <dl className="ds-keys">
        {m.keys.map(([k, v]) => (
          <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
        ))}
      </dl> : <>
      <p>{m.aboutIntro}</p>
      <p>
        <a href={aboutPageHref(lang)}>{m.aboutGuide}</a>
        {' · '}
        <button type="button" className="ds-link-btn" onClick={() => actions.openControls(true)}>{m.controlsTitle}</button>
      </p>
      <h3>{m.eduTitle}</h3>
      <p>{m.eduBody}</p>
      <h3>{m.madeTitle}</h3>
      <ul>
        <li>
          <strong>{m.provSource}</strong> — {withEm(m.provSourceBody, 'BodyParts3D')}
        </li>
        <li>
          <strong>{m.provDerived}</strong> — {m.provDerivedBody}
        </li>
        <li>
          <strong>{m.provModeled}</strong> — {m.provModeledBody}
        </li>
        <li>
          <strong>{m.provAtlas}</strong> — {withEm(m.provAtlasBody, 'Z-Anatomy')}
        </li>
        <li>
          <strong>{m.provSchematic}</strong> — {m.provSchematicBody}
        </li>
      </ul>
      {REPO_URL && (
        <p>
          <a href={`${REPO_URL}/blob/main/docs/sources.md`} target="_blank" rel="noopener noreferrer" aria-label={m.sourcesAria}>
            {m.sources}
          </a>
          .
        </p>
      )}
      <p className="ds-about-foot">
        {m.licences}
        {REPO_URL && (
          <>
            {' · '}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              {m.sourceOnGithub}
            </a>
          </>
        )}
      </p>
      </>}
    </dialog>
  );
}
