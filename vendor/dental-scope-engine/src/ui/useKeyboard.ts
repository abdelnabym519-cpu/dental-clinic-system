import { navigate } from '../app/router';
import { useEffect } from 'react';
import type { Engine } from '../engine/Engine';
import { actions, getState } from '../state/store';

/** Global shortcuts (ignored while typing in inputs). */
export function useKeyboard(engine: Engine) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (e.key.startsWith('Arrow') && t.closest('[role="tree"], [role="radiogroup"], [role="listbox"]')) return;
      const s = getState();
      if (s.guideOpen) return;
      const sel = s.selectedId;
      const step = Math.PI / 18;
      // letter shortcuts work with or without Shift / Caps Lock
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // In Quiz mode only camera and answer-selection shortcuts stay enabled;
      // everything that reveals names, changes the scene or opens exploration
      // ('i' isolate, 'h' hide, 'g' ghost, 'd' tooth view, 'e' explode,
      // 'c' clip, 'l' labels, '[' ']' dissect) is disabled. '/' still works:
      // opening search leaves Quiz mode first.
      if (s.mode === 'quiz' && !['/', 'Escape', 'f', 'r', '+', '=', '-', '_', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
      switch (key) {
        case '/':
          e.preventDefault();
          actions.openSearch(true);
          break;
        case 'Escape':
          if (s.searchOpen) actions.openSearch(false);
          else if (sel) void navigate(() => actions.select(null));
          else if (s.dissectFdi !== null) void navigate(() => actions.exitDissect());
          else if (s.isolateId) actions.isolate(null);
          break;
        case 'f':
          if (sel) engine.focus(sel);
          break;
        case 'i':
          if (sel) {
            actions.isolate(s.isolateId === sel ? null : sel);
            if (s.isolateId !== sel) requestAnimationFrame(() => engine.focus(sel));
          }
          break;
        case 'h':
          if (sel) actions.hide(sel);
          break;
        case 'g':
          if (sel) actions.toggleGhost(sel);
          break;
        case 'd': {
          const fdi = sel ? engine.registry.get(sel)?.toothFdi : undefined;
          if (fdi !== undefined) {
            void navigate(() => engine.exploreTooth(fdi));
          }
          break;
        }
        case '[':
          actions.setDissectLevel(s.dissectLevel - 1);
          break;
        case ']':
          actions.setDissectLevel(s.dissectLevel + 1);
          break;
        case 'e':
          if (s.developmentStage) break;
          if (s.dissectFdi !== null) actions.setToothExplode(s.toothExplode > 0.5 ? 0 : 1);
          else actions.setExplode(s.explode > 0.5 ? 0 : 1);
          break;
        case 'c':
          if (s.developmentStage) break;
          actions.setClip({ enabled: !s.clip.enabled });
          break;
        case 'l':
          actions.toggleLabels();
          break;
        case 'r':
          engine.resetCamera();
          break;
        case '+':
        case '=':
          engine.zoom(0.8);
          break;
        case '-':
        case '_':
          engine.zoom(1.25);
          break;
        case 'ArrowLeft':
          engine.orbit(-step, 0);
          break;
        case 'ArrowRight':
          engine.orbit(step, 0);
          break;
        case 'ArrowUp':
          engine.orbit(0, -step);
          break;
        case 'ArrowDown':
          engine.orbit(0, step);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);
}
