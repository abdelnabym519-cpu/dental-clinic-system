/**
 * Quiz mode UI: a tooth-identification quiz on the separated board of 32
 * permanent teeth. The session lives in sessionStorage (`src/modes/quiz.ts`),
 * so it resumes across a refresh or after leaving and re-entering the mode.
 *
 * The board itself is driven by the store (`explodePhase: 2`, `quizBoardOrder`)
 * and by the Quiz mode visibility filter registered in `src/modes/modes.ts`,
 * which shows only the tooth shells. Nothing here shows a tooth's name, FDI
 * number or detail until the current question is submitted or given up on.
 *
 * The current question ("find this tooth: …") sits in a large prompt over the
 * board; the card holds the tools. Position shuffling, hints, giving up and the
 * inspection tools (camera, surface features, section) are answer-safe: they
 * never name a tooth.
 */
import { useEffect, useRef, useState } from 'react';
import { typeOf } from '../anatomy/notation';
import { archOrder } from '../engine/layout';
import { nameOf, useLang, useT } from '../i18n';
import { QUIZ_HINTS } from '../i18n/quiz';
import { EXPLORE_MODE, QUIZ_MODE, switchMode } from '../modes/modes';
import {
  advance,
  answeredCount,
  clearSavedQuiz,
  createQuiz,
  currentFdi,
  isCorrect,
  isRevealed,
  isSubmitted,
  loadSavedQuiz,
  revealAnswer,
  saveQuiz,
  score,
  setHint,
  setShuffle,
  submitAnswer,
  type QuizProgress,
  QUIZ_SIZE,
} from '../modes/quiz';
import { actions, useApp } from '../state/store';
import { useServices } from './context';
import { IconCheck, IconChevron, IconClose, IconReset, IconTooth } from './icons';

