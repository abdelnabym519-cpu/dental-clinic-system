import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FIRST_VISIT_TOOTH, FIRST_VISIT_TOUR, needsFirstVisitGuide, playTour, rememberGuideVisit, tourDelay } from '../app/tour';
import { navigate } from '../app/router';
import { isCompactLayout } from '../app/viewport';
import { DEVELOPMENT_SOURCES } from '../content/developmentAnatomy';
import { useLang } from '../i18n';
import { DEVELOPMENT_TEXT } from '../i18n/development';
import { TOUR_TEXT } from '../i18n/tour';
import { actions, getState, store, useApp } from '../state/store';
import { useServices } from './context';
import { IconClose, IconPlay, IconPause, IconReplay, IconChevron } from './icons';

type Mark = { target: string; rect: DOMRect; clicking: boolean };
type Placement = 'top' | 'left' | 'bottom';
const cardPlacement = (rect: DOMRect, card: HTMLElement | null): Placement => isCompactLayout()
  ? rect.bottom < window.innerHeight / 2 ? 'bottom' : 'top'
  : card && rect.right + 10 > window.innerWidth - 24 - card.offsetWidth
    && rect.left - 10 < window.innerWidth - 24
    && rect.bottom + 8 > card.offsetTop
    && rect.top - 8 < card.offsetTop + card.offsetHeight ? 'left' : 'top';

