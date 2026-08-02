import type { PartialRuntimeConfig, RuntimeConfig, RuntimePreset } from './types';

export const PRESET_DEFAULTS: Record<string, RuntimeConfig> = {
  default: {
    preset: 'default',
    defaultScope: 'workspace',
    branchAware: false,
    working: { ttl: '24h' },
    episodic: { capture: 'manual' },
    durable: { format: 'markdown', confirmation: 'required' },
  },
};

export function loadRuntimeConfig(preset?: RuntimePreset, overrides?: PartialRuntimeConfig): RuntimeConfig;
/** @deprecated Root is ignored; retained only as a source-compatible call shape. */
export function loadRuntimeConfig(_root: string, preset?: RuntimePreset, overrides?: PartialRuntimeConfig): RuntimeConfig;
export function loadRuntimeConfig(
  presetOrRoot?: RuntimePreset,
  overridesOrPreset?: PartialRuntimeConfig | RuntimePreset,
  legacyOverrides?: PartialRuntimeConfig,
): RuntimeConfig {
  const calledWithRoot = typeof overridesOrPreset === 'string';
  const preset = calledWithRoot ? overridesOrPreset : presetOrRoot;
  const overrides = calledWithRoot ? legacyOverrides : overridesOrPreset as PartialRuntimeConfig | undefined;
  const selectedPreset = preset ?? 'default';
  const defaults = PRESET_DEFAULTS[selectedPreset] ?? { ...PRESET_DEFAULTS.default, preset: selectedPreset };
  return deepMerge(defaults, overrides ?? {}) as RuntimeConfig;
}

function deepMerge<T>(base: T, override: PartialRuntimeConfig): T {
  const out: any = Array.isArray(base) ? [...base] : { ...(base as any) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) continue;
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value as PartialRuntimeConfig);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
