import type { CapabilitySet, MemoryCapability, MemoryProposal, RuntimeConfig } from './types';

interface LegacyPolicyCard {
  filePath?: string;
  body: string;
  frontmatter: {
    id: string;
    type: string;
    updated?: string;
    freshness?: { ttl?: string };
  };
}

export interface AgentQuota {
  maxObservations: number;
  maxCards: number;
  currentObs: number;
  currentCards: number;
}

export const DEFAULT_READ_CAPABILITIES: MemoryCapability[] = ['memory.read', 'memory.search'];

export class PolicyEngine {
  readonly agentQuotas: Map<string, AgentQuota> = new Map();
  private capabilities: CapabilitySet[] = [];

  constructor(private readonly config: RuntimeConfig, capabilities: CapabilitySet[] = []) {
    this.capabilities = capabilities ?? [];
  }

  setQuota(principal: string, maxObservations: number, maxCards: number): void {
    this.agentQuotas.set(principal, { maxObservations, maxCards, currentObs: 0, currentCards: 0 });
  }

  checkQuota(principal: string, operation: 'observe' | 'capture'): { allowed: boolean; remaining: number } {
    const quota = this.agentQuotas.get(principal);
    if (!quota) return { allowed: true, remaining: Infinity };
    if (operation === 'observe') {
      if (quota.currentObs >= quota.maxObservations) return { allowed: false, remaining: 0 };
      quota.currentObs++;
      return { allowed: true, remaining: quota.maxObservations - quota.currentObs };
    }
    if (quota.currentCards >= quota.maxCards) return { allowed: false, remaining: 0 };
    quota.currentCards++;
    return { allowed: true, remaining: quota.maxCards - quota.currentCards };
  }

  resetQuotas(): void {
    this.agentQuotas.clear();
  }

  registerCapabilities(caps: CapabilitySet[]): void {
    this.capabilities = caps ?? [];
  }

  checkCapability(principal: string, capability: MemoryCapability, scope: string): boolean {
    if (this.capabilities.length === 0) return DEFAULT_READ_CAPABILITIES.includes(capability);
    for (const set of this.capabilities) {
      if (set.principal !== principal) continue;
      if (set.capabilities.includes('memory.admin')) return true;
      if (!this.scopeMatches(set.scope, scope)) continue;
      if (set.capabilities.includes(capability)) return true;
    }
    return false;
  }

  private scopeMatches(parent: string, target: string): boolean {
    if (parent === target) return true;
    return target.startsWith(parent + ':');
  }

  requiresConfirmation(memory: MemoryProposal): boolean {
    this.checkProposalCapability(memory);
    if (this.config.durable.confirmation === 'never') return false;
    if (this.config.durable.confirmation === 'required') return true;
    return memory.type === 'capture' || memory.type === 'commit';
  }

  private checkProposalCapability(memory: MemoryProposal): void {
    if (this.capabilities.length === 0) return;
    const requiredCap = this.proposalTypeToCapability(memory.type);
    if (!requiredCap) return;
    // Validate the *calling* principal only — never grant on the basis that
    // some other registered principal happens to hold the capability.
    const principal = typeof memory.metadata?.principal === 'string' && memory.metadata.principal.trim()
      ? memory.metadata.principal.trim()
      : 'default';
    if (this.checkCapability(principal, requiredCap, memory.scope)) return;
    throw new Error(
      `Capability '${requiredCap}' is required for '${memory.type}' on scope '${memory.scope}', but principal '${principal}' does not have it.`
    );
  }

  private proposalTypeToCapability(type: string): MemoryCapability | null {
    switch (type) {
      case 'observe': return 'memory.observe';
      case 'forget': return 'memory.forget';
      case 'commit': return 'memory.commit';
      case 'capture': return 'memory.commit';
      case 'supersede': return 'memory.supersede';
      default: return null;
    }
  }

  shouldDistill(card: LegacyPolicyCard, traceCount: number): boolean {
    if (card.frontmatter.type !== 'trace') return false;
    return traceCount >= 20;
  }

  isExpired(card: LegacyPolicyCard): boolean {
    const ttl = card.frontmatter.freshness?.ttl ?? this.config.working.ttl;
    const updated = card.frontmatter.updated;
    if (!updated) return false;
    const ttlMs = parseDurationMs(ttl);
    if (!ttlMs) return false;
    const updatedMs = Date.parse(updated);
    if (!Number.isFinite(updatedMs)) return false;
    return Date.now() - updatedMs > ttlMs;
  }

  isDuplicate(proposal: MemoryProposal, existing: LegacyPolicyCard[]): boolean {
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

export function getDistillUrgency(traceCount: number): 'none' | 'suggest' | 'recommended' | 'urgent' {
  if (traceCount < 10) return 'none';
  if (traceCount < 20) return 'suggest';
  if (traceCount < 40) return 'recommended';
  return 'urgent';
}
