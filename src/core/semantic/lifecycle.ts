import { createHash } from 'crypto';
import type { SemanticChunkRow, SemanticMetaRow } from '../../types';
import { chunkCard } from './chunks';
import { filterSafeSemanticCards } from './safety';
import { decodeVector, encodeVector, normalizeVector } from './vectors';
import { SEMANTIC_PIPELINE_VERSION } from './types';
import type {
  EmbeddingProvider,
  SemanticCardDocument,
  SemanticCardMatch,
  SemanticChunk,
  SemanticChunkMatch,
  SemanticDatabase,
  SemanticIndexOptions,
  SemanticIndexResult,
  SemanticStatus,
} from './types';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createSemanticSchema(db: SemanticDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pipeline_version INTEGER NOT NULL DEFAULT 1,
      model_id TEXT NOT NULL,
      model_revision TEXT NOT NULL,
      dimension INTEGER NOT NULL CHECK (dimension > 0),
      index_content_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      built_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS semantic_chunks (
      chunk_id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      heading TEXT,
      heading_path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      context_hash TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      model_revision TEXT NOT NULL,
      dimension INTEGER NOT NULL CHECK (dimension > 0),
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_card_id ON semantic_chunks(card_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_content_hash ON semantic_chunks(content_hash);
  `);
  try { db.exec('ALTER TABLE semantic_meta ADD COLUMN pipeline_version INTEGER NOT NULL DEFAULT 1'); } catch {}
  try { db.exec("ALTER TABLE semantic_chunks ADD COLUMN context TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE semantic_chunks ADD COLUMN context_hash TEXT NOT NULL DEFAULT ''"); } catch {}
}

export function getSemanticStatus(db: SemanticDatabase): SemanticStatus {
  createSemanticSchema(db);
  const meta = db.prepare('SELECT * FROM semantic_meta WHERE id = 1').get() as SemanticMetaRow | undefined;
  const actual = db.prepare('SELECT COUNT(*) AS count FROM semantic_chunks').get() as { count: number };
  const cards = db.prepare('SELECT COUNT(DISTINCT card_id) AS count FROM semantic_chunks').get() as { count: number };
  if (!meta) {
    return {
      available: false,
      pipelineVersion: null,
      compatible: true,
      modelId: null,
      revision: null,
      dimension: null,
      cardCount: cards.count,
      chunkCount: actual.count,
      indexContentHash: null,
      builtAt: null,
    };
  }
  return {
    available: meta.pipeline_version === SEMANTIC_PIPELINE_VERSION && meta.chunk_count === actual.count,
    pipelineVersion: meta.pipeline_version,
    compatible: meta.pipeline_version === SEMANTIC_PIPELINE_VERSION,
    modelId: meta.model_id,
    revision: meta.model_revision,
    dimension: meta.dimension,
    cardCount: cards.count,
    chunkCount: actual.count,
    indexContentHash: meta.index_content_hash,
    builtAt: meta.built_at,
  };
}

export function clearSemanticIndex(db: SemanticDatabase): number {
  createSemanticSchema(db);
  return db.transaction(() => {
    const deleted = db.prepare('DELETE FROM semantic_chunks').run().changes;
    db.prepare('DELETE FROM semantic_meta').run();
    return deleted;
  })();
}

export function deleteSemanticCardChunks(db: SemanticDatabase, cardId: string): number {
  createSemanticSchema(db);
  return db.transaction(() => {
    const deleted = db.prepare('DELETE FROM semantic_chunks WHERE card_id = ?').run(cardId).changes;
    refreshMetaFromStoredChunks(db, new Date().toISOString());
    return deleted;
  })();
}

function validateProvider(provider: EmbeddingProvider): void {
  if (!provider.modelId.trim()) throw new Error('Embedding provider modelId must not be empty');
  if (!provider.revision.trim()) throw new Error('Embedding provider revision must not be empty');
  if (!Number.isInteger(provider.dimension) || provider.dimension <= 0) {
    throw new Error('Embedding provider dimension must be a positive integer');
  }
}

function assertUniqueCardIds(cards: readonly SemanticCardDocument[]): void {
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) throw new Error(`Duplicate semantic card document: ${card.id}`);
    seen.add(card.id);
  }
}

interface PreparedChunk {
  chunk: SemanticChunk;
  vector: Buffer;
  createdAt: string;
}

async function embedChunks(
  chunks: readonly SemanticChunk[],
  provider: EmbeddingProvider,
  batchSize: number,
  now: string,
): Promise<PreparedChunk[]> {
  const prepared: PreparedChunk[] = [];
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const texts = batch.map(chunk => chunk.content);
    const vectors = await provider.embedPassages(texts);
    if (vectors.length !== batch.length) {
      throw new Error(`Embedding provider returned ${vectors.length} vectors for ${batch.length} passages`);
    }
    for (let i = 0; i < batch.length; i++) {
      prepared.push({
        chunk: batch[i],
        vector: encodeVector(vectors[i], provider.dimension),
        createdAt: now,
      });
    }
  }
  return prepared;
}

function indexHash(rows: readonly { chunk_id: string; content_hash: string; context_hash?: string }[]): string {
  return sha256([...rows]
    .sort((a, b) => a.chunk_id.localeCompare(b.chunk_id))
    .map(row => `${row.chunk_id}:${row.content_hash}:${row.context_hash ?? ''}`)
    .join('\n'));
}

function refreshMetaFromStoredChunks(
  db: SemanticDatabase,
  builtAt: string,
  emptyIdentity?: { modelId: string; revision: string; dimension: number },
): void {
  const rows = db.prepare(
    'SELECT chunk_id, content_hash, context_hash, model_id, model_revision, dimension FROM semantic_chunks ORDER BY chunk_id'
  ).all() as Array<{ chunk_id: string; content_hash: string; context_hash: string; model_id: string; model_revision: string; dimension: number }>;
  if (rows.length === 0) {
    const existing = db.prepare('SELECT model_id, model_revision, dimension FROM semantic_meta WHERE id = 1').get() as
      { model_id: string; model_revision: string; dimension: number } | undefined;
    const identity = emptyIdentity ?? (existing ? {
      modelId: existing.model_id,
      revision: existing.model_revision,
      dimension: existing.dimension,
    } : undefined);
    if (!identity) {
      db.prepare('DELETE FROM semantic_meta').run();
      return;
    }
    db.prepare(`
      INSERT OR REPLACE INTO semantic_meta
        (id, pipeline_version, model_id, model_revision, dimension, index_content_hash, chunk_count, built_at)
      VALUES (1, ?, ?, ?, ?, ?, 0, ?)
    `).run(SEMANTIC_PIPELINE_VERSION, identity.modelId, identity.revision, identity.dimension, indexHash([]), builtAt);
    return;
  }
  const first = rows[0];
  db.prepare(`
    INSERT OR REPLACE INTO semantic_meta
      (id, pipeline_version, model_id, model_revision, dimension, index_content_hash, chunk_count, built_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
  `).run(SEMANTIC_PIPELINE_VERSION, first.model_id, first.model_revision, first.dimension, indexHash(rows), rows.length, builtAt);
}

/**
 * Build the derived semantic index from a complete current card snapshot.
 * Unsafe cards are removed before chunk creation and before provider invocation.
 * Provider work completes before the transaction, so failures preserve the old index.
 */
export async function rebuildSemanticIndex(
  db: SemanticDatabase,
  documents: readonly SemanticCardDocument[],
  provider: EmbeddingProvider,
  options: SemanticIndexOptions,
): Promise<SemanticIndexResult> {
  createSemanticSchema(db);
  validateProvider(provider);
  assertUniqueCardIds(documents);
  const batchSize = options.batchSize ?? 32;
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error('Semantic batchSize must be a positive integer');

  const allowlistedDocuments = filterSafeSemanticCards(documents);
  const safeIds = new Set(allowlistedDocuments.map(document => document.id));
  const safeDocuments = allowlistedDocuments.map(document => ({
    ...document,
    relatedCardIds: document.relatedCardIds?.filter(id => safeIds.has(id)),
  }));
  const desiredChunks = safeDocuments.flatMap(card => chunkCard(card, options));
  const desiredById = new Map(desiredChunks.map(chunk => [chunk.chunkId, chunk]));
  const existing = db.prepare('SELECT * FROM semantic_chunks').all() as SemanticChunkRow[];
  const priorStatus = getSemanticStatus(db);
  const compatible = priorStatus.compatible && existing.every(row =>
    row.model_id === provider.modelId &&
    row.model_revision === provider.revision &&
    row.dimension === provider.dimension
  );
  const forceFull = options.mode === 'full' || !compatible;
  const reusable = new Map<string, SemanticChunkRow>();
  if (!forceFull) {
    for (const row of existing) {
      const desired = desiredById.get(row.chunk_id);
      if (desired && desired.contentHash === row.content_hash) reusable.set(row.chunk_id, row);
    }
  }
  const needsEmbedding = desiredChunks.filter(chunk => !reusable.has(chunk.chunkId));
  const now = (options.now ?? (() => new Date()))().toISOString();
  const embedded = await embedChunks(needsEmbedding, provider, batchSize, now);
  const embeddedById = new Map(embedded.map(item => [item.chunk.chunkId, item]));
  let chunksDeleted = 0;

  options.beforeCommit?.();
  db.transaction(() => {
    if (forceFull) {
      chunksDeleted = db.prepare('DELETE FROM semantic_chunks').run().changes;
    } else {
      const deleteStmt = db.prepare('DELETE FROM semantic_chunks WHERE chunk_id = ?');
      for (const row of existing) {
        if (!desiredById.has(row.chunk_id)) chunksDeleted += deleteStmt.run(row.chunk_id).changes;
      }
    }

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO semantic_chunks
        (chunk_id, card_id, heading, heading_path, ordinal, content, content_hash, context, context_hash,
         model_id, model_revision, dimension, vector, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const chunk of desiredChunks) {
      const prior = reusable.get(chunk.chunkId);
      const fresh = embeddedById.get(chunk.chunkId);
      if (!prior && !fresh) throw new Error(`No vector available for semantic chunk ${chunk.chunkId}`);
      upsert.run(
        chunk.chunkId,
        chunk.cardId,
        chunk.heading,
        JSON.stringify(chunk.headingPath),
        chunk.ordinal,
        chunk.content,
        chunk.contentHash,
        chunk.context,
        chunk.contextHash,
        provider.modelId,
        provider.revision,
        provider.dimension,
        prior?.vector ?? fresh!.vector,
        prior?.created_at ?? fresh!.createdAt,
        now,
      );
    }
    refreshMetaFromStoredChunks(db, now, {
      modelId: provider.modelId,
      revision: provider.revision,
      dimension: provider.dimension,
    });
  })();

  const rows = db.prepare('SELECT chunk_id, content_hash, context_hash FROM semantic_chunks ORDER BY chunk_id').all() as Array<{ chunk_id: string; content_hash: string; context_hash: string }>;
  return {
    mode: options.mode,
    cardsSeen: documents.length,
    cardsExcluded: documents.length - safeDocuments.length,
    chunksTotal: desiredChunks.length,
    chunksEmbedded: needsEmbedding.length,
    chunksReused: reusable.size,
    chunksDeleted,
    indexContentHash: indexHash(rows),
  };
}

/** Linear cosine scan; query vectors are normalized locally before comparison. */
export function searchSemanticChunks(
  db: SemanticDatabase,
  queryVector: readonly number[],
  limit: number = 20,
): SemanticChunkMatch[] {
  if (!Number.isInteger(limit) || limit <= 0) return [];
  const status = getSemanticStatus(db);
  if (!status.available || status.dimension === null) return [];
  const query = normalizeVector(queryVector, status.dimension);
  const rows = db.prepare(`
    SELECT sc.*
    FROM semantic_chunks sc
    JOIN cards c ON c.id = sc.card_id
    WHERE c.is_deleted = 0
      AND c.is_candidate = 0
      AND COALESCE(c.sensitivity, '') <> 'secret'
      AND c.trust_label IN ('system_trusted', 'user_confirmed', 'application_trusted')
      AND (c.superseded_by IS NULL OR c.superseded_by = '' OR c.superseded_by = '[]')
  `).all() as SemanticChunkRow[];
  return rows.map(row => {
    const vector = decodeVector(row.vector, status.dimension!);
    let similarity = 0;
    for (let i = 0; i < query.length; i++) similarity += query[i] * vector[i];
    return { ...row, similarity };
  }).filter(row => row.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || a.chunk_id.localeCompare(b.chunk_id))
    .slice(0, limit);
}

/** Embed an E5 query and return only the best evidence chunk for each parent card. */
export async function searchSemanticCards(
  db: SemanticDatabase,
  queryText: string,
  provider: EmbeddingProvider,
  limit: number = 10,
): Promise<SemanticCardMatch[]> {
  validateProvider(provider);
  const status = getSemanticStatus(db);
  if (!status.available) return [];
  if (status.modelId !== provider.modelId || status.revision !== provider.revision || status.dimension !== provider.dimension) {
    throw new Error('Embedding provider is incompatible with the stored semantic index');
  }
  const vector = await provider.embedQuery(queryText);
  const chunks = searchSemanticChunks(db, vector, Math.max(limit * 8, limit));
  const bestByCard = new Map<string, SemanticChunkMatch>();
  for (const chunk of chunks) {
    if (!bestByCard.has(chunk.card_id)) bestByCard.set(chunk.card_id, chunk);
  }
  return Array.from(bestByCard.values()).slice(0, limit).map(chunk => ({
    cardId: chunk.card_id,
    chunkId: chunk.chunk_id,
    heading: chunk.heading,
    headingPath: JSON.parse(chunk.heading_path) as string[],
    content: chunk.content,
    context: chunk.context,
    similarity: chunk.similarity,
    modelId: chunk.model_id,
    modelRevision: chunk.model_revision,
  }));
}
