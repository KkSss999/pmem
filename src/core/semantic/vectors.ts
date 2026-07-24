/** Normalize a vector for storage and cosine-as-dot-product scans. */
export function normalizeVector(vector: ArrayLike<number>, expectedDimension?: number): Float32Array {
  if (expectedDimension !== undefined && vector.length !== expectedDimension) {
    throw new Error(`Embedding dimension mismatch: expected ${expectedDimension}, received ${vector.length}`);
  }
  if (vector.length === 0) throw new Error('Embedding vector must not be empty');
  let squaredNorm = 0;
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i];
    if (!Number.isFinite(value)) throw new Error('Embedding vector contains a non-finite value');
    squaredNorm += value * value;
  }
  if (squaredNorm === 0) throw new Error('Embedding vector must have a non-zero norm');
  const norm = Math.sqrt(squaredNorm);
  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) normalized[i] = vector[i] / norm;
  return normalized;
}

export function encodeVector(vector: ArrayLike<number>, expectedDimension?: number): Buffer {
  const normalized = normalizeVector(vector, expectedDimension);
  return Buffer.from(normalized.buffer, normalized.byteOffset, normalized.byteLength);
}

export function decodeVector(blob: Buffer, expectedDimension?: number): Float32Array {
  if (blob.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`Invalid semantic vector BLOB length: ${blob.byteLength}`);
  }
  const dimension = blob.byteLength / Float32Array.BYTES_PER_ELEMENT;
  if (expectedDimension !== undefined && dimension !== expectedDimension) {
    throw new Error(`Semantic vector BLOB dimension mismatch: expected ${expectedDimension}, received ${dimension}`);
  }
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, dimension);
}

export function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number {
  if (left.length !== right.length || left.length === 0) {
    throw new Error(`Cannot compare semantic vectors with dimensions ${left.length} and ${right.length}`);
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}
