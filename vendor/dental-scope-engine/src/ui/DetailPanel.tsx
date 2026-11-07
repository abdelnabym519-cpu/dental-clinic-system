import { STUDY_TEXT } from '../i18n/study';
import { SurfaceFeatureControls } from './SurfaceFeatureControls';
import { useMemo, useState } from 'react';
import { CATEGORY_BY_ID, primaryCategory } from '../anatomy/categories';
import { formatTooth, NUMBERING_SHORT, NUMBERING_SYSTEMS } from '../anatomy/notation';
import type { Structure } from '../anatomy/types';
import { navigate } from '../app/router';
import { resolveContent } from '../content/content';
import { nameOf, useT, type Lang, type Messages } from '../i18n';
import { typeLabel } from '../i18n/anatomy';
import { actions, useApp } from '../state/store';
import { useServices } from './context';
import { IconArrowLeft, IconClose, IconEyeOff, IconFocus, IconGhost, IconIsolate, IconTooth } from './icons';
import { PanelHandle } from './PanelHandle';
import { CanalFrequency } from './CanalFrequency';
import { FEEDBACK_TEXT } from '../i18n/feedback';
import { passageFor } from '../anatomy/passages';
import { HyoidConnections } from './HyoidConnections';
import { developmentNotation, developmentStatus } from '../anatomy/development';
import { DEVELOPMENT_TEXT } from '../i18n/development';
import { interfaceText } from '../i18n/interface';

