import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { getDefaultManifest, saveManifest } from '../core/manifest';
import { createSchema, openOwnedDatabase } from '../core/db';
import { createSemanticSchema } from '../core/semantic';
import {
  DEFAULT_SEMANTIC_SOURCE,
  SEMANTIC_DIMENSION,
  SEMANTIC_DTYPE,
  SEMANTIC_MODEL,
  SEMANTIC_MODEL_REVISION,
  semanticCommand,
  type SemanticModelSpec,
  type SemanticRuntimeStatus,
  type SemanticOperations,
} from './semantic';
import { MODEL_UINT8_SHA256, MODELSCOPE_SOURCE_REVISION, REQUIRED_MODEL_FILES, createDefaultSemanticOperations, inspectModelCache, nativeDynamicImport } from './semanticRuntime';
import {
  createOfflineTransformersProvider,
  assertSemanticRuntimeAvailable,
  loadSemanticCompanion,
  SEMANTIC_COMPANION_PACKAGE,
  SEMANTIC_COMPANION_VERSION,
} from '../core/semantic/transformers';
import { semanticCacheIdentityMatches, type SemanticModelReceipt } from '../core/semantic/cache';

const tempDirs: string[] = [];

function project(): { cwd: string; manifestPath: string } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-semantic-'));
  tempDirs.push(cwd);
  const pmemPath = path.join(cwd, '.pmem');
  fs.mkdirSync(pmemPath);
  saveManifest(pmemPath, getDefaultManifest('semantic-test'));
  return { cwd, manifestPath: path.join(pmemPath, 'manifest.yml') };
}

function fakeStatus(overrides: Partial<SemanticRuntimeStatus> = {}): SemanticRuntimeStatus {
  return {
    modelCached: true,
    cacheIntegrity: 'ok',
    available: true,
    indexedCards: 2,
    indexedChunks: 7,
    indexRevision: SEMANTIC_MODEL_REVISION,
    pipelineVersion: 2,
    indexCompatible: true,
    indexFresh: true,
    eligibleCards: 2,
    excludedCards: 3,
    excludedByReason: { untrusted: 2, secret: 1 },
    failedCardCount: 0,
    failedCardIds: [],
    ...overrides,
  };
}

