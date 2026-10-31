import type { OwnedDatabase } from '../db/database';
import type { L3ResolveResult } from '../domain/memory/l3';
import type { L1Memory } from '../domain/memory/l1';
import type { L2Memory } from '../domain/memory/l2';
import type {
  AppendL0Input,
  AppendL0Result,
  L0Message,
  MemoryAccess,
  MemorySpace,
} from '../domain/memory/types';
import { assembleL1 } from '../server/l1';
import { assembleL2 } from '../server/l2';
import { assembleL3 } from '../server/l3';
import { assembleMemory } from '../server/memory';
import type { L3ServiceOptions } from '../service/memory/l3';
import type { PmemMemory } from './contracts';

const MAX_L2_BODY = 1_400;
const MAX_L1_CONTENT = 700;
const MAX_L1_ITEMS = 5;

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export interface PmemRecallDetails {
  cacheHit: boolean;
  mixed: boolean;
  fallback: string;
  complete: boolean;
  truncated: boolean;
  keywords: readonly { term: string; kind: string; weight: number }[];
  l2: readonly { id: string; title: string; summary: string }[];
  l1: readonly { id: string; abstraction: string; content: string }[];
  l0SourceIds: readonly string[];
}

export interface PmemRecallText {
  text: string;
  details: PmemRecallDetails;
}

export function formatRecall(result: L3ResolveResult): PmemRecallText {
  const details: PmemRecallDetails = {
    cacheHit: result.cacheHit,
    mixed: result.mixed,
    fallback: result.fallback,
    complete: result.complete,
    truncated: result.truncated,
    keywords: result.keywords.map((item) => ({
      term: item.term,
      kind: item.kind,
      weight: item.weight,
    })),
    l2: result.l2.map((item) => ({ id: item.id, title: item.title, summary: item.summary })),
    l1: result.l1.slice(0, MAX_L1_ITEMS).map((item) => ({
      id: item.id,
      abstraction: item.abstraction,
      content: clip(item.content, MAX_L1_CONTENT),
    })),
    l0SourceIds: [...result.l0SourceIds],
  };

  const lines: string[] = ['<pmem_memory>', 'Current visible PMEM memory:'];
  if (result.l2.length) {
    for (const memory of result.l2) {
      lines.push(
        `[L2 ${memory.id}] ${memory.title}`,
        memory.summary,
        clip(memory.body, MAX_L2_BODY)
      );
      if (memory.relatedSpaceIds.length) lines.push(`spaces: ${memory.relatedSpaceIds.join(', ')}`);
    }
  } else if (result.l1.length) {
    lines.push('No current L2 memory matched; showing L1 evidence.');
  } else {
    lines.push('No matching PMEM memory.');
  }
  if (result.l1.length) {
    lines.push('L1 evidence:');
    for (const memory of result.l1.slice(0, MAX_L1_ITEMS)) {
      lines.push(
        `[L1 ${memory.id}] ${memory.abstraction}: ${clip(memory.content, MAX_L1_CONTENT)}`
      );
    }
  }
  if (!result.complete) lines.push('Note: memory results are incomplete.');
  lines.push('</pmem_memory>');
  return { text: lines.join('\n'), details };
}

export function formatL2(memory: L2Memory | undefined): PmemRecallText {
  if (!memory) return { text: 'PMEM L2 memory not found.', details: emptyDetails() };
  const status = memory.visible ? 'current' : 'superseded';
  const text = [
    `<pmem_memory kind="l2" status="${status}">`,
    `[L2 ${memory.id}] ${memory.title}`,
    memory.summary,
    clip(memory.body, MAX_L2_BODY),
    memory.supersededBy ? `superseded_by: ${memory.supersededBy}` : '',
    '</pmem_memory>',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    text,
    details: {
      ...emptyDetails(),
      l2: [{ id: memory.id, title: memory.title, summary: memory.summary }],
    },
  };
}

export function formatL1(memory: L1Memory | undefined): PmemRecallText {
  if (!memory) return { text: 'PMEM L1 memory not found.', details: emptyDetails() };
  const text = [
    '<pmem_memory kind="l1">',
    `[L1 ${memory.id}] ${memory.abstraction}`,
    clip(memory.content, MAX_L1_CONTENT),
    '</pmem_memory>',
  ].join('\n');
  return {
    text,
    details: {
      ...emptyDetails(),
      l1: [
        {
          id: memory.id,
          abstraction: memory.abstraction,
          content: clip(memory.content, MAX_L1_CONTENT),
        },
      ],
    },
  };
}

function emptyDetails(): PmemRecallDetails {
  return {
    cacheHit: false,
    mixed: false,
    fallback: 'none',
    complete: true,
    truncated: false,
    keywords: [],
    l2: [],
    l1: [],
    l0SourceIds: [],
  };
}

/** Owned read adapter over the existing PMEM services. */
export class AgentMemory implements PmemMemory {
  private readonly memory;
  private readonly l1;
  private readonly l2;
  private readonly l3;

  constructor(database: OwnedDatabase, options?: L3ServiceOptions) {
    this.memory = assembleMemory(database);
    this.l1 = assembleL1(database);
    this.l2 = assembleL2(database);
    this.l3 = assembleL3(database, options);
  }

  resolve(
    query: string,
    anchoredSpaceIds: readonly string[],
    access: MemoryAccess,
    options?: import('../domain/memory/l3').L3ResolveOptions
  ): L3ResolveResult {
    return this.l3.resolve(query, anchoredSpaceIds, access, options);
  }

  getL2(id: string, access: MemoryAccess): L2Memory | undefined {
    return this.l2.getMemory(id, access);
  }

  getL1(id: string, access: MemoryAccess): L1Memory | undefined {
    return this.l1.getMemory(id, access);
  }

  getL0(id: string, access: MemoryAccess): L0Message | undefined {
    return this.memory.getL0(id, access);
  }

  appendL0(input: AppendL0Input, access: MemoryAccess): AppendL0Result {
    return this.memory.appendL0(input, access);
  }

  listL0(
    options: { spaceId: string; sessionId?: string; afterSequence?: number; limit?: number },
    access: MemoryAccess
  ): import('../domain/memory/types').L0Page {
    return this.memory.listL0(options, access);
  }

  listSpaces(access: MemoryAccess): MemorySpace[] {
    return this.memory.listSpaces(access);
  }
}
