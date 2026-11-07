import { canalFrequency, formatPercent, frequencyContext } from '../content/canalFrequency';
import { useLang } from '../i18n';
import { FEEDBACK_TEXT } from '../i18n/feedback';

export function CanalFrequency({ fdi }: { fdi: number }) {
  const lang = useLang();
  const t = FEEDBACK_TEXT[lang];
  const item = canalFrequency(fdi);
  if (!item) return null;
  return <details className="ds-detail-block ds-frequency">
    <summary className="ds-label-sm">{t.canalFrequency}</summary>
    <table><thead><tr><th scope="col">{t.canals}</th><th scope="col">{t.frequency}</th></tr></thead>
      <tbody>{item.rows.map((r) => <tr key={r.canals}><th scope="row">{r.canals}</th><td>{formatPercent(r.percent, lang)}</td></tr>)}</tbody></table>
    <p className="ds-evidence">{t.sample}: {item.n}. {frequencyContext(fdi, lang).join(' ')}</p>
    <p className="ds-evidence">{t.evidenceNote} {t.modeledNote}</p>
    <a className="ds-link-btn" href={item.source.url} target="_blank" rel="noopener noreferrer">{t.source}: {item.source.citation}</a>
  </details>;
}
