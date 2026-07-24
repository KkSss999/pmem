import { createHash } from 'crypto';
import {
  DEFAULT_CHUNK_TOKEN_BUDGET,
  DEFAULT_MAX_MODEL_TOKENS,
  type ChunkingOptions,
  type SemanticCardDocument,
  type SemanticChunk,
} from './types';

interface MarkdownSection {
  heading: string | null;
  headingPath: string[];
  body: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * UTF-8 byte length is a deliberately conservative tokenizer-independent
 * upper bound for the XLM-R/SentencePiece input used by multilingual E5.
 */
export function conservativeTokenCount(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function resolveContentBudget(options: ChunkingOptions): number {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_MODEL_TOKENS;
  const reservedTokens = options.reservedTokens ?? (DEFAULT_MAX_MODEL_TOKENS - DEFAULT_CHUNK_TOKEN_BUDGET);
  if (!Number.isInteger(maxTokens) || maxTokens < 2 || maxTokens > DEFAULT_MAX_MODEL_TOKENS) {
    throw new Error(`Semantic maxTokens must be an integer between 2 and ${DEFAULT_MAX_MODEL_TOKENS}`);
  }
  if (!Number.isInteger(reservedTokens) || reservedTokens < 0 || reservedTokens >= maxTokens) {
    throw new Error('Semantic reservedTokens must be a non-negative integer smaller than maxTokens');
  }
  return maxTokens - reservedTokens;
}

function parseSections(markdown: string): MarkdownSection[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const sections: MarkdownSection[] = [];
  const headingStack: string[] = [];
  let heading: string | null = null;
  let headingPath: string[] = [];
  let bodyLines: string[] = [];
  let fence: string | null = null;

  const flush = (): void => {
    const body = bodyLines.join('\n').trim();
    if (body) sections.push({ heading, headingPath: [...headingPath], body });
    bodyLines = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence === marker ? null : (fence ?? marker);
      bodyLines.push(line);
      continue;
    }

    const match = fence === null ? line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) : null;
    if (!match) {
      bodyLines.push(line);
      continue;
    }

    flush();
    const level = match[1].length;
    heading = match[2].trim();
    headingStack.length = level - 1;
    headingStack[level - 1] = heading;
    headingPath = headingStack.filter(Boolean);
  }
  flush();
  return sections;
}

function takeUtf8Prefix(value: string, maxBytes: number): number {
  let bytes = 0;
  let index = 0;
  for (const symbol of value) {
    const symbolBytes = Buffer.byteLength(symbol, 'utf8');
    if (bytes + symbolBytes > maxBytes) break;
    bytes += symbolBytes;
    index += symbol.length;
  }
  return index;
}

function chooseSplitPoint(value: string, hardEnd: number): number {
  if (hardEnd >= value.length) return value.length;
  const prefix = value.slice(0, hardEnd);
  const paragraph = prefix.lastIndexOf('\n\n');
  if (paragraph >= Math.floor(hardEnd * 0.4)) return paragraph + 2;
  const line = prefix.lastIndexOf('\n');
  if (line >= Math.floor(hardEnd * 0.4)) return line + 1;
  const whitespace = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\t'));
  if (whitespace >= Math.floor(hardEnd * 0.4)) return whitespace + 1;
  return hardEnd;
}

function splitWithinBudget(value: string, maxBytes: number): string[] {
  const parts: string[] = [];
  let remaining = value.trim();
  while (remaining) {
    const hardEnd = takeUtf8Prefix(remaining, maxBytes);
    if (hardEnd === 0) throw new Error('Semantic chunk budget is too small for one UTF-8 character');
    const splitAt = chooseSplitPoint(remaining, hardEnd);
    const part = remaining.slice(0, splitAt).trim();
    if (part) parts.push(part);
    remaining = remaining.slice(splitAt).trim();
  }
  return parts;
}

function contextPrefix(card: SemanticCardDocument, section: MarkdownSection): string {
  const lines: string[] = [`Title: ${card.title}`];
  if (card.summary?.trim()) lines.push(`Summary: ${card.summary.trim()}`);
  if (section.headingPath.length > 0) lines.push(`Section: ${section.headingPath.join(' > ')}`);
  return lines.join('\n');
}

function compactContextLine(card: SemanticCardDocument): string | null {
  const normalized = (values: readonly string[] | undefined, maxItems: number): string[] =>
    [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))].sort().slice(0, maxItems);
  const sourceNames = normalized(card.sourceFiles, 4).map(value => value.split('/').filter(Boolean).pop() ?? value);
  const parts = [
    ...(card.type?.trim() ? [card.type.trim()] : []),
    ...normalized(card.aliases, 4),
    ...normalized(card.tags, 8),
    ...sourceNames,
    ...normalized(card.relatedCardIds, 4),
  ];
  if (parts.length === 0) return null;
  const line = `Context: ${parts.join(' | ')}`;
  const end = takeUtf8Prefix(line, 192);
  return line.slice(0, end).trim();
}

/** Deterministically split one card into stable, heading-aware E5 passages. */
export function chunkCard(card: SemanticCardDocument, options: ChunkingOptions = {}): SemanticChunk[] {
  const budget = resolveContentBudget(options);
  const sections = parseSections(card.body);
  if (sections.length === 0 && (card.title.trim() || card.summary?.trim())) {
    sections.push({ heading: null, headingPath: [], body: '' });
  }

  const chunks: SemanticChunk[] = [];
  for (const section of sections) {
    const prefix = contextPrefix(card, section);
    const separator = section.body ? '\n\n' : '';
    const fixedBytes = conservativeTokenCount(`passage: ${prefix}${separator}`);
    if (fixedBytes >= budget) {
      throw new Error(`Semantic metadata for card ${card.id} exceeds the chunk token budget`);
    }
    const bodies = section.body ? splitWithinBudget(section.body, budget - fixedBytes) : [''];
    for (const bodyPart of bodies) {
      const content = `${prefix}${bodyPart ? `\n\n${bodyPart}` : ''}`;
      const contentHash = sha256(content);
      const context = compactContextLine(card) ?? '';
      const contextHash = sha256(context);
      const ordinal = chunks.length;
      const headingKey = section.headingPath.join(' > ');
      const chunkId = `${card.id}:${sha256(`${card.id}\0${headingKey}\0${ordinal}\0${contentHash}`).slice(0, 24)}`;
      const estimatedTokens = conservativeTokenCount(`passage: ${content}`);
      if (estimatedTokens > budget) throw new Error(`Semantic chunk ${chunkId} exceeds the token budget`);
      chunks.push({
        chunkId,
        cardId: card.id,
        heading: section.heading,
        headingPath: section.headingPath,
        ordinal,
        content,
        contentHash,
        context,
        contextHash,
        estimatedTokens,
      });
    }
  }
  return chunks;
}
