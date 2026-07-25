import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { inspectSemanticReadiness, summarizeSemanticEligibility } from './semantic';
import type { SemanticCardDocument } from '../semantic';
import { MODEL_UINT8_SHA256, REQUIRED_MODEL_FILES, SEMANTIC_RECEIPT_FILE } from '../semantic/cache';
import { getDefaultManifest } from '../manifest';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function card(id: string, overrides: Partial<SemanticCardDocument> = {}): SemanticCardDocument {
  return {
    id,
    title: id,
    body: 'body',
    frontmatter: { trust_label: 'user_confirmed', sensitivity: 'internal' },
    ...overrides,
  };
}

describe('semantic health eligibility', () => {
  it('reports eligible cards and every safety exclusion reason without exposing content', () => {
    const result = summarizeSemanticEligibility([
      card('decision.safe'),
      card('decision.secret', { frontmatter: { trust_label: 'user_confirmed', sensitivity: 'secret' } }),
      card('decision.untrusted', { frontmatter: { trust_label: 'agent_generated', sensitivity: 'internal' } }),
      card('decision.candidate', { isCandidate: true }),
      card('decision.deleted', { isDeleted: true }),
      card('decision.superseded', { frontmatter: { trust_label: 'user_confirmed', sensitivity: 'internal', superseded_by: ['decision.next'] } }),
    ]);
    assert.deepEqual(result, {
      eligible_cards: 1,
      excluded_cards: 5,
      excluded_by_reason: { secret: 1, untrusted: 1, candidate: 1, deleted: 1, superseded: 1 },
      excluded_by_trust_detail: { non_indexable_trust_label: 1 },
    });
    assert.equal(JSON.stringify(result).includes('body'), false);
  });

  it('splits missing, invalid, and explicitly non-indexable trust labels without weakening the aggregate', () => {
    const result = summarizeSemanticEligibility([
      card('decision.missing', { frontmatter: { sensitivity: 'internal' } }),
      card('decision.invalid', { frontmatter: { trust_label: 'trusted' as any, sensitivity: 'internal' } }),
      card('decision.external', { frontmatter: { trust_label: 'imported_external', sensitivity: 'internal' } }),
    ]);
    assert.deepEqual(result.excluded_by_reason, { untrusted: 3 });
    assert.deepEqual(result.excluded_by_trust_detail, {
      missing_trust_label: 1,
      invalid_trust_label: 1,
      non_indexable_trust_label: 1,
    });
  });

  it('rejects same-size model corruption instead of trusting receipt metadata', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-health-semantic-'));
    tempDirs.push(root);
    const pmemPath = path.join(root, '.pmem');
    const cachePath = path.join(root, 'model-cache');
    fs.mkdirSync(pmemPath);
    fs.mkdirSync(cachePath, { recursive: true });

    const files = REQUIRED_MODEL_FILES.map((relativePath, index) => {
      const absolutePath = path.join(cachePath, relativePath);
      const content = Buffer.from(`model-file-${index}`);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content);
      return {
        path: relativePath,
        size: content.length,
        sha256: relativePath === 'onnx/model_uint8.onnx'
          ? MODEL_UINT8_SHA256
          : crypto.createHash('sha256').update(content).digest('hex'),
      };
    });
    fs.writeFileSync(path.join(cachePath, SEMANTIC_RECEIPT_FILE), JSON.stringify({
      model: 'Xenova/multilingual-e5-small',
      revision: 'test-revision',
      dtype: 'uint8',
      dimension: 384,
      files,
      cached_at: new Date(0).toISOString(),
    }));

    const configFile = path.join(cachePath, 'config.json');
    const original = fs.readFileSync(configFile);
    fs.writeFileSync(configFile, Buffer.alloc(original.length, 0x78));
    assert.equal(fs.statSync(configFile).size, original.length);

    const manifest = getDefaultManifest('semantic-health-test');
    manifest.embedding = {
      enabled: true,
      provider: 'local',
      model: 'Xenova/multilingual-e5-small',
      revision: 'test-revision',
      source: 'modelscope',
      dtype: 'uint8',
      cache_path: cachePath,
      dimension: 384,
      store: 'sqlite',
      index: 'flat',
    };

    const result = inspectSemanticReadiness(pmemPath, manifest);
    assert.ok(result.issues.some(issue => issue.type === 'semantic_cache_corrupt'));
  });
});
