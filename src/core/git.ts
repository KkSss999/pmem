export interface GitStatusChange {
  status: string;
  path: string;
}

export function getCurrentBranch(cwd: string = process.cwd()): string | null {
  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    if (branch) return branch;
    const commit = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    return commit ? `detached:${commit}` : null;
  } catch {
    return null;
  }
}

export function parseGitStatusPorcelain(output: string): GitStatusChange[] {
  const changes: GitStatusChange[] = [];

  for (const rawLine of output.split('\n')) {
    if (!rawLine.trim()) continue;

    const status = rawLine.slice(0, 2).trim() || rawLine.slice(0, 2);
    let filePath = rawLine.slice(3).trim();

    if (status.includes('R')) {
      const arrowIdx = filePath.indexOf(' -> ');
      if (arrowIdx > 0) filePath = filePath.slice(arrowIdx + 4);
    }

    changes.push({ status, path: filePath });
  }

  return changes;
}
