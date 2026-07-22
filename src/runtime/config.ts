import * as path from 'path';
import { loadManifest } from '../core/manifest';
import type { Manifest } from '../types';
import type { PartialRuntimeConfig, RuntimeConfig, RuntimePreset } from './types';

export const PRESET_DEFAULTS: Record<string, RuntimeConfig> = {
  software: {
    preset: 'software',
    defaultScope: 'project',
    branchAware: true,
    working: { ttl: '12h' },
    episodic: { capture: 'automatic' },
    durable: { format: 'markdown', confirmation: 'required' },
  },
  research: {
    preset: 'research',
    defaultScope: 'project',
    branchAware: false,
    working: { ttl: '24h' },
    episodic: { capture: 'manual' },
    durable: { format: 'markdown', confirmation: 'required' },
  },
  novel: {
    preset: 'novel',
    defaultScope: 'project',
    branchAware: false,
    working: { ttl: '24h' },
    episodic: { capture: 'manual' },
    durable: { format: 'markdown', confirmation: 'required' },
  },
};

export function loadRuntimeConfig(root: string, preset?: RuntimePreset, overrides?: PartialRuntimeConfig): RuntimeConfig {
  const pmemPath = path.join(root, '.pmem');
  const manifest = loadManifest(pmemPath);
  const manifestPreset = inferPreset(manifest);
  const selectedPreset = preset ?? manifestPreset ?? 'software';
  const defaults = PRESET_DEFAULTS[selectedPreset] ?? { ...PRESET_DEFAULTS.software, preset: selectedPreset };
  const manifestMemory = extractManifestMemory(manifest);
  return deepMerge(deepMerge(defaults, manifestMemory), overrides ?? {}) as RuntimeConfig;
}

function inferPreset(manifest: Manifest | null): RuntimePreset | undefined {
  const domain = manifest?.project?.domain;
  if (typeof domain === 'string' && domain.trim()) return domain.trim() as RuntimePreset;
  return undefined;
}

function extractManifestMemory(manifest: Manifest | null): PartialRuntimeConfig {
  const memory = (manifest as any)?.memory;
  const result: PartialRuntimeConfig = {};
  if (memory?.default_scope) result.defaultScope = memory.default_scope;
  if (typeof memory?.branch_aware === 'boolean') result.branchAware = memory.branch_aware;
  if (memory?.working?.ttl) result.working = { ttl: memory.working.ttl };
  if (memory?.episodic?.capture) result.episodic = { capture: memory.episodic.capture };
  if (memory?.durable) {
    result.durable = {
      ...(memory.durable.format ? { format: memory.durable.format } : {}),
      ...(memory.durable.confirmation ? { confirmation: memory.durable.confirmation } : {}),
    } as Partial<RuntimeConfig['durable']>;
  }
  return result;
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
