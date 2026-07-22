import type { MemoryCard } from '../types';
import type { MemoryProposal, RuntimeConfig } from './types';

export class PolicyEngine {
  constructor(private readonly config: RuntimeConfig) {}

  requiresConfirmation(memory: MemoryProposal): boolean {
    if (this.config.durable.confirmation === 'never') return false;
    if (this.config.durable.confirmation === 'required') return true;
    return memory.type === 'capture' || memory.type === 'commit';
  }

  shouldDistill(card: MemoryCard, traceCount: number): boolean {
    if (card.frontmatter.type !== 'trace') return false;
    return traceCount >= 20;
  }

  isExpired(card: MemoryCard): boolean {
    const ttl = card.frontmatter.freshness?.ttl ?? this.config.working.ttl;
    const updated = card.frontmatter.updated;
    if (!updated) return false;
    const ttlMs = parseDurationMs(ttl);
    if (!ttlMs) return false;
    const updatedMs = Date.parse(updated);
    if (!Number.isFinite(updatedMs)) return false;
    return Date.now() - updatedMs > ttlMs;
  }

  isDuplicate(proposal: MemoryProposal, existing: MemoryCard[]): boolean {
    const normalized = normalize(proposal.summary ?? proposal.content ?? '');
    if (!normalized) return false;
    return existing.some(card => normalize(card.frontmatter.id) === normalized || normalize(card.body) === normalized);
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function parseDurationMs(value: string): number | null {
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d|w)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return amount * factor[unit];
}
