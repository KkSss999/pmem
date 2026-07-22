import { execSync } from 'child_process';
import type { Observation, RuntimeConfig } from './types';

export class ScopeManager {
  constructor(
    private readonly root: string,
    private readonly config: RuntimeConfig,
  ) {}

  resolve(file: string, change: Observation): string {
    const explicitScope = typeof change.metadata?.scope === 'string' ? change.metadata.scope.trim() : '';
    if (explicitScope) return explicitScope;

    const sessionId = typeof change.metadata?.session_id === 'string' ? change.metadata.session_id.trim() : '';
    if (sessionId) return `session:${sessionId}`;

    if (this.config.branchAware) {
      const branch = this.currentBranch();
      if (branch) return `branch:${branch}`;
    }

    if (file.startsWith('.pmem/traces/') || file.includes('/.pmem/traces/')) return 'session';
    return this.config.defaultScope;
  }

  isVisible(scope: string, principal: string): boolean {
    if (scope === 'private') return principal === 'owner';
    if (scope.startsWith('private:')) return scope === `private:${principal}`;
    return true;
  }

  children(scope: string): string[] {
    if (scope === 'project') {
      const branch = this.currentBranch();
      return branch ? [`branch:${branch}`] : [];
    }
    if (scope.startsWith('branch:')) return ['session'];
    if (scope === 'session') return ['agent'];
    return [];
  }

  private currentBranch(): string | null {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000,
      }).trim();
      if (!branch || branch === 'HEAD') return null;
      return branch;
    } catch {
      return null;
    }
  }
}