/** Pixel coordinates keep the stroke and dash animation consistent on wide controls. */
const circlePath = (width: number, height: number) => {
  const x = (fraction: number) => width * fraction;
  const y = (fraction: number) => height * fraction;
  return `M ${x(.5)},3 C ${x(.16)},1 3,${y(.12)} 3,${y(.5)} C 1,${y(.86)} ${x(.22)},${height - 2} ${x(.5)},${height - 3} C ${x(.84)},${height - 1} ${width - 3},${y(.84)} ${width - 3},${y(.5)} C ${width - 1},${y(.14)} ${x(.8)},1 ${x(.5)},3 Z`;
};
const targetElement = (target: string) => [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find(element => element.checkVisibility() && element.getBoundingClientRect().width > 0) ?? null;
const visible = (element: HTMLElement | null) => {
  if (!element || !element.checkVisibility()) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
};

/** One overlay renders any script; all demonstrated clicks use the existing UI handlers. */
export function GuidedTour() {
  const { engine } = useServices();
  const open = useApp(s => s.guideOpen);
  const collapsed = useApp(s => s.guideCollapsed);
  const runId = useApp(s => s.guideRunId);
  const ready = useApp(s => s.ready);
  const error = useApp(s => s.error);
  const creditsOpen = useApp(s => s.creditsOpen);
  const lang = useLang();
  const text = TOUR_TEXT[lang];
  const [index, setIndex] = useState(0);
  const [mark, setMark] = useState<Mark | null>(null);
  const [placement, setPlacement] = useState<Placement>('top');
  const [highlight, setHighlight] = useState(false);
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading');
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  const [seek, setSeek] = useState<{ index?: number; revision: number }>({ revision: 0 });
  const pauseRef = useRef(false);
  const lastRun = useRef<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const circle = useRef<SVGSVGElement>(null);
  const autoChecked = useRef(false);
  // Reset the tour state when it opens or is replayed, adjusting during render
  // instead of in an effect (react.dev: "adjusting state when a prop changes").
  const [resetKey, setResetKey] = useState('');
  if (resetKey !== `${open}:${runId}`) {
    setResetKey(`${open}:${runId}`);
    if (open) {
      setPaused(false);
      setSeek({ revision: 0 });
      setIndex(0);
      setMark(null);
      setPlacement('top');
      setHighlight(false);
      setStatus('loading');
    }
  }
  const step = FIRST_VISIT_TOUR[index];
  const caption = text.steps[step.id];

  useEffect(() => {
    if (!ready || error || autoChecked.current) return;
    autoChecked.current = true;
    // A shared credits link should open quietly, without starting a tour behind it.
    if (creditsOpen) return;
    // Access to localStorage itself may throw (privacy modes / blocked storage).
    let firstVisit = true;
    try { firstVisit = needsFirstVisitGuide(localStorage); } catch { /* Show once this session. */ }
    // someone who already switched to Quiz while the scene loaded keeps their quiz
    if (firstVisit && getState().mode !== 'quiz') actions.startGuide();
  }, [ready, error, creditsOpen]);

  const cleanScene = () => { actions.resetGuideScene(); engine.resetToStart(); };
  const close = () => {
    controller.current?.abort();
    cleanScene();
    actions.closeGuide();
  };

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    controller.current = abort;
    const signal = abort.signal;
    // Reset all cancels pending clicks immediately, before React removes the guide.
    const stopOnClose = store.subscribe(state => { if (!state.guideOpen) abort.abort(); });
    const focusBefore = document.activeElement;
    if (lastRun.current !== runId) {
      pauseRef.current = false;
      lastRun.current = runId;
    }
    actions.resetGuideScene(true);
    engine.resetToStart();
    try { rememberGuideVisit(localStorage); } catch { /* Storage is optional. */ }
    card.current?.querySelector<HTMLButtonElement>('button')?.focus();

    const demonstrate = async () => {
      // Preload before any asynchronous selection. Closing during loading cannot select a tooth later.
      // The abortable race also lets the overlay unmount promptly on a slow connection.
      await Promise.race([engine.ensureTooth(FIRST_VISIT_TOOTH), tourDelay(30000, signal).then(() => { throw new Error('Tooth loading timed out'); })]);
      signal.throwIfAborted();
      while (!getState().ready && !getState().error) await tourDelay(100, signal);
      if (getState().error) throw new Error('Scene loading failed');
      let expandedDetail = false;
      await playTour(FIRST_VISIT_TOUR, {
        paused: () => pauseRef.current || document.hidden,
        speed: () => speedRef.current,
        showStep: (nextStep, next) => { setIndex(next); setStatus('playing'); if (!nextStep.target) setMark(null); },
        prepare: next => {
          expandedDetail = isCompactLayout() && next.detailExpanded === true;
          if (next.panel) {
            actions.setCollapsed(next.panel === 'tools' ? 'dock' : next.panel, false);
            if (isCompactLayout()) actions.setMobileSheet(next.panel);
          }
          if (isCompactLayout() && next.detailExpanded !== undefined) {
            const control = targetElement('detail-size-toggle');
            if (control && (control.getAttribute('aria-expanded') === 'true') !== next.detailExpanded) control.click();
          }
        },
        locate: target => {
          const element = targetElement(target);
          if (!element) return false;
          element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
          const rect = element.getBoundingClientRect();
          const bodyElement = expandedDetail ? element.closest('.ds-detail-body') : null;
          if (bodyElement && !bodyElement.closest('.ds-detail.is-expanded')) return false;
          const body = bodyElement?.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight
            && (!body || rect.top >= body.top - 1 && rect.bottom <= body.bottom + 1);
        },
        point: (target, clicking) => {
          const element = targetElement(target)!;
          const rect = element.getBoundingClientRect();
          setMark({ target, rect, clicking });
          // Pick a side once for this step, before the click changes the layout.
          if (!clicking) setPlacement(cardPlacement(rect, card.current));
          setHighlight(true);
        },
        activate: next => {
          signal.throwIfAborted();
          if (next.action === 'finish') {
            abort.abort();
            void navigate(() => {
              actions.resetAll();
              engine.resetToStart();
            });
          } else if (next.action === 'search') actions.setSearchQuery(next.value ?? '');
          else if (next.target) {
            const element = targetElement(next.target)!;
            const control = element.matches('button, [role="option"]') ? element : element.querySelector<HTMLElement>('button');
            if (!control) throw new Error('Tour control unavailable');
            control.click();
          }
        },
        settled: next => {
          const s = getState();
          if (s.error) throw new Error('Scene loading failed');
          const expected = next.waitFor;
          return (!expected?.selectedId || s.selectedId === expected.selectedId)
            && (expected?.dissectFdi === undefined || s.dissectFdi === expected.dissectFdi)
            && (expected?.explode === undefined || s.explode === expected.explode)
            && (expected?.surfaceFeatures === undefined || s.surfaceFeatures === expected.surfaceFeatures)
            && (!expected?.asset || s.loading[expected.asset] === 1);
        },
        clearPointer: () => setHighlight(false),
      }, signal, window.matchMedia('(prefers-reduced-motion: reduce)').matches, seek.index);
    };
    void demonstrate().catch(() => {
      if (signal.aborted) return;
      setMark(null);
      setStatus('error');
      actions.resetGuideScene(true);
      engine.resetToStart();
    });

    const focusContainer = () => getState().guideCollapsed ? targetElement('show-guide') : card.current;
    const focusFirst = () => {
      const container = focusContainer();
      if (container instanceof HTMLButtonElement) container.focus();
      else container?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('.ds-reset-all')) return;
      if (!focusContainer()?.contains(event.target as Node)) focusFirst();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        abort.abort();
        actions.resetGuideScene();
        engine.resetToStart();
        actions.closeGuide();
      } else if (event.key === 'Tab') {
        const container = focusContainer();
        const buttons: HTMLElement[] = container instanceof HTMLButtonElement ? [container] : [...container?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), summary, details[open] a[href]') ?? []];
        const reset = document.querySelector<HTMLButtonElement>('.ds-reset-all');
        if (reset) buttons.push(reset);
        const current = buttons.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener('focusin', onFocus);
    window.addEventListener('keydown', onKey, true);
    return () => {
      abort.abort();
      stopOnClose();
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('keydown', onKey, true);
      if (focusBefore instanceof HTMLElement && focusBefore.isConnected) focusBefore.focus();
      else document.querySelector<HTMLButtonElement>('[data-tour="replay"]')?.focus();
    };
  }, [open, runId, engine, seek]);

  // Collapsing changes focus and camera clearance without restarting playback.
  useEffect(() => {
    if (!open) return;
    if (collapsed) targetElement('show-guide')?.focus();
    else {
      card.current?.querySelector<HTMLButtonElement>('button')?.focus();
      const frame = requestAnimationFrame(() => {
        const target = circle.current?.dataset.target;
        const element = target && targetElement(target);
        if (element) setPlacement(cardPlacement(element.getBoundingClientRect(), card.current));
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [open, collapsed]);

  // Follow responsive tray motion imperatively; React does not render per animation frame.
  useEffect(() => {
    if (!mark) return;
    let frame = 0;
    const track = () => {
      const element = targetElement(mark.target);
      if (element && visible(element)) {
        const rect = element.getBoundingClientRect();
        if (cursor.current) { cursor.current.style.left = `${rect.x + rect.width / 2}px`; cursor.current.style.top = `${rect.y + rect.height / 2}px`; }
        if (circle.current) {
          circle.current.style.left = `${rect.x - 10}px`; circle.current.style.top = `${rect.y - 8}px`;
          circle.current.style.width = `${rect.width + 20}px`; circle.current.style.height = `${rect.height + 16}px`;
          circle.current.setAttribute('viewBox', `0 0 ${rect.width + 20} ${rect.height + 16}`);
          circle.current.querySelector('path')?.setAttribute('d', circlePath(rect.width + 20, rect.height + 16));
        }
      }
      frame = requestAnimationFrame(track);
    };
    const onResize = () => {
      const element = targetElement(mark.target);
      if (visible(element)) setPlacement(cardPlacement(element!.getBoundingClientRect(), card.current));
    };
    window.addEventListener('resize', onResize);
    frame = requestAnimationFrame(track);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, [mark]);

  if (!open) return null;
  const togglePause = () => { pauseRef.current = !pauseRef.current; setPaused(pauseRef.current); };
  const changeSpeed = (next: number) => { speedRef.current = next; setSpeed(next); };
  const jump = (next: number) => {
    controller.current?.abort();
    setIndex(next);
    setMark(null);
    setHighlight(false);
    setStatus('loading');
    setSeek(previous => ({ index: next, revision: previous.revision + 1 }));
  };
  const development = step.development && DEVELOPMENT_TEXT[lang];
  return <div className={`ds-tour${paused ? ' is-paused' : ''}`} style={{ '--tour-speed': speed } as CSSProperties}>
    <div className="ds-tour-shield" aria-hidden="true" />
    {mark && status === 'playing' && <>
      {highlight &&
      <svg ref={circle} key={mark.target} data-target={mark.target} className="ds-tour-circle" viewBox={`0 0 ${mark.rect.width + 20} ${mark.rect.height + 16}`} aria-hidden="true"
        style={{ left: mark.rect.x - 10, top: mark.rect.y - 8, width: mark.rect.width + 20, height: mark.rect.height + 16 }}>
        <path d={circlePath(mark.rect.width + 20, mark.rect.height + 16)} pathLength="1" />
      </svg>}
      <div ref={cursor} className={`ds-tour-cursor${mark.clicking ? ' is-clicking' : ''}`} aria-hidden="true"
        style={{ left: mark.rect.x + mark.rect.width / 2, top: mark.rect.y + mark.rect.height / 2 }}>
        <span className="ds-tour-click" />
        <svg width="34" height="42" viewBox="0 0 34 42"><path d="M3 2 L3 31 L11 24 L17 38 L24 35 L18 21 L29 21 Z" fill="var(--accent)" stroke="var(--panel-solid)" strokeWidth="3" strokeLinejoin="round" /></svg>
      </div>
    </>}
    <div ref={card} id="ds-guide-panel" hidden={collapsed} className="ds-tour-card ds-panel" role="dialog" aria-modal="true" aria-labelledby="ds-tour-title" aria-describedby="ds-tour-body" data-position={placement} data-step={step.id}>
      <div className="ds-tour-heading">
        <span className="ds-label-sm">{text.label}</span>
        <button type="button" className="ds-tour-hide" onClick={() => actions.setGuideCollapsed(true)} aria-expanded="true" aria-controls="ds-guide-panel"><IconChevron size={14} />{text.hide}</button>
        <button type="button" className="ds-icon-btn ds-icon-btn--ghost" onClick={close} aria-label={text.close}><IconClose size={17} /></button>
      </div>
      <div className="ds-tour-copy" aria-live="polite" aria-atomic="true">
        <h2 id="ds-tour-title">{caption[0]}</h2>
        <p id="ds-tour-body">{status === 'loading' ? text.loading : status === 'error' ? text.error : development && step.development ? development.stages[step.development].summary : caption[1]}</p>
        {status === 'playing' && development && step.development && <>
          <p className="ds-tour-evidence">{text.example} {development.draft}</p>
          <details className="ds-tour-evidence"><summary>{development.sources}</summary><p>{development.note}</p>
            {DEVELOPMENT_SOURCES.map((source, i) => <span key={source.url}>{i > 0 && ' · '}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></span>)}</details>
        </>}
      </div>
      <div className="ds-tour-progress" aria-hidden="true"><span style={{ width: `${(index + 1) / FIRST_VISIT_TOUR.length * 100}%` }} /></div>
      <div className="ds-tour-navigation">
        <button type="button" className="ds-secondary" aria-label={text.previous} disabled={index === 0} onClick={() => jump(index - 1)}>←</button>
        <select aria-label={text.step} value={step.id} onChange={event => jump(FIRST_VISIT_TOUR.findIndex(item => item.id === event.target.value))}>
          {FIRST_VISIT_TOUR.map((item, next) => <option key={item.id} value={item.id}>{next + 1}. {text.steps[item.id][0]}</option>)}
        </select>
        <button type="button" className="ds-secondary" aria-label={text.next} disabled={index === FIRST_VISIT_TOUR.length - 1} onClick={() => jump(index + 1)}>→</button>
      </div>
      <div className="ds-tour-speed" role="group" aria-label={text.speed}>
        <span>{text.speed}</span>
        {[1, 1.5, 2].map(rate => <button key={rate} type="button" className="ds-secondary" aria-pressed={speed === rate} onClick={() => changeSpeed(rate)}>{rate}×</button>)}
      </div>
      <div className="ds-tour-actions">
        <span className="ds-tour-count">{index + 1} / {FIRST_VISIT_TOUR.length}</span>
        <button type="button" className="ds-secondary ds-tour-skip" onClick={close}>{text.skip}</button>
        {status === 'error' ? <button type="button" className="ds-secondary" onClick={() => actions.startGuide()}><IconReplay size={14} />{text.retry}</button> :
          <button type="button" className="ds-secondary" onClick={togglePause}>{paused ? <IconPlay size={14} /> : <IconPause size={14} />}{paused ? text.resume : text.pause}</button>}
      </div>
    </div>
  </div>;
}
