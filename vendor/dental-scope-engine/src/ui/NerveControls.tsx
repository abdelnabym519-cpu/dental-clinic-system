import { NERVE_VIEWS } from '../anatomy/nerveViews';
import { useLang } from '../i18n';
import { explorationText } from '../i18n/exploration';
import { actions, useApp } from '../state/store';

export function NerveControls() {
  const view = useApp((s) => s.nerveView);
  const side = useApp((s) => s.nerveSide);
  const passage = useApp((s) => s.passageIds.length > 0);
  const t = explorationText(useLang());
  return <details className="ds-nerve-controls">
    <summary className="ds-label-sm">{t.nerveGroups}</summary>
    <select id="ds-nerve-view" aria-label={t.nerveGroups} value={passage ? 'passage' : view} onChange={(e) => actions.setNerveView(e.target.value as typeof view)}>
      {passage && <option value="passage" disabled>{t.passageActive}</option>}
      {NERVE_VIEWS.map((v) => <option key={v} value={v}>{t[v]}</option>)}
    </select>
    <div className="ds-segmented ds-segmented--fill" role="radiogroup" aria-label={t.nerveSide}>
      {(['both', 'right', 'left'] as const).map((s) => <button key={s} type="button" role="radio" aria-checked={!passage && side === s} className={!passage && side === s ? 'is-active' : ''} onClick={() => actions.setNerveSide(s)}>{t[s]}</button>)}
    </div>
    {passage && <p className="ds-evidence">{t.passageActive}</p>}
  </details>;
}
