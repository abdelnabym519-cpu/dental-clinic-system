import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_BY_ID, primaryCategory } from '../anatomy/categories';
import { formatTooth, NUMBERING_LABEL } from '../anatomy/notation';
import { navigate } from '../app/router';
import { nameOf, useT } from '../i18n';
import { search } from '../search/search';
import { actions, useApp } from '../state/store';
import { useServices } from './context';
import { IconClose, IconSearch } from './icons';

export function SearchPanel() {
  const open = useApp((s) => s.searchOpen);
  const guided = useApp((s) => s.guideOpen);
  const numbering = useApp((s) => s.numbering);
  const lang = useApp((s) => s.lang);
  const m = useT();
  const { registry, engine, searchIndex } = useServices();
  const q = useApp((s) => s.searchQuery);
  const setQ = (searchQuery: string) => actions.setSearchQuery(searchQuery);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const results = useMemo(() => (q.trim() ? search(searchIndex, registry, q, numbering, 30) : []), [q, numbering, searchIndex, registry]);

  // Reset the highlight when the panel opens or the query changes, adjusting
  // during render instead of in an effect (react.dev: "adjusting state when a
  // prop changes").
  const [wasOpen, setWasOpen] = useState(open);
  const [prevQuery, setPrevQuery] = useState(q);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setActive(0);
  }
  if (prevQuery !== q) {
    setPrevQuery(q);
    setActive(0);
  }

  useEffect(() => {
    const element = dialog.current!;
    if (open) {
      const previousFocus = document.activeElement;
      // The guided demonstration owns focus and its controls stay above search.
      if (!element.open) { if (guided) element.show(); else element.showModal(); }
      const onTab = (event: KeyboardEvent) => {
        if (guided || event.key !== 'Tab') return;
        const controls = [...element.querySelectorAll<HTMLElement>('input, button:not(:disabled), a[href]')].filter(control => control.checkVisibility());
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      };
      element.addEventListener('keydown', onTab);
      const focusFrame = requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
      return () => {
        cancelAnimationFrame(focusFrame);
        element.removeEventListener('keydown', onTab);
        if (element.open) element.close();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      };
    }
    if (element.open) element.close();
  }, [open, guided]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const tip = m.searchTip(NUMBERING_LABEL[numbering]);

  const choose = async (id: string) => {
    actions.openSearch(false);
    await navigate(() => engine.selectFromUI(id, { focus: true }));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      void choose(results[active].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      actions.openSearch(false);
    }
  };

  return (
    <dialog ref={dialog} className="ds-search-layer" aria-label={m.searchAnatomy}
      onCancel={(e) => { e.preventDefault(); actions.openSearch(false); }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) actions.openSearch(false); }}>
      <div className="ds-search ds-panel">
        <div className="ds-search-field">
          <IconSearch size={18} />
          <input
            data-tour="search-input"
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={m.searchPlaceholder}
            aria-label={m.searchAnatomy}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="ds-search-results"
            aria-activedescendant={results[active] ? `ds-sr-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="ds-icon-btn ds-icon-btn--ghost" onClick={() => actions.openSearch(false)} aria-label={m.closeSearch}>
            <IconClose />
          </button>
        </div>
        {results.length > 0 ? (
          <ul id="ds-search-results" className="ds-search-results" role="listbox" ref={list}>
            {results.map((r, i) => {
              const s = registry.get(r.id)!;
              const cat = primaryCategory(s);
              const catDef = cat ? CATEGORY_BY_ID[cat] : undefined;
              const fdi = s.toothFdi;
              const ctxS = fdi !== undefined && !s.tooth ? registry.get(`tooth-${fdi}`) : registry.get(s.parent ?? '');
              const context = ctxS ? nameOf(ctxS, lang) : undefined;
              return (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- options are not focusable: the combobox input owns all keyboard interaction (aria-activedescendant pattern).
                <li
                  key={r.id}
                  id={`ds-sr-${i}`}
                  data-idx={i}
                  data-tour={`result-${r.id}`}
                  role="option"
                  aria-selected={i === active}
                  className={`ds-search-result${i === active ? ' is-active' : ''}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => void choose(r.id)}
                >
                  <span className="ds-dot" style={{ background: catDef?.color ?? 'var(--faint)' }} aria-hidden="true" />
                  <span className="ds-sr-main">
                    <span className="ds-sr-name">{nameOf(s, lang)}</span>
                    {context && <span className="ds-sr-context">{context}</span>}
                  </span>
                  {fdi !== undefined && <span className="ds-chip ds-chip--mono">{formatTooth(fdi, numbering)}</span>}
                  {r.hint && <span className="ds-sr-hint">{r.hint}</span>}
                </li>
              );
            })}
          </ul>
        ) : q.trim() ? (
          <p className="ds-search-empty">{m.noMatches(q)}</p>
        ) : (
          <div className="ds-search-suggest">
            <p className="ds-label-sm">{m.tryLabel}</p>
            <div className="ds-chip-row">
              {m.suggestions.map((s) => (
                <button key={s} type="button" className="ds-chip ds-chip--button" onClick={() => setQ(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="ds-search-tip">
              {tip[0]} <kbd>fdi</kbd> {tip[1]} <kbd>#</kbd> {tip[2]}
            </p>
          </div>
        )}
      </div>
    </dialog>
  );
}
