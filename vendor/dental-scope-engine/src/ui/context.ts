import { createContext, useContext } from 'react';
import type { Registry } from '../anatomy/registry';
import type { Engine } from '../engine/Engine';
import type { SearchEntry } from '../search/search';

export interface AppServices {
  registry: Registry;
  engine: Engine;
  searchIndex: SearchEntry[];
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesContext missing');
  return s;
}
