import { useState } from 'react';
import { hyoidAttachments, HYOID_SOURCES, type HyoidGroup } from '../content/hyoidAttachments';
import { useLang } from '../i18n';
import { explorationText } from '../i18n/exploration';

/** Attachment map in the detail panel; the current atlas does not contain these soft tissues. */
export function HyoidConnections() {
  const lang = useLang();
  const t = explorationText(lang);
  const [group, setGroup] = useState<HyoidGroup>('skull');
  return <section className="ds-hyoid" aria-label={t.hyoidTitle}>
    <h3 className="ds-label-sm">{t.hyoidTitle}</h3>
    <div className="ds-segmented ds-segmented--fill" role="radiogroup" aria-label={t.hyoidTitle}>
      {(['skull', 'jaw', 'below'] as const).map((g) => <button type="button" key={g} role="radio" aria-checked={group === g} className={group === g ? 'is-active' : ''} onClick={() => setGroup(g)}>{t[g]}</button>)}
    </div>
    <svg viewBox="0 0 360 236" role="img" aria-label={`${t.hyoidTitle}: ${t[group]}`} className="ds-hyoid-map">
      <g className={`ds-hyoid-path${group === 'skull' ? ' is-active' : ''}`}>
        <path d="M72 48 C70 95 119 109 157 130" strokeDasharray="5 4" className="is-ligament" />
        <path d="M95 48 C111 93 132 106 162 130" />
      </g>
      <g className={`ds-hyoid-path${group === 'jaw' ? ' is-active' : ''}`}>
        <path d="M276 48 C264 90 234 111 203 130" />
        <path d="M253 48 C237 85 223 109 198 130" />
        <path d="M57 48 C69 113 110 151 149 147 M211 147 C249 130 282 93 298 48" />
      </g>
      <g className={`ds-hyoid-path${group === 'below' ? ' is-active' : ''}`}>
        <path d="M155 153 L104 199 M180 153 L180 199 M205 153 L256 199" />
      </g>
      <g className="ds-hyoid-node"><rect x="9" y="14" width="134" height="34" rx="10" /><text x="76" y="35">{t.temporal}</text></g>
      <g className="ds-hyoid-node"><rect x="217" y="14" width="134" height="34" rx="10" /><text x="284" y="35">{t.mandible}</text></g>
      <g className="ds-hyoid-node is-hyoid"><rect x="127" y="126" width="106" height="32" rx="12" /><text x="180" y="147">{t.hyoid}</text></g>
      <g className="ds-hyoid-node"><rect x="7" y="199" width="346" height="31" rx="10" /><text x="180" y="219">{t.neck}</text></g>
    </svg>
    <dl className="ds-attachments">
      {hyoidAttachments(lang).filter((a) => a.group === group).map((a) => <div key={a.name}><dt>{a.name}</dt><dd>{a.description}</dd></div>)}
    </dl>
    <p className="ds-evidence">{t.hyoidNote}</p>
    <p className="ds-evidence">{HYOID_SOURCES.map((s, i) => <span key={s.url}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></span>)}</p>
  </section>;
}
