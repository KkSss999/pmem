import { execSync } from 'child_process';
import type { NamespaceAddress, Observation, RuntimeConfig } from './types';

const HIERARCHY_LEVEL: Record<string, number> = {
  system: 0, user: 1, application: 2, workspace: 3, agent: 4, task: 5, session: 6,
};
const HIERARCHY_ORDER = ['system', 'user', 'application', 'workspace', 'agent', 'task', 'session'] as const;

export class ScopeManager {
  constructor(
    private readonly root: string,
    private readonly config: RuntimeConfig,
  ) {}

  resolve(file: string, change: Observation, ns?: NamespaceAddress): string {
    const explicitScope = typeof change.metadata?.scope === 'string' ? change.metadata.scope.trim() : '';
    if (explicitScope) return explicitScope;

    const sessionId = typeof change.metadata?.session_id === 'string' ? change.metadata.session_id.trim() : '';
    if (sessionId) return `session:${sessionId}`;

    // v1.1.0: namespace address inference
    if (ns) {
      if (ns.sessionId) return `session:${ns.sessionId}`;
      if (ns.taskId) return `task:${ns.taskId}`;
      if (ns.agentId) return `agent:${ns.agentId}`;
      if (ns.workspaceId) return `workspace:${ns.workspaceId}`;
      if (ns.appId) return `application:${ns.appId}`;
      if (ns.userId) return `user:${ns.userId}`;
      if (ns.systemId) return `system:${ns.systemId}`;
    }

    if (this.config.branchAware) {
      const branch = this.currentBranch();
      if (branch) return `branch:${branch}`;
    }

    if (file.startsWith('.pmem/traces/') || file.includes('/.pmem/traces/')) return 'session';
    return this.config.defaultScope;
  }

  isVisible(scope: string, principal: string): boolean {
    if (scope === 'shared' || scope.startsWith('shared:')) return true;
    if (scope === 'private') return principal === 'owner';
    if (scope.startsWith('private:')) {
      return scope === `private:${principal}`;
    }

    const scopeLevel = _hierarchyLevel(scope);
    const principalLevel = _hierarchyLevel(principal);
    if (principalLevel < 0) return true; // unknown principal → system-level, sees all
    if (scopeLevel < 0) return true;
    return principalLevel <= scopeLevel;
  }

  children(scope: string): string[] {
    const base = scope.includes(':') ? scope.split(':')[0] : scope;
    const idx = HIERARCHY_ORDER.indexOf(base as typeof HIERARCHY_ORDER[number]);
    if (idx < 0) {
      // Legacy compatibility: project → branch, branch:* → session
      if (scope === 'project') {
        const branch = this.currentBranch();
        return branch ? [`branch:${branch}`] : [];
      }
      if (scope.startsWith('branch:')) return ['session'];
      return [];
    }
    const next = HIERARCHY_ORDER[idx + 1];
    return next ? [next] : [];
  }

  static parentScope(scope: string): string | null {
    const base = scope.includes(':') ? scope.split(':')[0] : scope;
    const idx = HIERARCHY_ORDER.indexOf(base as typeof HIERARCHY_ORDER[number]);
    if (idx <= 0) return null;
    return HIERARCHY_ORDER[idx - 1];
  }

  private currentBranch(): string | null {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000,
      }).trim();
      if (!branch || branch === 'HEAD') return null;
      return branch;
    } catch { return null; }
  }
}

function _hierarchyLevel(scope: string): number {
  const base = scope.includes(':') ? scope.split(':')[0] : scope;
  if (base === 'shared') return -1;
  if (base === 'private') return HIERARCHY_ORDER.length;
  const level = HIERARCHY_LEVEL[base];
  return level ?? -1;
}
