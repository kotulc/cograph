/** .cograph.json schema (Zod) and load/save helpers. */

import { z } from 'zod';
import { IConfigStore, CoGraphConfig } from './types.js';


// ── Schema ────────────────────────────────────────────────────────────────────

const VectorCacheSchema = z.object({
  updatedAt: z.string(),
  chunks: z.record(z.array(z.number())),
  representatives: z.record(z.array(z.number())),
});

export const ConfigSchema = z.object({
  version: z.number().int().positive(),
  activeLayout: z.enum(['structural', 'semantic']),
  metric: z.string(),
  maxDepth: z.number().int().nonnegative(),
  labelOverrides: z.record(z.string()),
  membershipOverrides: z.record(z.string()),
  dismissedSuggestions: z.array(z.string()),
  acceptedEdges: z.array(z.string()),
  vectorCache: VectorCacheSchema,
});


// ── Defaults ──────────────────────────────────────────────────────────────────

export const CONFIG_DEFAULTS: CoGraphConfig = {
  version: 1,
  activeLayout: 'structural',
  metric: 'language',
  maxDepth: 4,
  labelOverrides: {},
  membershipOverrides: {},
  dismissedSuggestions: [],
  acceptedEdges: [],
  vectorCache: { updatedAt: '', chunks: {}, representatives: {} },
};

export function mergeDefaults(partial: Partial<CoGraphConfig>): CoGraphConfig {
  return { ...CONFIG_DEFAULTS, ...partial };
}


// ── I/O ───────────────────────────────────────────────────────────────────────

export async function loadConfig(store: IConfigStore): Promise<CoGraphConfig> {
  const raw = await store.load();
  if (!raw) return { ...CONFIG_DEFAULTS };
  const result = ConfigSchema.safeParse(raw);
  return result.success ? result.data : { ...CONFIG_DEFAULTS };
}

export async function saveConfig(store: IConfigStore, config: CoGraphConfig): Promise<void> {
  await store.save(config);
}
