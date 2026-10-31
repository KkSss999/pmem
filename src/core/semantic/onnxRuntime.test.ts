import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureOnnxRuntimePruned, ONNX_PRUNE_MARKER, pruneOnnxRuntime } from './onnxRuntime';

function fakeRuntime(): { root: string; files: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-ort-'));
  const files = [
    'bin/napi-v6/linux/x64/libonnxruntime.so.1',
    'bin/napi-v6/linux/x64/libonnxruntime_providers_cuda.so',
    'bin/napi-v6/linux/x64/libonnxruntime_providers_tensorrt.so',
    'bin/napi-v6/linux/x64/libonnxruntime_providers_shared.so',
    'bin/napi-v6/linux/x64/onnxruntime_binding.node',
    'bin/napi-v6/linux/arm64/libonnxruntime.so.1',
    'bin/napi-v6/darwin/arm64/libonnxruntime.1.dylib',
    'bin/napi-v6/win32/x64/onnxruntime.dll',
    'package.json',
  ];
  for (const relative of files) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, relative);
  }
  return { root, files };
}

describe('onnx runtime pruning', () => {
  it('keeps only the current platform CPU core and reports the released bytes', () => {
    const { root } = fakeRuntime();
    try {
      const released = pruneOnnxRuntime(root, 'linux', 'x64');
      const remaining = fs.readdirSync(path.join(root, 'bin/napi-v6')).sort();
      assert.deepStrictEqual(remaining, ['linux']);
      assert.deepStrictEqual(fs.readdirSync(path.join(root, 'bin/napi-v6/linux')), ['x64']);
      assert.deepStrictEqual(fs.readdirSync(path.join(root, 'bin/napi-v6/linux/x64')).sort(), [
        'libonnxruntime.so.1',
        'libonnxruntime_providers_shared.so',
        'onnxruntime_binding.node',
      ]);
      assert.ok(released > 0);
      assert.strictEqual(pruneOnnxRuntime(root, 'linux', 'x64'), 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does nothing for an unknown platform instead of deleting everything', () => {
    const { root, files } = fakeRuntime();
    try {
      assert.strictEqual(pruneOnnxRuntime(root, 'aix' as NodeJS.Platform, 'x64'), 0);
      assert.ok(files.every((file) => fs.existsSync(path.join(root, file))));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks the global dir so repeated calls stay a single stat and honours the GPU opt-out', () => {
    const { root } = fakeRuntime();
    const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-ort-marker-'));
    // Never resolve the real install: the test must not touch its own node_modules.
    const resolve = (specifier: string) => (specifier === 'onnxruntime-node' ? root : null);
    try {
      assert.ok(ensureOnnxRuntimePruned(globalDir, resolve) > 0);
      assert.ok(fs.existsSync(path.join(globalDir, ONNX_PRUNE_MARKER)));
      assert.strictEqual(ensureOnnxRuntimePruned(globalDir, resolve), 0);

      process.env.PMEM_ORT_GPU = '1';
      try {
        const optOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-ort-marker-'));
        try {
          assert.strictEqual(ensureOnnxRuntimePruned(optOutDir, resolve), 0);
          assert.strictEqual(fs.existsSync(path.join(optOutDir, ONNX_PRUNE_MARKER)), false);
        } finally {
          fs.rmSync(optOutDir, { recursive: true, force: true });
        }
      } finally {
        delete process.env.PMEM_ORT_GPU;
      }
    } finally {
      fs.rmSync(globalDir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not mark the runtime as pruned when the binaries are locked', () => {
    const { root } = fakeRuntime();
    const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-ort-marker-'));
    const x64 = path.join(root, 'bin/napi-v6/linux/x64');
    fs.chmodSync(x64, 0o555);
    try {
      ensureOnnxRuntimePruned(globalDir, () => root);
      assert.ok(fs.readdirSync(x64).some((file) => file.includes('providers_cuda')));
      assert.strictEqual(fs.existsSync(path.join(globalDir, ONNX_PRUNE_MARKER)), false);
    } finally {
      fs.chmodSync(x64, 0o755);
      fs.rmSync(globalDir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('never deletes a directory a resolver mistakenly maps onto the runtime package', () => {
    const { root } = fakeRuntime();
    const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-ort-marker-'));
    try {
      ensureOnnxRuntimePruned(globalDir, () => root);
      assert.ok(fs.existsSync(path.join(root, 'bin/napi-v6/linux/x64/libonnxruntime.so.1')));
      assert.ok(fs.existsSync(path.join(root, 'package.json')));
    } finally {
      fs.rmSync(globalDir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('is a no-op when the inference runtime is not installed', () => {
    const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-ort-marker-'));
    try {
      assert.strictEqual(
        ensureOnnxRuntimePruned(globalDir, () => null),
        0,
      );
      assert.strictEqual(fs.existsSync(path.join(globalDir, ONNX_PRUNE_MARKER)), false);
    } finally {
      fs.rmSync(globalDir, { recursive: true, force: true });
    }
  });
});
