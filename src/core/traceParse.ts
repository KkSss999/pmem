import { parseFrontmatter } from './yaml';

export interface ParsedTrace {
  id: string;
  title: string;
  summary: string;
  whatChanged: string[];
  why: string[];
  architectureNotes: string[];
  decisions: string[];
  next: string[];
  changedFiles: string[];
  createdAt: string;
}

export function parseTraceCard(content: string): ParsedTrace | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) return null;

  const fm = parsed.data as any;
  if (!fm || fm.type !== 'trace') return null;

  const body = parsed.body;
  const id = fm.id || '';
  const title = fm.title || extractTitle(body) || 'Trace';
  const createdAt = fm.created || '';
  const changedFiles = fm.source_files || [];

  const summary = extractSectionText(body, 'Summary') || fm.summary || '';
  const whatChanged = extractSectionList(body, 'What changed');
  const why = extractSectionList(body, 'Why');
  const architectureNotes = extractSectionList(body, 'Architecture notes');
  const decisions = extractSectionList(body, 'Decisions');
  const next = extractSectionList(body, 'Next');

  return {
    id,
    title,
    summary,
    whatChanged,
    why,
    architectureNotes,
    decisions,
    next,
    changedFiles,
    createdAt
  };
}

function extractTitle(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractSectionText(body: string, sectionName: string): string {
  const lines = body.split('\n');
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const currentSection = line.substring(3).trim().toLowerCase();
      if (currentSection === sectionName.toLowerCase()) {
        inSection = true;
      } else {
        inSection = false;
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join('\n').trim();
}

function extractSectionList(body: string, sectionName: string): string[] {
  const text = extractSectionText(body, sectionName);
  if (!text) return [];

  const lines = text.split('\n');
  const items: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
      const item = trimmed.substring(1).trim();
      if (item && item !== '(none)') {
        items.push(item);
      }
    } else if (trimmed && trimmed !== '(none)') {
      items.push(trimmed);
    }
  }
  return items;
}
