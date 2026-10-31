import type { ContextContribution, PluginCallContext } from '@miao/agent/contracts';
import type { CompiledExtension } from '@miao/agent/plugins';
import type { PmemAgentBinding, PmemAgentHost, PmemMemory } from './contracts';
import { formatL1, formatL2, formatRecall } from './memory';
import { loadMiao, loadTypebox } from './miao';

export const PMEM_PLUGIN_ID = 'pmem.memory';
export const PMEM_PLUGIN_VERSION = '1.1.0';

export interface PmemMemoryPluginOptions {
  /** Set by the host before a turn; never read from model arguments. */
  queryFor?: (binding: PmemAgentBinding) => string | undefined;
}

function bindingOf(context: PluginCallContext): PmemAgentBinding {
  return {
    workspaceId: context.binding.workspaceId,
    agentId: context.binding.agentId ?? null,
    sessionId: context.binding.sessionId,
  };
}

/** Read-only Memory tools. Writes remain a host decision, not a model side effect. */
export async function createPmemMemoryPlugin(
  memory: PmemMemory,
  host: PmemAgentHost,
  options: PmemMemoryPluginOptions = {}
): Promise<CompiledExtension> {
  const [{ createExtension }, { Type }] = await Promise.all([loadMiao(), loadTypebox()]).then(
    ([miao, typebox]) => [miao.plugins, typebox] as const
  );
  return createExtension({ id: PMEM_PLUGIN_ID, version: PMEM_PLUGIN_VERSION }, (api) => {
    api.registerTool({
      name: 'pmem_recall',
      description:
        'Search the user’s saved PMEM memory. Use this when prior context, preferences, or project history may matter.',
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 512 }),
        topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      }),
      effect: 'read',
      replay: 'safe',
      executionMode: 'parallel',
      execute: async (args: { query: string; topK?: number }, context) => {
        const scope = host.scope(bindingOf(context));
        const result = formatRecall(
          memory.resolve(args.query, scope.anchoredSpaceIds, scope.access, {
            topK: args.topK ?? 5,
          })
        );
        return { content: [{ type: 'text', text: result.text }], details: result.details };
      },
    });

    api.registerContext({
      id: 'pmem-recall',
      read: async (context): Promise<readonly ContextContribution[]> => {
        const binding = bindingOf(context);
        const query = options.queryFor?.(binding)?.trim();
        if (!query) return [];
        const scope = host.scope(binding);
        const result = formatRecall(
          memory.resolve(query, scope.anchoredSpaceIds, scope.access, { topK: 3 })
        );
        if (!result.details.l2.length && !result.details.l1.length) return [];
        return [
          {
            id: 'pmem-recall',
            kind: 'messages',
            messages: [{ role: 'user', content: result.text, timestamp: 0 }],
          },
        ];
      },
    });

    api.registerTool({
      name: 'pmem_get',
      description: 'Read one PMEM L1 or L2 memory by its stable ID.',
      parameters: Type.Object({
        kind: Type.Union([Type.Literal('l1'), Type.Literal('l2')]),
        id: Type.String({ minLength: 1, maxLength: 200 }),
      }),
      effect: 'read',
      replay: 'safe',
      executionMode: 'parallel',
      execute: async (args: { kind: 'l1' | 'l2'; id: string }, context) => {
        const scope = host.scope(bindingOf(context));
        const result =
          args.kind === 'l2'
            ? formatL2(memory.getL2(args.id, scope.access))
            : formatL1(memory.getL1(args.id, scope.access));
        return { content: [{ type: 'text', text: result.text }], details: result.details };
      },
    });
  });
}
