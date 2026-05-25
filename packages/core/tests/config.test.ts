import { describe, it, expect } from 'vitest';
import { ConfigSchema, mergeDefaults, CONFIG_DEFAULTS } from '../src/config.js';
import { CoGraphConfig } from '../src/types.js';

describe('ConfigSchema', () => {
  it('accepts a valid config', () => {
    const result = ConfigSchema.safeParse(CONFIG_DEFAULTS);
    expect(result.success).toBe(true);
  });

  it('rejects a config missing required fields', () => {
    const result = ConfigSchema.safeParse({ version: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid activeLayout value', () => {
    const bad = { ...CONFIG_DEFAULTS, activeLayout: 'diagonal' };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });
});

describe('mergeDefaults', () => {
  it('fills missing fields with defaults', () => {
    const partial: Partial<CoGraphConfig> = { activeLayout: 'semantic' };
    const merged = mergeDefaults(partial);
    expect(merged.activeLayout).toBe('semantic');
    expect(merged.version).toBe(CONFIG_DEFAULTS.version);
  });
});