function fakeOperations(overrides: Partial<SemanticOperations> = {}): SemanticOperations {
  return {
    prepareModel: async () => {},
    status: async () => fakeStatus(),
    rebuild: async () => ({ indexedCards: 2, indexedChunks: 7 }),
    clear: async () => ({ removedChunks: 7 }),
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('pmem semantic command', () => {
  it('enable prepares the model, persists config, then builds a full current-project index', async () => {
    const { cwd, manifestPath } = project();
    const calls: string[] = [];
    const output: string[] = [];

    await semanticCommand('enable', { cwd, yes: true }, {
      platform: 'darwin',
      operations: fakeOperations({
        prepareModel: async () => { calls.push('prepare'); },
        rebuild: async (_pmemPath, spec, mode) => {
          calls.push('rebuild');
          assert.strictEqual(mode, 'full');
          const persisted = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as any;
          assert.strictEqual(persisted.embedding.enabled, true);
          assert.strictEqual(persisted.embedding.cache_path, spec.cachePath);
          return { indexedCards: 4, indexedChunks: 12 };
        },
      }),
      log: line => output.push(line),
    });

    assert.deepStrictEqual(calls, ['prepare', 'rebuild']);
    assert.ok(output.some(line => line.includes('4 cards / 12 chunks')));
  });

  it('enable cancellation leaves the manifest byte-for-byte unchanged and performs no work', async () => {
    const { cwd, manifestPath } = project();
    const before = fs.readFileSync(manifestPath, 'utf8');
    const calls: string[] = [];

    await semanticCommand('enable', { cwd }, {
      platform: 'darwin',
      operations: fakeOperations({
        prepareModel: async () => { calls.push('prepare'); },
        rebuild: async () => { calls.push('rebuild'); return { indexedCards: 0, indexedChunks: 0 }; },
      }),
      confirm: async () => false,
      log: () => {},
    });

    assert.deepStrictEqual(calls, []);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before);
  });

  it('enable companion/model preparation failure does not half-enable the manifest or start indexing', async () => {
    const { cwd, manifestPath } = project();
    const before = fs.readFileSync(manifestPath, 'utf8');
    let rebuilt = false;
    const setupError = new Error('Semantic runtime companion is not installed');

    await assert.rejects(semanticCommand('enable', { cwd, yes: true }, {
      platform: 'darwin',
      operations: fakeOperations({
        prepareModel: async () => { throw setupError; },
        rebuild: async () => { rebuilt = true; return { indexedCards: 0, indexedChunks: 0 }; },
      }),
      log: () => {},
    }), error => error === setupError);

    assert.strictEqual(rebuilt, false);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before);
  });

  it('enable JSON prepare failure emits one structured setup_failed document without manifest changes', async () => {
    const { cwd, manifestPath } = project();
    const before = fs.readFileSync(manifestPath, 'utf8');
    const output: string[] = [];
    const actionable = 'Semantic runtime companion is not installed. npm install -g pmem-ai-semantic@1.2.4';

    await assert.rejects(semanticCommand('enable', { cwd, yes: true, format: 'json' }, {
      platform: 'darwin',
      operations: fakeOperations({ prepareModel: async () => { throw new Error(actionable); } }),
      log: line => output.push(line),
    }), new RegExp(actionable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    assert.strictEqual(output.length, 1);
    const result = JSON.parse(output[0]);
    assert.strictEqual(result.status, 'setup_failed');
    assert.strictEqual(result.manifest_changed, false);
    assert.strictEqual(result.index_ready, false);
    assert.strictEqual(result.error, actionable);
    assert.strictEqual(result.install_command, 'npm install -g pmem-ai-semantic@1.2.4');
    assert.match(result.recovery_guidance, /Install.*companion.*rerun/i);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before);
  });

  it('enable rejects non-macOS before companion/model preparation', async () => {
    const { cwd } = project();
    let prepared = false;
    await assert.rejects(semanticCommand('enable', { cwd, yes: true }, {
      platform: 'linux',
      operations: fakeOperations({ prepareModel: async () => { prepared = true; } }),
      log: () => {},
    }), /enable is supported on macOS and Windows only/);
    assert.strictEqual(prepared, false);
  });

  it('enable index failure preserves truthful cached/enabled config and emits recovery guidance', async () => {
    const { cwd, manifestPath } = project();
    const output: string[] = [];

    await assert.rejects(semanticCommand('enable', { cwd, yes: true }, {
      platform: 'darwin',
      operations: fakeOperations({ rebuild: async () => { throw new Error('provider interrupted'); } }),
      log: line => output.push(line),
    }), /cached and enabled.*pmem semantic rebuild --full/);

    const persisted = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as any;
    assert.strictEqual(persisted.embedding.enabled, true);
    assert.strictEqual(persisted.embedding.provider, 'local');
    assert.ok(output.some(line => line.includes('setup succeeded')));
    assert.ok(output.some(line => line.includes('pmem semantic rebuild --full')));
  });

  it('enable JSON output is one parseable readiness document on success', async () => {
    const { cwd } = project();
    const output: string[] = [];
    await semanticCommand('enable', { cwd, yes: true, format: 'json' }, {
      platform: 'darwin',
      operations: fakeOperations({ rebuild: async () => ({ indexedCards: 3, indexedChunks: 9 }) }),
      log: line => output.push(line),
    });
    assert.strictEqual(output.length, 1);
    const result = JSON.parse(output[0]);
    assert.strictEqual(result.action, 'enable');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.indexed_cards, 3);
    assert.strictEqual(result.indexed_chunks, 9);
  });

  it('enable JSON failure output is one structured recovery document', async () => {
    const { cwd } = project();
    const output: string[] = [];
    await assert.rejects(semanticCommand('enable', { cwd, yes: true, format: 'json' }, {
      platform: 'darwin',
      operations: fakeOperations({ rebuild: async () => { throw new Error('index unavailable'); } }),
      log: line => output.push(line),
    }), /index unavailable/);
    assert.strictEqual(output.length, 1);
    const result = JSON.parse(output[0]);
    assert.strictEqual(result.status, 'index_failed');
    assert.strictEqual(result.manifest_enabled, true);
    assert.strictEqual(result.index_ready, false);
    assert.strictEqual(result.recovery_command, 'pmem semantic rebuild --full');
  });

  it('enable JSON partial result remains one truthful failure document', async () => {
    const { cwd } = project();
    const output: string[] = [];
    await assert.rejects(semanticCommand('enable', { cwd, yes: true, format: 'json' }, {
      platform: 'darwin',
      operations: fakeOperations({ rebuild: async () => ({
        indexedCards: 2,
        indexedChunks: 4,
        eligibleCards: 3,
        excludedCards: 0,
        buildStatus: 'partial',
        cardsFailed: 1,
        failedCardIds: ['module.bad'],
      }) }),
      log: line => output.push(line),
    }), /index construction failed/);
    assert.strictEqual(output.length, 1);
    const result = JSON.parse(output[0]);
    assert.strictEqual(result.status, 'index_failed');
    assert.strictEqual(result.index_ready, false);
    assert.deepStrictEqual(result.failed_card_ids, ['module.bad']);
  });

  it('cancels setup without calling the downloader or mutating the manifest', async () => {
    const { cwd, manifestPath } = project();
    const before = fs.readFileSync(manifestPath, 'utf8');
    let prepared = false;
    const output: string[] = [];

    await semanticCommand('setup', { cwd }, {
      platform: 'darwin',
      operations: fakeOperations({ prepareModel: async () => { prepared = true; } }),
      confirm: async () => false,
      log: (line) => output.push(line),
    });

    assert.strictEqual(prepared, false);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before);
    assert.ok(output.some((line) => line.includes(SEMANTIC_MODEL)));
    assert.ok(output.some((line) => line.includes(SEMANTIC_MODEL_REVISION)));
    assert.ok(output.some((line) => line.includes('145 MB')));
  });

  it('setup JSON success emits one model_ready document', async () => {
    const { cwd } = project();
    const output: string[] = [];

    await semanticCommand('setup', { cwd, yes: true, format: 'json' }, {
      platform: 'darwin',
      operations: fakeOperations(),
      log: line => output.push(line),
    });

    assert.strictEqual(output.length, 1);
    const result = JSON.parse(output[0]);
    assert.strictEqual(result.action, 'setup');
    assert.strictEqual(result.status, 'model_ready');
    assert.strictEqual(result.manifest_enabled, true);
    assert.strictEqual(result.index_ready, false);
    assert.strictEqual(result.next_command, 'pmem semantic rebuild');
  });

  it('setup JSON cancellation emits one cancelled document without manifest changes', async () => {
    const { cwd, manifestPath } = project();
    const before = fs.readFileSync(manifestPath, 'utf8');
    const output: string[] = [];

    await semanticCommand('setup', { cwd, format: 'json' }, {
      platform: 'darwin',
      operations: fakeOperations(),
      confirm: async () => false,
      log: line => output.push(line),
    });

    assert.strictEqual(output.length, 1);
    const result = JSON.parse(output[0]);
    assert.strictEqual(result.action, 'setup');
    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(result.manifest_changed, false);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before);
  });

  it('setup JSON failure emits one setup_failed document without manifest changes', async () => {
    const { cwd, manifestPath } = project();
    const before = fs.readFileSync(manifestPath, 'utf8');
    const output: string[] = [];

    await assert.rejects(semanticCommand('setup', { cwd, yes: true, format: 'json' }, {
      platform: 'darwin',
      operations: fakeOperations({ prepareModel: async () => { throw new Error('download interrupted'); } }),
      log: line => output.push(line),
    }), /download interrupted/);

    assert.strictEqual(output.length, 1);
    const result = JSON.parse(output[0]);
    assert.strictEqual(result.action, 'setup');
    assert.strictEqual(result.status, 'setup_failed');
    assert.strictEqual(result.manifest_changed, false);
    assert.strictEqual(result.index_ready, false);
    assert.strictEqual(result.error, 'download interrupted');
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before);
  });

  it('downloads only through setup and persists the exact pinned local configuration', async () => {
    const { cwd, manifestPath } = project();
    let received: SemanticModelSpec | undefined;

    await semanticCommand('setup', { cwd, yes: true }, {
      platform: 'darwin',
      operations: fakeOperations({ prepareModel: async (spec) => { received = spec; } }),
      log: () => {},
    });

    assert.ok(received);
    assert.strictEqual(received.model, SEMANTIC_MODEL);
    assert.strictEqual(received.revision, SEMANTIC_MODEL_REVISION);
    assert.strictEqual(received.dtype, SEMANTIC_DTYPE);
    assert.strictEqual(received.dimension, SEMANTIC_DIMENSION);
    assert.strictEqual(received.source, DEFAULT_SEMANTIC_SOURCE);
    assert.ok(path.isAbsolute(received.cachePath));
    assert.strictEqual(received.cachePath, path.join(os.homedir(), '.pmem-global', 'models', 'Xenova', 'multilingual-e5-small', SEMANTIC_MODEL_REVISION));
    assert.ok(!received.cachePath.startsWith(cwd));
    const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as any;
    assert.deepStrictEqual(manifest.embedding, {
      enabled: true,
      provider: 'local',
      model: SEMANTIC_MODEL,
      revision: SEMANTIC_MODEL_REVISION,
      source: 'modelscope',
      dtype: SEMANTIC_DTYPE,
      cache_path: received.cachePath,
      dimension: SEMANTIC_DIMENSION,
      store: 'sqlite',
      index: 'flat',
    });
  });

  it('rejects setup on non-macOS before preparing a model', async () => {
    const { cwd } = project();
    let prepared = false;
    await assert.rejects(
      semanticCommand('setup', { cwd, yes: true }, {
        platform: 'linux',
        operations: fakeOperations({ prepareModel: async () => { prepared = true; } }),
      }),
      /macOS and Windows only/,
    );
    assert.strictEqual(prepared, false);
  });

  it('accepts setup on win32', async () => {
    const { cwd } = project();
    let prepared = false;
    await semanticCommand('setup', { cwd, yes: true }, {
      platform: 'win32',
      operations: fakeOperations({ prepareModel: async () => { prepared = true; } }),
    });
    assert.strictEqual(prepared, true);
  });

  it('status is read-only and does not invoke model preparation', async () => {
    const { cwd, manifestPath } = project();
    const before = fs.readFileSync(manifestPath, 'utf8');
    let prepared = false;
    const output: string[] = [];
    await semanticCommand('status', { cwd, format: 'json' }, {
      operations: fakeOperations({ prepareModel: async () => { prepared = true; } }),
      log: (line) => output.push(line),
    });
    assert.strictEqual(prepared, false);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before);
    const status = JSON.parse(output.join('\n'));
    assert.strictEqual(status.indexedChunks, 7);
    assert.strictEqual(status.pipelineVersion, 2);
    assert.strictEqual(status.indexCompatible, true);
    assert.strictEqual(status.indexFresh, true);
    assert.strictEqual(status.eligibleCards, 2);
    assert.deepStrictEqual(status.excludedByReason, { untrusted: 2, secret: 1 });
    assert.strictEqual(status.recovery_command, undefined);
  });

  it('status marks partial indexes unavailable and exposes failed cards and recovery in JSON', async () => {
    const { cwd } = project();
    const output: string[] = [];
    await semanticCommand('setup', { cwd, yes: true }, {
      platform: 'darwin', operations: fakeOperations(), log: () => {},
    });
    await semanticCommand('status', { cwd, format: 'json' }, {
      operations: fakeOperations({
        status: async () => fakeStatus({
          available: false,
          indexCompatible: true,
          buildStatus: 'partial',
          failedCardCount: 2,
          failedCardIds: ['module.bad', 'module.worse'],
        }),
      }),
      log: line => output.push(line),
    });
    const status = JSON.parse(output.join('\n'));
    assert.strictEqual(status.available, false);
    assert.strictEqual(status.indexCompatible, false);
    assert.strictEqual(status.buildStatus, 'partial');
    assert.strictEqual(status.failedCardCount, 2);
    assert.deepStrictEqual(status.failedCardIds, ['module.bad', 'module.worse']);
    assert.strictEqual(status.recovery_command, 'pmem semantic rebuild --full');
  });

  it('status compact output names partial failures and the full rebuild recovery command', async () => {
    const { cwd } = project();
    const output: string[] = [];
    await semanticCommand('setup', { cwd, yes: true }, {
      platform: 'darwin', operations: fakeOperations(), log: () => {},
    });
    await semanticCommand('status', { cwd }, {
      operations: fakeOperations({
        status: async () => fakeStatus({
          available: false,
          indexCompatible: true,
          buildStatus: 'partial',
          failedCardCount: 1,
          failedCardIds: ['module.bad'],
        }),
      }),
      log: line => output.push(line),
    });
    assert.ok(output.some(line => line.includes('Index:') && line.includes('unavailable') && line.includes('partial')));
    assert.ok(output.some(line => line.includes('Failed cards: 1 (module.bad)')));
    assert.ok(output.some(line => line.includes('pmem semantic rebuild --full')));
  });

  it('runtime status does not report a partial compatible pipeline as queryable', async () => {
    const { cwd } = project();
    const pmemPath = path.join(cwd, '.pmem');
    const db = openOwnedDatabase(pmemPath);
    createSchema(db);
    createSemanticSchema(db);
    db.prepare(`
      INSERT INTO semantic_meta (
        id, pipeline_version, model_id, model_revision, dimension,
        index_content_hash, chunk_count, built_at, build_status,
        failed_card_count, failed_card_ids
      ) VALUES (1, 2, ?, ?, ?, ?, ?, ?, 'partial', 1, ?)
    `).run(SEMANTIC_MODEL, SEMANTIC_MODEL_REVISION, SEMANTIC_DIMENSION, 'hash', 1, new Date(0).toISOString(), JSON.stringify(['module.bad']));
    db.close();

    const status = await createDefaultSemanticOperations().status(pmemPath, {
      model: SEMANTIC_MODEL,
      revision: SEMANTIC_MODEL_REVISION,
      dtype: SEMANTIC_DTYPE,
      dimension: SEMANTIC_DIMENSION,
      source: DEFAULT_SEMANTIC_SOURCE,
      cachePath: path.join(cwd, 'missing-cache'),
    });
    assert.strictEqual(status.available, false);
    assert.strictEqual(status.indexCompatible, false);
    assert.strictEqual(status.buildStatus, 'partial');
    assert.strictEqual(status.failedCardCount, 1);
    assert.deepStrictEqual(status.failedCardIds, ['module.bad']);
  });

  it('status verifies the registry source recorded by setup', async () => {
    const { cwd } = project();
    await semanticCommand('setup', { cwd, yes: true, source: 'huggingface' }, {
      platform: 'darwin', operations: fakeOperations(), log: () => {},
    });
    let received: SemanticModelSpec | undefined;
    await semanticCommand('status', { cwd }, {
      operations: fakeOperations({
        status: async (_pmemPath, spec) => {
          received = spec;
          return {
            modelCached: true,
            cacheIntegrity: 'ok',
            available: false,
            indexedCards: 0,
            indexedChunks: 0,
            indexRevision: null,
          };
        },
      }),
      log: () => {},
    });
    assert.strictEqual(received?.source, 'huggingface');
  });

  it('rebuild requires setup, then passes the pinned cache spec to the runtime', async () => {
    const { cwd } = project();
    await assert.rejects(semanticCommand('rebuild', { cwd }, { operations: fakeOperations() }), /setup/);
    await semanticCommand('setup', { cwd, yes: true }, {
      platform: 'darwin', operations: fakeOperations(), log: () => {},
    });
    let rebuilt: SemanticModelSpec | undefined;
    await semanticCommand('rebuild', { cwd }, {
      operations: fakeOperations({
        rebuild: async (_pmemPath, spec, mode) => {
          rebuilt = spec;
          assert.strictEqual(mode, 'incremental');
          return { indexedCards: 1, indexedChunks: 3 };
        },
      }),
      log: () => {},
    });
    assert.strictEqual(rebuilt?.revision, SEMANTIC_MODEL_REVISION);
  });

  it('clear removes derived chunks, disables semantic retrieval, and preserves model coordinates', async () => {
    const { cwd, manifestPath } = project();
    await semanticCommand('setup', { cwd, yes: true }, {
      platform: 'darwin', operations: fakeOperations(), log: () => {},
    });
    await semanticCommand('clear', { cwd }, { operations: fakeOperations(), log: () => {} });
    const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as any;
    assert.strictEqual(manifest.embedding.enabled, false);
    assert.strictEqual(manifest.embedding.model, SEMANTIC_MODEL);
    assert.strictEqual(manifest.embedding.revision, SEMANTIC_MODEL_REVISION);
  });

  it('preserves native dynamic import in CommonJS builds for the ESM-only dependency', () => {
    const source = nativeDynamicImport.toString();
    assert.match(source, /return import\(specifier\)/);
    assert.doesNotMatch(source, /require\(specifier\)/);
  });

  it('gives an actionable error when the opt-in semantic companion is absent', async () => {
    await assert.rejects(
      loadSemanticCompanion(async () => {
        const error = new Error('not found') as NodeJS.ErrnoException;
        error.code = 'ERR_MODULE_NOT_FOUND';
        throw error;
      }),
      new RegExp(`npm install -g ${SEMANTIC_COMPANION_PACKAGE}@${SEMANTIC_COMPANION_VERSION}`),
    );
  });

  it('rejects an incompatible semantic companion API', async () => {
    await assert.rejects(
      loadSemanticCompanion(async () => ({ apiVersion: 2 })),
      new RegExp(`incompatible.*${SEMANTIC_COMPANION_PACKAGE}@${SEMANTIC_COMPANION_VERSION}`, 'i'),
    );
  });

  it('checks for the companion before semantic setup downloads model files', async () => {
    const operations = createDefaultSemanticOperations(async () => { throw new Error('missing'); });
    await assert.rejects(
      operations.prepareModel({
        model: SEMANTIC_MODEL,
        revision: SEMANTIC_MODEL_REVISION,
        dtype: SEMANTIC_DTYPE,
        dimension: SEMANTIC_DIMENSION,
        source: 'modelscope',
        cachePath: '/tmp/shared-model',
      }),
      new RegExp(`Semantic runtime companion is not installed.*npm install -g ${SEMANTIC_COMPANION_PACKAGE}@${SEMANTIC_COMPANION_VERSION}`),
    );
  });

  it('records an explicit Hugging Face source without changing the shared model directory', async () => {
    const { cwd, manifestPath } = project();
    let received: SemanticModelSpec | undefined;
    await semanticCommand('setup', { cwd, yes: true, source: 'huggingface' }, {
      platform: 'darwin',
      operations: fakeOperations({ prepareModel: async spec => { received = spec; } }),
      log: () => {},
    });
    assert.strictEqual(received?.source, 'huggingface');
    assert.strictEqual(received?.cachePath, path.join(os.homedir(), '.pmem-global', 'models', 'Xenova', 'multilingual-e5-small', SEMANTIC_MODEL_REVISION));
    const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as any;
    assert.strictEqual(manifest.embedding.source, 'huggingface');
  });

  it('treats registry source as provenance rather than global cache identity', () => {
    const receipt: SemanticModelReceipt = {
      model: SEMANTIC_MODEL,
      revision: SEMANTIC_MODEL_REVISION,
      source: 'modelscope',
      source_revision: MODELSCOPE_SOURCE_REVISION,
      dtype: SEMANTIC_DTYPE,
      dimension: SEMANTIC_DIMENSION,
      files: REQUIRED_MODEL_FILES.map(file => ({ path: file, size: 1, sha256: '0'.repeat(64) })),
      cached_at: new Date(0).toISOString(),
    };
    assert.strictEqual(semanticCacheIdentityMatches(receipt, {
      model: SEMANTIC_MODEL,
      revision: SEMANTIC_MODEL_REVISION,
      source: 'huggingface',
      dtype: SEMANTIC_DTYPE,
      dimension: SEMANTIC_DIMENSION,
      cachePath: '/tmp/shared-model',
    }), true);
  });

  it('loads the absolute model directory offline and never enables remote models', async () => {
    const calls: any[] = [];
    const env = { allowRemoteModels: true, allowLocalModels: false, cacheDir: 'before' };
    const extractor = Object.assign(async () => ({ tolist: () => [[1, 0]] }), { dispose: async () => {} });
    const companion = require('../../packages/semantic-runtime') as {
      apiVersion: number;
      createOfflineTransformersProvider(spec: SemanticModelSpec, importer: (specifier: string) => Promise<any>): Promise<any>;
    };
    assert.strictEqual(companion.apiVersion, 1);
    const provider = await companion.createOfflineTransformersProvider({
      model: SEMANTIC_MODEL,
      revision: SEMANTIC_MODEL_REVISION,
      dtype: SEMANTIC_DTYPE,
      dimension: SEMANTIC_DIMENSION,
      source: 'modelscope',
      cachePath: '/tmp/shared-model',
    }, async (specifier: string) => {
      assert.strictEqual(specifier, '@huggingface/transformers');
      return {
      env,
      pipeline: async (...args: any[]) => {
        calls.push({ args, remote: env.allowRemoteModels, local: env.allowLocalModels });
        return extractor;
      },
      };
    });
    assert.strictEqual(calls[0].args[1], '/tmp/shared-model');
    assert.strictEqual(calls[0].args[2].local_files_only, true);
    assert.strictEqual(calls[0].remote, false);
    assert.strictEqual(calls[0].local, true);
    assert.strictEqual(env.allowRemoteModels, true);
    await provider.dispose();
  });

  it('keeps the companion package metadata, dependency, and remediation version aligned', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../packages/semantic-runtime/package.json'), 'utf8')) as any;
    assert.strictEqual(packageJson.version, SEMANTIC_COMPANION_VERSION);
    assert.strictEqual(packageJson.dependencies['@huggingface/transformers'], '4.2.0');
    assert.strictEqual(packageJson.exports, './index.js');
  });

  it('probes the companion Transformers runtime before a cached setup is accepted', async () => {
    let probed = false;
    await assertSemanticRuntimeAvailable(async specifier => {
      assert.strictEqual(specifier, SEMANTIC_COMPANION_PACKAGE);
      return {
        apiVersion: 1,
        assertTransformersRuntimeAvailable: async () => { probed = true; },
        createOfflineTransformersProvider: async () => ({
          modelId: SEMANTIC_MODEL,
          revision: SEMANTIC_MODEL_REVISION,
          dimension: SEMANTIC_DIMENSION,
          embedPassages: async () => [],
          embedQuery: async () => [],
          dispose: async () => {},
        }),
      };
    });
    assert.strictEqual(probed, true);
  });

  it('loads a compatible injected companion without resolving a root dependency', async () => {
    const expected = { modelId: SEMANTIC_MODEL, revision: SEMANTIC_MODEL_REVISION, dimension: 384 };
    const provider = await createOfflineTransformersProvider({
      model: SEMANTIC_MODEL,
      revision: SEMANTIC_MODEL_REVISION,
      dtype: SEMANTIC_DTYPE,
      dimension: SEMANTIC_DIMENSION,
      cachePath: '/tmp/shared-model',
    }, async specifier => {
      assert.strictEqual(specifier, SEMANTIC_COMPANION_PACKAGE);
      return {
        apiVersion: 1,
        createOfflineTransformersProvider: async () => ({
          ...expected,
          embedPassages: async () => [],
          embedQuery: async () => [],
          dispose: async () => {},
        }),
      };
    });
    assert.strictEqual(provider.modelId, expected.modelId);
  });

  it('rejects a forged receipt and requires the pinned ModelScope snapshot coordinates', async () => {
    const cachePath = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-model-cache-'));
    tempDirs.push(cachePath);
    const spec: SemanticModelSpec = {
      model: SEMANTIC_MODEL,
      revision: SEMANTIC_MODEL_REVISION,
      dtype: SEMANTIC_DTYPE,
      dimension: SEMANTIC_DIMENSION,
      source: 'modelscope',
      cachePath,
    };
    fs.writeFileSync(path.join(cachePath, 'pmem-semantic-model.json'), JSON.stringify({
      model: SEMANTIC_MODEL,
      revision: SEMANTIC_MODEL_REVISION,
      source: 'modelscope',
      source_revision: `${MODELSCOPE_SOURCE_REVISION}-wrong`,
      dtype: SEMANTIC_DTYPE,
      dimension: SEMANTIC_DIMENSION,
      files: REQUIRED_MODEL_FILES.map(file => ({ path: file, size: 0, sha256: file.includes('model_uint8') ? MODEL_UINT8_SHA256 : '0'.repeat(64) })),
    }));
    assert.deepStrictEqual(await inspectModelCache(spec), { integrity: 'corrupt', cached: false });
  });
});
