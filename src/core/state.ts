import * as path from 'path';
import { fileExists, readFile, writeFile } from './fs';
import { openDatabase, createSchema } from './db';

export function updateStateRecentChanges(pmemPath: string, traceSummary: { title: string; summary: string }): void {
  const statePath = path.join(pmemPath, 'state.md');
  if (!fileExists(statePath)) return;

  const content = readFile(statePath) || '';
  const lines = content.split('\n');
  const newLines: string[] = [];

  let inRecentChanges = false;
  const existingChanges: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith('## Recent Changes')) {
      inRecentChanges = true;
      newLines.push(line);
      continue;
    } else if (inRecentChanges && line.trim().startsWith('## ')) {
      inRecentChanges = false;
    }

    if (inRecentChanges) {
      if (line.trim().startsWith('-')) {
        existingChanges.push(line.trim());
      }
    } else {
      newLines.push(line);
    }
  }

  // Prepend the new change
  const today = new Date().toISOString().split('T')[0];
  const newEntry = `- ${today}: ${traceSummary.summary}`;
  existingChanges.unshift(newEntry);

  // Keep last 10 changes
  const slicedChanges = existingChanges.slice(0, 10);

  // Insert them back
  const rcIndex = newLines.findIndex(l => l.trim().startsWith('## Recent Changes'));
  if (rcIndex >= 0) {
    newLines.splice(rcIndex + 1, 0, '', ...slicedChanges);
  } else {
    newLines.push('', '## Recent Changes', '', ...slicedChanges);
  }

  writeFile(statePath, newLines.join('\n').trim() + '\n');
}

export function updateStateModules(pmemPath: string): void {
  const statePath = path.join(pmemPath, 'state.md');
  if (!fileExists(statePath)) return;

  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) return;

  let modules: Array<{ name: string; status: string; updated: string }> = [];
  try {
    const db = openDatabase(pmemPath);
    createSchema(db);
    const rows = db.prepare(
      "SELECT id, status, updated_at FROM cards WHERE type = 'module' AND is_deleted = 0"
    ).all() as Array<{ id: string; status: string | null; updated_at: string | null }>;

    modules = rows.map(r => {
      const name = r.id.replace('module.', '');
      const status = r.status || 'active';
      const updated = r.updated_at ? r.updated_at.split('T')[0] : '-';
      return { name, status, updated };
    });
  } catch {
    return;
  }

  if (modules.length === 0) return;

  const content = readFile(statePath) || '';
  const lines = content.split('\n');
  const newLines: string[] = [];

  let inModules = false;

  for (const line of lines) {
    if (line.trim().startsWith('## Modules')) {
      inModules = true;
      newLines.push(line);
      continue;
    } else if (inModules && line.trim().startsWith('## ')) {
      inModules = false;
    }

    if (!inModules) {
      newLines.push(line);
    }
  }

  // Generate table
  const tableLines = [
    '| Module | Status | Last Updated |',
    '|--------|--------|--------------|',
    ...modules.map(m => `| ${m.name} | ${m.status} | ${m.updated} |`)
  ];

  const mIndex = newLines.findIndex(l => l.trim().startsWith('## Modules'));
  if (mIndex >= 0) {
    newLines.splice(mIndex + 1, 0, '', ...tableLines);
  } else {
    // Put before Recent Changes if possible
    const rcIndex = newLines.findIndex(l => l.trim().startsWith('## Recent Changes'));
    if (rcIndex >= 0) {
      newLines.splice(rcIndex, 0, '## Modules', '', ...tableLines, '');
    } else {
      newLines.push('', '## Modules', '', ...tableLines);
    }
  }

  writeFile(statePath, newLines.join('\n').trim() + '\n');
}
