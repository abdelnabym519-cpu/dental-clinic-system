import { StrictMode } from 'react';
import { inject } from '@vercel/analytics';
import { createRoot } from 'react-dom/client';
import { Registry } from './anatomy/registry';
import { loadManifest } from './engine/assets';
import { Engine } from './engine/Engine';
import { buildIndex } from './search/search';
import { getState, restorePreferences } from './state/store';
import { App } from './ui/App';
import { ServicesContext } from './ui/context';
import { t } from './i18n';
import '@fontsource/inter-tight/400.css';
import '@fontsource/inter-tight/500.css';
import '@fontsource/inter-tight/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource-variable/source-serif-4/opsz.css';
import './styles/tokens.css';
import './styles/app.css';

// Vercel Web Analytics: page views and visitors (cookieless); only collects on the Vercel deployment
inject();

async function boot() {
  restorePreferences();
  document.documentElement.lang = getState().lang;
  const root = createRoot(document.getElementById('root')!);
  if (!hasWebGL()) {
    root.render(<p className="ds-fatal">{t().fatalWebgl}</p>);
    return;
  }
  root.render(<div className="ds-loading ds-panel" role="status">{t().preparing}</div>);
  const manifest = await loadManifest();
  const registry = new Registry(manifest);
  const engine = new Engine(registry);
  const searchIndex = buildIndex(registry);
  if (import.meta.env.DEV) Object.assign(window, { ds: { registry, engine } });
  root.render(
    <StrictMode>
      <ServicesContext.Provider value={{ registry, engine, searchIndex }}>
        <App />
      </ServicesContext.Provider>
    </StrictMode>,
  );
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

boot().catch((e) => {
  console.error(e);
  const p = document.createElement('p');
  p.className = 'ds-fatal';
  p.textContent = t().fatalStart;
  document.getElementById('root')!.replaceChildren(p);
});