export function QuizMode() {
  const m = useT();
  const lang = useLang();
  const { engine, registry } = useServices();
  const selectedId = useApp((s) => s.selectedId);
  const [session, setSession] = useState<QuizProgress>(() => loadSavedQuiz() ?? createQuiz());
  const [folded, setFolded] = useState(false);
  const nextRef = useRef<HTMLButtonElement>(null);

  // keep the saved session in step with every change (also survives a refresh)
  useEffect(() => {
    saveQuiz(session);
  }, [session]);

  // the engine packs the board in the session's slot order while shuffling is on
  useEffect(() => {
    actions.setQuizBoardOrder(session.shuffle ? session.board : null);
    return () => actions.setQuizBoardOrder(null);
  }, [session.shuffle, session.board]);

  const leave = () => switchMode(QUIZ_MODE, EXPLORE_MODE, { registry, engine });

  const fdi = currentFdi(session);
  const finished = fdi === null;
  const tooth = fdi !== null ? registry.get(`tooth-${fdi}`) : undefined;
  const name = tooth !== undefined ? nameOf(tooth, lang) : '';
  const submitted = fdi !== null && isSubmitted(session);
  const revealed = fdi !== null && isRevealed(session);
  const correct = submitted && isCorrect(session);
  const answerFdi = !submitted && selectedId !== null ? registry.get(selectedId)?.toothFdi ?? null : null;
  const hint = !submitted && session.hint && fdi !== null ? QUIZ_HINTS[lang][typeOf(fdi)] : null;
  // the user's own pick when it was wrong, so the feedback names both teeth
  const pickedFdi = submitted && !revealed && !correct ? session.answers[session.index] : null;
  const pickedTooth = pickedFdi !== null ? registry.get(`tooth-${pickedFdi}`) : undefined;
  // board slots in reading order (upper teeth, then lower), for picking without a pointer;
  // the options name only a position, never a tooth
  const slots = session.shuffle ? session.board : boardReadingOrder(session.board);
  const slotIndex = answerFdi !== null ? slots.indexOf(answerFdi) : -1;

  // answering or giving up swaps the submit button for the next one: keep keyboard focus on it
  const wasSubmitted = useRef(submitted);
  useEffect(() => {
    if (submitted && !wasSubmitted.current) nextRef.current?.focus();
    wasSubmitted.current = submitted;
  }, [submitted]);

  const onPick = () => {
    if (fdi === null || submitted || answerFdi === null) return;
    setSession((s) => submitAnswer(s, answerFdi));
    // reveal: highlight the correct tooth on the board
    actions.select(`tooth-${fdi}`);
  };
  const onReveal = () => {
    if (fdi === null || submitted) return;
    setSession((s) => revealAnswer(s));
    actions.select(`tooth-${fdi}`);
  };
  const onNext = () => {
    if (fdi === null) return;
    actions.select(null);
    setSession((s) => advance(s));
  };
  const onRestart = () => {
    clearSavedQuiz();
    actions.select(null);
    setSession(() => createQuiz());
  };

  return (
    <>
      {!finished && (
        <div className="ds-quiz-prompt" role="status" aria-live="polite">
          <span className="ds-quiz-prompt-label">
            <span className="sr-only">{m.quizQuestion}: </span>
            {m.quizFind}
          </span>
          <strong className="ds-quiz-prompt-name">{name}</strong>
        </div>
      )}

      <section className={`ds-panel ds-quiz${folded ? ' is-folded' : ''}`} aria-label={m.quizTitle}>
        <header className="ds-quiz-head">
          <div className="ds-quiz-head-main">
            <h2 className="ds-quiz-title">
              <IconTooth size={17} />
              <span>{m.quizTitle}</span>
            </h2>
            <div className="ds-quiz-head-actions">
              <button
                type="button"
                className="ds-quiz-restart"
                aria-label={m.quizRestart}
                title={m.quizRestart}
                onClick={onRestart}
              >
                <IconReset size={15} />
              </button>
              <button
                type="button"
                className="ds-quiz-fold"
                aria-expanded={!folded}
                aria-label={folded ? m.quizFoldOpen : m.quizFoldClose}
                onClick={() => setFolded((v) => !v)}
              >
                <IconChevron size={16} />
              </button>
              <button type="button" className="ds-quiz-exit" aria-label={m.quizExit} onClick={leave}>
                {m.quizExit}
              </button>
            </div>
          </div>
          <span className="ds-quiz-meta">
            <span className="ds-quiz-progress">{m.quizProgress(Math.min(session.index + 1, QUIZ_SIZE), QUIZ_SIZE)}</span>
            <span className="ds-quiz-score">{m.quizScore(score(session), answeredCount(session))}</span>
          </span>
        </header>

        <div className="ds-quiz-body">
          {finished ? (
            <div className="ds-quiz-done">
              <h3>{m.quizComplete}</h3>
              <p>{m.quizCompleteBody(score(session), QUIZ_SIZE)}</p>
              <div className="ds-quiz-actions">
                <button type="button" className="ds-primary" onClick={onRestart}>
                  <IconReset size={15} />
                  {m.quizRestart}
                </button>
                <button type="button" className="ds-secondary" onClick={leave}>{m.quizExit}</button>
              </div>
            </div>
          ) : (
            <>
              <p
                className="ds-quiz-guide"
                role="status"
                aria-live="polite"
                data-state={submitted ? (revealed ? 'revealed' : correct ? 'ok' : 'ko') : answerFdi !== null ? 'picked' : 'idle'}
              >
                {submitted ? (
                  revealed ? (
                    m.quizRevealed
                  ) : correct ? (
                    <><IconCheck size={15} /> {m.quizCorrect}</>
                  ) : (
                    <><IconClose size={15} /> {m.quizIncorrect}</>
                  )
                ) : answerFdi !== null ? (
                  m.quizSelected
                ) : (
                  m.quizPickInstruction
                )}
              </p>

              {submitted && fdi !== null && tooth !== undefined && (
                <p className="ds-quiz-answer" role="status" data-state={correct ? 'ok' : 'ko'}>
                  {pickedFdi !== null && pickedTooth !== undefined && (
                    <span className="ds-quiz-picked">{m.quizYourPick(nameOf(pickedTooth, lang), pickedFdi)}</span>
                  )}
                  <span>{m.quizAnswerWas(name, fdi)}</span>
                </p>
              )}

              {!submitted && (
                <label className="ds-quiz-slot">
                  <span>{m.quizPickByPosition}</span>
                  <select
                    className="ds-study-select"
                    value={slotIndex >= 0 ? String(slotIndex) : ''}
                    onChange={(e) => {
                      const i = Number(e.currentTarget.value);
                      if (e.currentTarget.value !== '' && slots[i] !== undefined) actions.select(`tooth-${slots[i]}`);
                    }}
                  >
                    <option value="" disabled>{m.quizPickPlaceholder}</option>
                    {slots.map((_, i) => (
                      <option key={i} value={String(i)}>{m.quizSlot(i < 16, (i % 16) + 1)}</option>
                    ))}
                  </select>
                </label>
              )}

              <div className="ds-quiz-tools">
                <button
                  type="button"
                  className="ds-hint-toggle"
                  aria-pressed={session.hint}
                  onClick={() => setSession((s) => setHint(s, !s.hint))}
                >
                  <span>{m.quizHint}</span>
                  <span className="ds-hint-state">{session.hint ? m.quizHintOn : m.quizHintOff}</span>
                </button>
                <button
                  type="button"
                  className="ds-hint-toggle"
                  aria-pressed={session.shuffle}
                  title={m.quizShuffleTitle}
                  onClick={() => setSession((s) => setShuffle(s, !s.shuffle))}
                >
                  <span>{m.quizShuffle}</span>
                  <span className="ds-hint-state">{session.shuffle ? m.quizShuffleOn : m.quizShuffleOff}</span>
                </button>
                {!submitted && (
                  <button type="button" className="ds-quiz-reveal" title={m.quizShowAnswerTitle} onClick={onReveal}>
                    {m.quizShowAnswer}
                  </button>
                )}
              </div>

              {hint !== null && (
                <p className="ds-hint-text">
                  <span>{hint}</span>
                  <em>{m.quizDraft}</em>
                </p>
              )}

              <p className="ds-quiz-inspect">{m.quizInspectHint}</p>

              <div className="ds-quiz-actions">
                {submitted ? (
                  <button type="button" className="ds-primary" ref={nextRef} onClick={onNext}>
                    {session.index + 1 >= QUIZ_SIZE ? m.quizFinish : m.quizNext}
                    <IconChevron size={14} />
                  </button>
                ) : (
                  <button type="button" className="ds-primary" disabled={answerFdi === null} onClick={onPick}>
                    {m.quizSubmit}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}

/** The unshuffled board as the engine lays it out: each arch in reading order (viewer's left first). */
function boardReadingOrder(board: readonly number[]): number[] {
  const byRank = (a: number, b: number) => archOrder(a) - archOrder(b);
  return [...board.filter((f) => f < 30).sort(byRank), ...board.filter((f) => f >= 30).sort(byRank)];
}
