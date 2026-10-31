type MiaoRoot = typeof import('@miao/agent');
type MiaoClient = typeof import('@miao/agent/client');
type MiaoPlugins = typeof import('@miao/agent/plugins');
type MiaoTesting = typeof import('@miao/agent/testing');
type Typebox = typeof import('typebox');

export interface MiaoModules {
  agent: MiaoRoot;
  client: MiaoClient;
  plugins: MiaoPlugins;
  testing: MiaoTesting;
}

type DynamicImport = <T>(specifier: string) => Promise<T>;

// PMEM is CommonJS; the MiaoTs artifact is ESM. Hide the import from the
// TypeScript CommonJS transform so Node's native ESM loader is used.
const importModule = new Function('specifier', 'return import(specifier)') as DynamicImport;

let modules: Promise<MiaoModules> | undefined;
let typebox: Promise<Typebox> | undefined;

export function loadMiao(): Promise<MiaoModules> {
  modules ??= Promise.all([
    importModule<MiaoRoot>('@miao/agent'),
    importModule<MiaoClient>('@miao/agent/client'),
    importModule<MiaoPlugins>('@miao/agent/plugins'),
    importModule<MiaoTesting>('@miao/agent/testing'),
  ]).then(([agent, client, plugins, testing]) => ({ agent, client, plugins, testing }));
  return modules;
}

export function loadTypebox(): Promise<Typebox> {
  typebox ??= importModule<Typebox>('typebox');
  return typebox;
}
