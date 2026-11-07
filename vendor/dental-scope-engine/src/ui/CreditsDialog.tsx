import { useEffect, useRef } from 'react';
import { CREDITS_TEXT, CREATOR, ENGINEERS, DENTAL, type Contributor } from '../app/credits';
import { useT } from '../i18n';
import { actions, useApp } from '../state/store';
import { IconClose, IconGitHub, IconLinkedIn } from './icons';

function Names({ people }: { people: Contributor[] }) {
  return (
    <ul className="ds-credits-names">
      {people.map((person) => (
        <li key={person.linkedin}>
          <span>{person.name}</span>
          <span className="ds-credits-links">
            <a href={person.linkedin} target="_blank" rel="noopener noreferrer" aria-label={`${person.name} — LinkedIn`} title="LinkedIn"><IconLinkedIn /></a>
            {person.github && <a href={person.github} target="_blank" rel="noopener noreferrer" aria-label={`${person.name} — GitHub`} title="GitHub"><IconGitHub /></a>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CreditsDialog() {
  const open = useApp((s) => s.creditsOpen);
  const lang = useApp((s) => s.lang);
  const text = CREDITS_TEXT[lang];
  const m = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);
  return (
    <dialog ref={ref} className="ds-about ds-credits ds-panel" aria-labelledby="ds-credits-title"
      onCancel={(event) => { event.preventDefault(); actions.openCredits(false); }}>
      <button type="button" className="ds-icon-btn ds-icon-btn--ghost ds-about-close" onClick={() => actions.openCredits(false)} aria-label={m.close}>
        <IconClose />
      </button>
      <h2 id="ds-credits-title">{text.title}</h2>
      <h3>{text.creator}:</h3>
      <Names people={CREATOR} />
      <h3>{text.engineers}:</h3>
      <Names people={ENGINEERS} />
      <h3>{text.dental}:</h3>
      <Names people={DENTAL} />
      <p className="ds-credits-thanks">{text.thanks}</p>
    </dialog>
  );
}
