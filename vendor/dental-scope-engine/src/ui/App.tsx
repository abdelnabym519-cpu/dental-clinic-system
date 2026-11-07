import { useEffect, useRef } from 'react';
import { navigate, startRouter } from '../app/router';
import { useT } from '../i18n';
import { actions, useApp } from '../state/store';
import { useServices } from './context';
import { DetailPanel } from './DetailPanel';
import { Dock } from './Dock';
import { IconArrowLeft, IconInfo, IconLayers, IconReset, IconSearch, IconSection, IconTooth } from './icons';
import { LayersPanel } from './LayersPanel';
import { AboutDialog, Footer, LoadingCard } from './Overlays';
import { SearchPanel } from './SearchPanel';
import { Identity, QuizNewNote, TopActions } from './TopBar';
import { useKeyboard } from './useKeyboard';
import { useViewportInsets } from './useViewportInsets';
import { GuidedTour } from './GuidedTour';
import { CreditsDialog } from './CreditsDialog';
import { QuizMode } from './QuizMode';
import { EXPLORE_MODE, QUIZ_MODE, switchMode } from '../modes/modes';

export function App() {
  const { engine, registry } = useServices();
  const stage = useRef<HTMLDivElement>(null);
  const quizButton = useRef<HTMLButtonElement>(null);
  const theme = useApp((s) => s.theme);
  const selected = useApp((s) => !!s.selectedId);
  const dissect = useApp((s) => s.dissectFdi !== null);
  const sheet = useApp((s) => s.mobileSheet);
  const lang = useApp((s) => s.lang);
  const quiz = useApp((s) => s.mode === 'quiz');
  const m = useT();

  useEffect(() => {
    engine.mount(stage.current!);
    void engine.loadAll();
    const stop = startRouter(engine, registry);
    return () => {
      stop();
      engine.dispose();
    };
  }, [engine, registry]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useKeyboard(engine);

  useViewportInsets(engine);

  return (
    <div className={`ds-app${selected ? ' has-selection' : ''}${dissect ? ' is-dissecting' : ''}${quiz ? ' is-quiz' : ''}`} data-sheet={sheet}>
      <div className="ds-stage" ref={stage} {...(quiz ? { role: 'img', 'aria-label': m.quizBoardAria } : {})} />
      <div className="ds-ui">
        <Identity />
        <TopActions />
        {!quiz && <LayersPanel />}
        {!quiz && <DetailPanel />}
        <Dock />
        <Footer />
        <ResetButton />
        <LoadingCard />
        {quiz && <QuizMode />}
        <nav className="ds-mobile-bar ds-panel" aria-label={m.mobileControls}>
          {!quiz && <button type="button" className={sheet === 'layers' ? 'is-active' : ''} onClick={() => actions.setMobileSheet(sheet === 'layers' ? 'none' : 'layers')} aria-pressed={sheet === 'layers'}>
            <IconLayers /> <span>{m.layers}</span>
          </button>}
          {!quiz && <button type="button" data-tour="search" onClick={() => actions.openSearch(true)}>
            <IconSearch /> <span>{m.search}</span>
          </button>}
          <button
            ref={quizButton}
            type="button"
            className="ds-mobile-mode"
            onClick={() => (quiz ? switchMode(QUIZ_MODE, EXPLORE_MODE, { registry, engine }) : switchMode(EXPLORE_MODE, QUIZ_MODE, { registry, engine }))}
          >
            {quiz ? <IconArrowLeft /> : <IconTooth />} <span>{quiz ? m.mode.explore : m.mode.quiz}</span>
          </button>
          <QuizNewNote anchor={quizButton} placement="above" />
          <button type="button" className={sheet === 'tools' ? 'is-active' : ''} onClick={() => actions.setMobileSheet(sheet === 'tools' ? 'none' : 'tools')} aria-pressed={sheet === 'tools'}>
            <IconSection /> <span>{m.tools}</span>
          </button>
          {!quiz && selected && <button type="button" className={sheet === 'detail' ? 'is-active' : ''} onClick={() => actions.setMobileSheet(sheet === 'detail' ? 'none' : 'detail')} aria-pressed={sheet === 'detail'}>
            <IconInfo /> <span>{m.details}</span>
          </button>}
        </nav>
        {sheet !== 'none' && <button type="button" className="ds-scrim" aria-label={m.closePanel} onClick={() => actions.setMobileSheet('none')} />}
      </div>
      {!quiz && <SearchPanel />}
      <AboutDialog />
      <CreditsDialog />
      <GuidedTour />
    </div>
  );
}

/** Bottom-left: back to the start view with every setting at its default. */
function ResetButton() {
  const { engine } = useServices();
  const m = useT();
  const guideOpen = useApp(s => s.guideOpen);
  const reset = () => {
    void navigate(() => { actions.resetAll(); engine.resetToStart(); });
  };
  return (
    <button type="button" className={`ds-reset-all${guideOpen ? ' is-guide-reset' : ''}`} onClick={reset} title={m.resetAllTitle} aria-label={m.resetAllTitle}>
      <IconReset size={15} />
      <span>{m.resetAll}</span>
    </button>
  );
}
