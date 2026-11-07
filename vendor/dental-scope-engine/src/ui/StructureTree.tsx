/**
 * Hierarchy browser (role="tree"): the accessible, non-canvas path to every structure.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { formatTooth } from '../anatomy/notation';
import { typeLabel } from '../i18n/anatomy';
import { nameOf, useT, type Lang } from '../i18n';
import type { Registry } from '../anatomy/registry';
import type { Structure } from '../anatomy/types';
import { navigate } from '../app/router';
import { actions, useApp } from '../state/store';
import { useServices } from './context';
import { IconChevron, IconEye, IconEyeOff } from './icons';

export function StructureTree() {
  const { registry } = useServices();
  const selectedId = useApp((s) => s.selectedId);
  const [open, setOpen] = useState<Set<string>>(() => new Set(['dental-anatomy', 'maxilla', 'mandible']));
  const ref = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState(selectedId ?? registry.require(registry.rootId).children[0]);

  // Expand ancestors to reveal the selection while rendering, so the scroll
  // effect below finds the row already mounted.
  const [revealed, setRevealed] = useState<string | null | undefined>(undefined);
  if (revealed !== selectedId) {
    setRevealed(selectedId);
    if (selectedId) {
      setActiveId(selectedId);
      const anc = registry.ancestors(selectedId).map((a) => a.id);
      if (!anc.every((a) => open.has(a))) setOpen(new Set([...open, ...anc]));
    }
  }
  useEffect(() => {
    if (!selectedId) return;
    requestAnimationFrame(() => ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }, [selectedId, registry]);

  const toggle = (id: string) => setOpen((o) => withOpen(o, id, !o.has(id)));

  const root = registry.require(registry.rootId);
  const visible = new Set<string>();
  const visit = (id: string, depth: number) => {
    visible.add(id);
    if (open.has(id)) treeChildren(registry, id, depth).forEach(child => visit(child, depth + 1));
  };
  root.children.forEach(id => visit(id, 0));
  // A selected landmark may be omitted from the tree; retain an entry point on its visible ancestor.
  const tabStopId = activeId && visible.has(activeId) ? activeId
    : registry.ancestors(activeId ?? '').find(ancestor => visible.has(ancestor.id))?.id ?? root.children[0];
  const m = useT();
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const id = items[i].dataset.id!;
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items.at(-1)?.focus();
    else if (e.key === 'ArrowRight') {
      if (items[i].getAttribute('aria-expanded') === 'false') setOpen((o) => withOpen(o, id, true));
      else if (items[i].getAttribute('aria-expanded') === 'true') items[i + 1]?.focus();
    } else if (e.key === 'ArrowLeft') {
      if (items[i].getAttribute('aria-expanded') === 'true') setOpen((o) => withOpen(o, id, false));
      else items[i].parentElement?.closest<HTMLElement>('[role="treeitem"]')?.focus();
    } else return;
    e.preventDefault();
  };

  return (
    <div className="ds-tree" role="tree" tabIndex={-1} aria-label={m.treeAria} ref={ref} onKeyDown={onKeyDown}>
      {root.children.map((c) => (
        <TreeNode key={c} id={c} depth={0} open={open} toggle={toggle} activeId={tabStopId} onFocus={setActiveId} />
      ))}
    </div>
  );
}

type TreeNodeProps = {
  id: string;
  depth: number;
  open: Set<string>;
  toggle: (id: string) => void;
  activeId: string | undefined;
  onFocus: (id: string) => void;
};

const TreeNode = memo(function TreeNode({ id, depth, open, toggle, activeId, onFocus }: TreeNodeProps) {
  const { registry, engine } = useServices();
  const s = registry.require(id);
  const selected = useApp((st) => st.selectedId === id);
  const hidden = useApp((st) => !!st.hidden[id]);
  const numbering = useApp((st) => st.numbering);
  const lang = useApp((st) => st.lang);
  const m = useT();
  const children = treeChildren(registry, id, depth);
  const expandable = children.length > 0;
  const isOpen = open.has(id);

  const select = async () => {
    await navigate(() => engine.selectFromUI(id, { focus: true }));
  };

  return (
    <div
      role="treeitem"
      aria-expanded={expandable ? isOpen : undefined}
      aria-selected={selected}
      aria-level={depth + 1}
      data-id={id}
      tabIndex={activeId === id ? 0 : -1}
      onFocus={(e) => {
        e.stopPropagation();
        onFocus(id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.currentTarget.focus();
        void select();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          void select();
        }
      }}
    >
      <div
        className={`ds-tree-row${selected ? ' is-selected' : ''}${hidden ? ' is-hidden' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <button
          type="button"
          tabIndex={-1}
          className={`ds-tree-caret${isOpen ? ' is-open' : ''}`}
          style={{ visibility: expandable ? 'visible' : 'hidden' }}
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus();
            toggle(id);
          }}
          aria-label={isOpen ? m.collapse : m.expand}
        >
          <IconChevron size={12} />
        </button>
        <span className="ds-tree-name">{label(s, lang)}</span>
        {s.tooth && <span className="ds-chip ds-chip--mono ds-chip--sm">{formatTooth(s.tooth.fdi, numbering)}</span>}
        {s.kind !== 'landmark' && (
          <button
            type="button"
            tabIndex={-1}
            className="ds-tree-eye"
            aria-label={hidden ? m.showX(nameOf(s, lang)) : m.hideX(nameOf(s, lang))}
            onClick={(e) => {
              e.stopPropagation();
              e.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus();
              if (hidden) actions.unhide(id);
              else actions.hide(id);
            }}
          >
            {hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
          </button>
        )}
      </div>
      {expandable && isOpen && (
        <div role="group">
          {children.map((c) => (
            <TreeNode key={c} id={c} depth={depth + 1} open={open} toggle={toggle} activeId={activeId} onFocus={onFocus} />
          ))}
        </div>
      )}
    </div>
  );
});

/** Copy of the set of expanded ids with `id` opened or closed. */
function withOpen(open: Set<string>, id: string, isOpen: boolean): Set<string> {
  const next = new Set(open);
  if (isOpen) next.add(id);
  else next.delete(id);
  return next;
}

/** Tree label: teeth drop the arch/side prefix, which the quadrant row above already shows. */
function label(s: Structure, lang: Lang): string {
  if (s.tooth) return typeLabel(s.tooth.type, lang);
  return nameOf(s, lang);
}

/** Match the rendered hierarchy when computing its keyboard entry point. */
function treeChildren(registry: Registry, id: string, depth: number): string[] {
  return registry.require(id).children.filter(child => registry.get(child)?.kind !== 'landmark' || depth > 1);
}
