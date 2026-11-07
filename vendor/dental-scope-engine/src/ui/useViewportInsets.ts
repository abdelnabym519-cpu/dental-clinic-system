import { useEffect } from 'react';
import type { Engine } from '../engine/Engine';
import { useApp } from '../state/store';
import { COMPACT_LAYOUT } from '../app/viewport';

/** Measure UI occlusion once here; the engine only receives viewport insets. */
export function useViewportInsets(engine: Engine) {
  const selected = useApp(s => !!s.selectedId);
  const dissect = useApp(s => s.dissectFdi !== null);
  const sheet = useApp(s => s.mobileSheet);
  const quiz = useApp(s => s.mode === 'quiz');
  const lang = useApp(s => s.lang);
  const laidOut = useApp((s) => s.explodePhase === 2);
  const detailHidden = useApp((s) => s.collapsed.detail);
  const dockHidden = useApp((s) => s.collapsed.dock);
  const layersHidden = useApp((s) => s.collapsed.layers);
  const jawControls = useApp((s) => s.jawControls);
  const developmentStage = useApp((s) => s.developmentStage);
  const studyView = useApp((s) => s.studyView);
  const guideOpen = useApp((s) => s.guideOpen);
  const guideCollapsed = useApp(s => s.guideCollapsed);
  // keep the focused anatomy clear of the panels that cover the canvas
  useEffect(() => {
    const ui = document.querySelector<HTMLElement>('.ds-ui');
    const compact = window.matchMedia(COMPACT_LAYOUT);
    let frame = 0;
    const visibleRect = (selector: string) => {
      const element = ui?.querySelector<HTMLElement>(selector);
      if (!element || (!compact.matches && element.classList.contains('is-collapsed'))) return null;
      const rect = element.getBoundingClientRect();
      return rect.width && rect.height ? rect : null;
    };
    const update = () => {
      frame = 0;
      if (!ui) return;
      const bounds = ui.getBoundingClientRect();
      document.documentElement.style.setProperty('--visual-height', `${window.visualViewport?.height ?? bounds.height}px`);
      document.documentElement.style.setProperty('--visual-top', `${window.visualViewport?.offsetTop ?? 0}px`);
      const toolbar = visibleRect('.ds-dock');
      const bar = visibleRect('.ds-mobile-bar');
      const panel = compact.matches ? visibleRect('.ds-layers.is-mobile-open, .ds-detail.is-mobile-open') : visibleRect('.ds-detail');
      const quizSheet = compact.matches ? visibleRect('.ds-quiz:not(.is-folded)') : null;
      // On desktop the quiz card is a left sidebar, not a bottom sheet: keep the board clear of it.
      const quizCard = !compact.matches ? visibleRect('.ds-quiz') : null;
      // The quiz question banner sits top-centre over the board on every layout.
      const quizPrompt = visibleRect('.ds-quiz-prompt');
      const sideSheet = compact.matches && window.matchMedia('(orientation: landscape) and (max-height: 600px)').matches;
      const bottoms = [toolbar, bar, ...(!sideSheet && compact.matches ? [panel, quizSheet] : [])].filter((r): r is DOMRect => !!r);
      const bottom = Math.max(0, ...bottoms.map((r) => bounds.bottom - r.top + 12));
      const side = sideSheet ? panel ?? (sheet === 'tools' ? toolbar : null) : !compact.matches ? panel : null;
      let right = side ? bounds.right - side.left + 12 : 0;
      const layers = !compact.matches && (dissect || studyView === 'nerves') ? visibleRect('.ds-layers') : null;
      let left = layers ? layers.right - bounds.left + 12 : 0;
      if (quizCard) left = Math.max(left, quizCard.right - bounds.left + 12);
      // Landscape tool sheets occupy the side, not the lower half of the model.
      const clearance = sideSheet && sheet === 'tools' ? (bar ? bounds.bottom - bar.top + 12 : 0) : bottom;
      ui.style.setProperty('--dock-clearance', `${Math.max(64, bottom + 12)}px`);
      const tour = document.querySelector<HTMLElement>('.ds-tour-card');
      const tourBounds = tour?.getBoundingClientRect();
      let top = quizPrompt ? Math.max(0, quizPrompt.bottom - bounds.top + 12) : 0;
      let tourBottom = clearance;
      if (tour && tourBounds?.width && tourBounds.height) {
        if (!compact.matches) {
          if (tour.dataset.position === 'left') left = Math.max(left, tourBounds.right + 12);
          else right = Math.max(right, bounds.right - tourBounds.left + 12);
        } else if (sideSheet) left = Math.max(left, tourBounds.right + 12);
        else if (tour.dataset.position === 'bottom') tourBottom = Math.max(tourBottom, bounds.bottom - tourBounds.top + 12);
        else top = Math.max(top, tourBounds.bottom + 12);
      }
      engine.setInsets(Math.min(right, bounds.width - 100), Math.min(tourBottom, bounds.height - 100), Math.min(left, bounds.width - 100), Math.max(0, Math.min(top, bounds.height - tourBottom - 80)));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    const observer = new ResizeObserver(schedule);
    if (ui) observer.observe(ui);
    for (const element of ui?.querySelectorAll('.ds-dock, .ds-layers, .ds-detail, .ds-mobile-bar, .ds-quiz, .ds-quiz-prompt') ?? []) observer.observe(element);
    const tour = document.querySelector<HTMLElement>('.ds-tour-card');
    if (tour) observer.observe(tour);
    const tourPosition = new MutationObserver(schedule);
    if (tour) tourPosition.observe(tour, { attributes: true, attributeFilter: ['data-position'] });
    compact.addEventListener('change', schedule);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      tourPosition.disconnect();
      compact.removeEventListener('change', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, [engine, selected, dissect, laidOut, sheet, quiz, detailHidden, dockHidden, layersHidden, jawControls, developmentStage, studyView, lang, guideOpen, guideCollapsed]);

}