export function DetailPanel() {
  const { registry, engine } = useServices();
  const selectedId = useApp((s) => s.selectedId);
  const numbering = useApp((s) => s.numbering);
  const isolateId = useApp((s) => s.isolateId);
  const dissectFdi = useApp((s) => s.dissectFdi);
  const ghosted = useApp((s) => (selectedId ? !!s.ghosted[selectedId] : false));
  const mobileOpen = useApp((s) => s.mobileSheet === 'detail');
  const collapsed = useApp((s) => s.collapsed.detail);
  const lang = useApp((s) => s.lang);
  const developmentStage = useApp((s) => s.developmentStage);
  const m = useT();
  const text = interfaceText(lang);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [allChildrenId, setAllChildrenId] = useState<string | null>(null);
  const expanded = expandedId === selectedId;
  const s = selectedId ? registry.get(selectedId) : undefined;
  const content = useMemo(() => (s ? resolveContent(registry, s.id, lang) : null), [registry, s, lang]);
  if (!s || !content) return null;

  const cat = primaryCategory(s) ?? registry.ancestors(s.id).find((a) => a.categories.length)?.categories[0];
  const catDef = cat ? CATEGORY_BY_ID[cat] : undefined;
  const fdi = s.toothFdi;
  const tooth = fdi !== undefined ? registry.get(`tooth-${fdi}`) : undefined;
  const crumbs = registry.ancestors(s.id).reverse().filter((a) => a.id !== registry.rootId);
  const isolated = isolateId === s.id;
  const children = s.children.map((c) => registry.get(c)!).filter(Boolean);

  const go = async (id: string) => {
    await navigate(() => engine.selectFromUI(id, { focus: true }));
  };

  return (
    <aside className={`ds-panel ds-detail${mobileOpen ? ' is-mobile-open' : ''}${collapsed ? ' is-collapsed' : ''}${expanded ? ' is-expanded' : ''}`} aria-label={m.detailsAria(nameOf(s, lang))} aria-live="polite">
      <PanelHandle panel="detail" />
      <button type="button" data-tour="detail-size-toggle" className="ds-detail-expand" aria-expanded={expanded} aria-label={expanded ? text.collapseDetails : text.expandDetails} onClick={() => setExpandedId(expanded ? null : selectedId)}>{expanded ? text.collapseDetails : text.expandDetails}</button>
      <div className="ds-detail-head">
        <span className="ds-detail-bar" style={{ background: catDef?.color ?? 'var(--accent)' }} aria-hidden="true" />
        <div className="ds-eyebrow">{catDef ? m.category[catDef.id] : kindLabel(s, m)}</div>
        <button type="button" className="ds-icon-btn ds-icon-btn--ghost ds-detail-close" onClick={() => void navigate(() => actions.select(null))} aria-label={m.closeDetails}>
          <IconClose />
        </button>
        <h2 className="ds-detail-title">{nameOf(s, lang)}</h2>
        {s.development && <div className="ds-notation">{NUMBERING_SYSTEMS.map((n) => <span key={n} className={`ds-chip ds-chip--mono${numbering === n ? ' is-active' : ''}`}><em>{NUMBERING_SHORT[n]}</em> {developmentNotation(s.development!)[n]}</span>)}</div>}
        {tooth?.tooth && fdi !== undefined && (
          <div className="ds-notation" aria-label={m.toothNotation}>
            {NUMBERING_SYSTEMS.map((n) => (
              <span key={n} className={`ds-chip ds-chip--mono${numbering === n ? ' is-active' : ''}`} title={m.numberingTitleLong[n]}>
                <em>{NUMBERING_SHORT[n]}</em> {formatTooth(fdi, n).replace('#', '')}
              </span>
            ))}
          </div>
        )}
        {crumbs.length > 0 && (
          <nav className="ds-crumbs" aria-label={m.hierarchy}>
            {crumbs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && <span aria-hidden="true"> › </span>}
                <button type="button" data-tour={c.tooth ? 'surface-parent-tooth' : undefined} className="ds-link-btn" onClick={() => void go(c.id)}>
                  {c.tooth ? `${formatTooth(c.tooth.fdi, numbering)} ${shortTooth(c, lang)}` : nameOf(c, lang)}
                </button>
              </span>
            ))}
          </nav>
        )}
      </div>

      <div className="ds-detail-body">
        {content.summary ? <p className="ds-detail-summary" data-tour="tooth-details">{content.summary}</p> : <p className="ds-detail-summary is-muted">{m.noDescription}</p>}
        {s.provenance === 'schematic' && <p className="ds-evidence">{FEEDBACK_TEXT[lang].schematicAnatomy}</p>}
        {s.id.startsWith('development-') && <p className="ds-development-draft">{DEVELOPMENT_TEXT[lang].draft}{s.development && developmentStage ? ` · ${DEVELOPMENT_TEXT[lang].status[developmentStatus(s.development, developmentStage)]}` : ''}</p>}
        {s.kind === 'landmark' && passageFor(registry, s.id).length > 0 && <p className="ds-evidence">{FEEDBACK_TEXT[lang].foramenNote}</p>}
        {content.location && <Section title={FEEDBACK_TEXT[lang].location}>{content.location}</Section>}
        {content.function && <Section title={m.function}>{content.function}</Section>}
        {content.clinical && <Section title={m.clinical}>{content.clinical}</Section>}
        {content.guides.map((g) => (
          <section key={g.title} className="ds-detail-section">
            <h3>{g.title}</h3>
            <dl className="ds-guide">{g.rows.map((r) => <Fact key={r.label} label={r.label} value={r.value} />)}</dl>
          </section>
        ))}
        {s.categories.includes('sinus') && <button type="button" className="ds-chip ds-chip--button" onClick={() => void engine.showStudyView('sinuses', s.id)}>{STUDY_TEXT[lang].sinusView}</button>}
        {s.categories.some(c => c === 'arteries' || c === 'veins') && <button type="button" className="ds-chip ds-chip--button" onClick={() => void engine.showStudyView('vessels', s.id)}>{STUDY_TEXT[lang].vesselView}</button>}
        {s.id === 'hyoid-bone'  && <HyoidConnections />}

        {(content.facts.length > 0 || tooth?.tooth) && (
          <dl className="ds-facts">
            {s.tooth && (
              <>
                <dt>{m.archSide}</dt>
                <dd>
                  {m.arch[s.tooth.arch]} · {m.side[s.tooth.side]}
                </dd>
              </>
            )}
            {content.facts.map((f) => (
              <Fact key={f.label} label={f.label} value={f.value} />
            ))}
            {s.tooth && s.tooth.roots.length > 0 && (
              <Fact label={m.modeledHere} value={modeledSummary(s.tooth.roots, m)} />
            )}
            {s.sourceRef && <Fact label={m.atlasRef} value={s.sourceRef} />}
          </dl>
        )}

        {tooth?.tooth && fdi !== undefined && <SurfaceFeatureControls fdi={fdi} />}
        {s.tooth && <CanalFrequency fdi={s.tooth.fdi} />}
        {content.sources.length > 0 && <p className="ds-evidence">{FEEDBACK_TEXT[lang].source}: {content.sources.map((ref, i) => <span key={ref.url}>{i > 0 && ' · '}<a href={ref.url} target="_blank" rel="noopener noreferrer">{ref.title}</a></span>)}</p>}
        {children.length > 0 && (
          <div className="ds-detail-block">
            <div className="ds-label-sm">{m.contains}</div>
            <div className="ds-chip-row">
              {(allChildrenId === selectedId ? children : children.slice(0, 18)).map((c) => (
                <button key={c.id} type="button" className="ds-chip ds-chip--button" onClick={() => void go(c.id)}>
                  {c.tooth ? `${formatTooth(c.tooth.fdi, numbering)} · ${shortTooth(c, lang)}` : nameOf(c, lang)}
                </button>
              ))}
              {children.length > 18 && <button type="button" className="ds-chip ds-chip--button" aria-expanded={allChildrenId === selectedId} onClick={() => setAllChildrenId(allChildrenId === selectedId ? null : selectedId)}>{allChildrenId === selectedId ? text.showLess : `${text.showAll} (+${children.length - 18})`}</button>}
            </div>
          </div>
        )}
        {content.related.length > 0 && (
          <div className="ds-detail-block">
            <div className="ds-label-sm">{m.related}</div>
            <div className="ds-chip-row">
              {content.related.map((id) => (
                <button key={id} type="button" className="ds-chip ds-chip--button" onClick={() => void go(id)}>
                  {nameOf(registry.get(id)!, lang)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="ds-detail-actions">
        {passageFor(registry, s.id).length > 0 && <button type="button" className="ds-secondary" onClick={() => void engine.showPassage(s.id)}>{FEEDBACK_TEXT[lang].pathView}</button>}
        {s.categories.includes('tmj') && <button type="button" className="ds-secondary" onClick={() => void engine.showJaw(s.id.endsWith('-left') ? 'left' : 'right')}>{FEEDBACK_TEXT[lang].jawMotion}</button>}
        {s.tooth && dissectFdi === s.tooth.fdi ? (
          <button type="button" className="ds-primary" onClick={leaveTooth}>
            <IconArrowLeft /> {m.backToMouth}
          </button>
        ) : s.tooth ? (
          <button type="button" className="ds-primary" data-tour="explore-inside" onClick={() => void enterDissect(s.tooth!.fdi)}>
            <IconTooth /> {m.exploreInside}
          </button>
        ) : (
          <button type="button" className="ds-primary" onClick={() => (isolated ? actions.isolate(null) : isolate(s.id))}>
            <IconIsolate /> {isolated ? m.showSurrounding : m.isolateStructure}
          </button>
        )}
        <div className="ds-action-row">
          <button type="button" className="ds-secondary" onClick={() => engine.focus(s.id)} title={m.focusTitle}>
            <IconFocus size={15} /> {m.focus}
          </button>
          {s.kind !== 'landmark' && (
            <>
              <button type="button" className={`ds-secondary${ghosted ? ' is-active' : ''}`} onClick={() => actions.toggleGhost(s.id)} aria-pressed={ghosted} title={m.ghostTitle}>
                <IconGhost size={15} /> {m.ghost}
              </button>
              <button type="button" className="ds-secondary" onClick={() => actions.hide(s.id)} title={m.hideTitle}>
                <IconEyeOff size={15} /> {m.hide}
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );

  function isolate(id: string) {
    actions.isolate(id);
    requestAnimationFrame(() => engine.focus(id));
  }

  function leaveTooth() {
    const f = dissectFdi!;
    void navigate(() => { actions.exitDissect(); engine.focus(`tooth-${f}`); });
  }

  async function enterDissect(f: number) {
    await navigate(() => engine.exploreTooth(f));
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ds-detail-section">
      <h3>{title}</h3>
      <p>{children}</p>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/** "2 roots · 3 canals" */
function modeledSummary(roots: { canals: string[] }[], m: Messages): string {
  return m.modeledSummary(roots.length, roots.reduce((a, r) => a + r.canals.length, 0));
}

/** A tooth's type without arch and side ("first molar"), for chips next to its number; German keeps its capitals. */
const shortTooth = (s: Structure, lang: Lang) => (s.tooth ? (lang === 'de' ? typeLabel(s.tooth.type, lang) : typeLabel(s.tooth.type, lang).toLowerCase()) : nameOf(s, lang));
function kindLabel(s: Structure, m: Messages) {
  return s.kind === 'landmark' ? m.kind.landmark : s.kind === 'region' ? m.kind.region : m.kind.structure;
}
