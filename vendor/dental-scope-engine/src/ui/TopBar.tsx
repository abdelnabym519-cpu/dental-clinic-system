import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { NUMBERING_LABEL, NUMBERING_SHORT, NUMBERING_SYSTEMS } from '../anatomy/notation';
import { REPO_URL } from '../app/repo';
import { useT } from '../i18n';
import { actions, useApp } from '../state/store';
import { MODES, QUIZ_MODE, switchMode } from '../modes/modes';
import { useServices } from './context';
import { IconClose, IconExternal, IconInfo, IconMoon, IconSearch, IconSun, IconPlay, IconChevron } from './icons';
import { TOUR_TEXT } from '../i18n/tour';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Identity() {
  const m = useT();
  return (
    <>
      <header className="ds-identity">
        <h1 className="ds-title">Dental Scope</h1>
        <p className="ds-credit">
          <button type="button" aria-haspopup="dialog" onClick={() => actions.openCredits(true)}>{m.credits}</button>
          {REPO_URL && (
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={m.supportRepoAria}>
              {m.supportRepo}
              <IconExternal size={11} />
            </a>
          )}
        </p>
      </header>
    </>
  );
}

export function TopActions() {
  const theme = useApp((s) => s.theme);
  const lang = useApp((s) => s.lang);
  const guideCollapsed = useApp(s => s.guideOpen && s.guideCollapsed);
  const m = useT();
  return (
    <div className={`ds-top-actions${guideCollapsed ? ' is-guide-collapsed' : ''}`}>
      <ModeSwitch />
      <LanguageSwitcher />
      <NumberingControls />
      <button type="button" data-tour="search" className="ds-search-trigger" onClick={() => actions.openSearch(true)} aria-label={m.searchAnatomy} aria-keyshortcuts="/">
        <IconSearch />
        <span>{m.searchAnatomy}</span>
        <kbd>/</kbd>
      </button>
      {guideCollapsed ?
        <button type="button" data-tour="show-guide" className="ds-guide-show ds-icon-btn" onClick={() => actions.setGuideCollapsed(false)} aria-expanded="false" aria-controls="ds-guide-panel"><IconChevron size={15} />{TOUR_TEXT[lang].show}</button> :
        <button type="button" data-tour="replay" className="ds-icon-btn" onClick={() => actions.startGuide()} aria-label={TOUR_TEXT[lang].replay} title={TOUR_TEXT[lang].replay}><IconPlay /></button>}
      <button type="button" className="ds-icon-btn" onClick={() => actions.setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? m.toLight : m.toDark} title={m.theme}>
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
      </button>
      <button type="button" className="ds-icon-btn" onClick={() => actions.openAbout(true)} aria-label={m.aboutAria} title={m.about}>
        <IconInfo />
      </button>
    </div>
  );
}

export function NumberingControls() {
  const numbering = useApp((s) => s.numbering);
  const m = useT();
  return (
    <div className="ds-numbering ds-segmented ds-segmented--mono" role="radiogroup" aria-label={m.numberingGroup}>
      {NUMBERING_SYSTEMS.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={numbering === s} className={numbering === s ? 'is-active' : ''} onClick={() => actions.setNumbering(s)} title={m.numberingTitle(NUMBERING_LABEL[s])}>
          {NUMBERING_SHORT[s]}
        </button>
      ))}
    </div>
  );
}

/** Switch between the available modes (Explore, Quiz). */
export function ModeSwitch() {
  const mode = useApp((s) => s.mode);
  const m = useT();
  const { engine, registry } = useServices();
  const modes = MODES.filter((x) => x.available);
  const quizButton = useRef<HTMLButtonElement>(null);
  return (
    <div className="ds-mode-anchor">
      <div className="ds-mode-switch ds-segmented" role="radiogroup" aria-label={m.modesGroup}>
        {modes.map((x) => (
          <button
            key={x.id}
            ref={x.id === 'quiz' ? quizButton : undefined}
            type="button"
            role="radio"
            aria-checked={mode === x.id}
            className={mode === x.id ? 'is-active' : ''}
            onClick={() => {
              if (mode === x.id) return;
              const from = MODES.find((mm) => mm.id === mode);
              switchMode(from, x, { registry, engine });
            }}
          >
            {m.mode[x.id]}
          </button>
        ))}
      </div>
      <QuizNewNote anchor={quizButton} placement="below" />
    </div>
  );
}

/**
 * A small "New" card pointing at a Quiz button, for viewers who might miss the
 * mode. Opening it enters Quiz; closing it (or entering Quiz any other way)
 * hides it for good (`quizNewSeen`). The top bar shows it below the switch, the
 * phone bottom bar above its Quiz button; CSS hides whichever is not in use.
 */
export function QuizNewNote({ anchor, placement }: { anchor: RefObject<HTMLElement | null>; placement: 'below' | 'above' }) {
  const show = useApp((s) => s.ready && !s.quizNewSeen && s.mode !== 'quiz' && !s.guideOpen);
  const lang = useApp((s) => s.lang);
  const mode = useApp((s) => s.mode);
  const { engine, registry } = useServices();
  const m = useT();
  const note = useRef<HTMLDivElement>(null);
  const [arrowX, setArrowX] = useState<number | null>(null);

  // point the arrow at the centre of the Quiz button, wherever the card ends up
  useLayoutEffect(() => {
    if (!show) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const n = note.current?.getBoundingClientRect();
      if (!a || !n || !a.width || !n.width) return;
      setArrowX(Math.min(n.width - 14, Math.max(14, a.left + a.width / 2 - n.left)));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [show, anchor, lang]);

  if (!show) return null;
  const open = () => switchMode(MODES.find((x) => x.id === mode), QUIZ_MODE, { registry, engine });
  return (
    <div
      ref={note}
      className={`ds-quiz-new ds-quiz-new--${placement}`}
      style={arrowX === null ? undefined : ({ '--arrow-x': `${arrowX}px` } as CSSProperties)}
    >
      <button type="button" className="ds-quiz-new-open" onClick={open}>
        <span className="ds-quiz-new-badge">{m.quizNewBadge}</span>
        <span>{m.quizNewText}</span>
      </button>
      <button type="button" className="ds-quiz-new-close" aria-label={m.quizNewDismiss} title={m.quizNewDismiss} onClick={() => actions.dismissQuizNew()}>
        <IconClose size={12} />
      </button>
    </div>
  );
}
