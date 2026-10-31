import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * onnxruntime-node ships every OS/arch plus the CUDA and TensorRT providers in
 * one tarball (~550MB) and onnxruntime-web duplicates a build that
 * Transformers.js already bundles into its Node dist (~140MB). CPU inference
 * needs ~45MB of that. Trim the rest once per install.
 *
 * shortcut: only the CPU provider is kept for the current platform; set
 * PMEM_ORT_GPU=1 before running to opt out, or delete the marker to re-run.
 */
export const ONNX_PRUNE_MARKER = '.onnx-runtime-pruned-v1';
const GPU_PROVIDER = /^libonnxruntime_providers_(cuda|tensorrt)\./;
const OS_DIRS: Partial<Record<NodeJS.Platform, string>> = {
  linux: 'linux',
  darwin: 'darwin',
  win32: 'win32',
};

function directorySize(target: string): number {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs
    .readdirSync(target)
    .reduce((total, entry) => total + directorySize(path.join(target, entry)), 0);
}

function removePath(target: string): number {
  try {
    const size = directorySize(target);
    fs.rmSync(target, { recursive: true, force: true });
    return size;
  } catch {
    return 0;
  }
}

/**
 * Delete the binaries this platform can never load. Returns the released bytes.
 * Never throws: a read-only or partially missing install simply prunes less.
 */
export function pruneOnnxRuntime(
  packageDir: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): number {
  const keepOs = OS_DIRS[platform];
  if (!keepOs) return 0;
  let released = 0;
  const binRoot = path.join(packageDir, 'bin');
  if (fs.existsSync(binRoot)) {
    for (const napi of fs.readdirSync(binRoot)) {
      const napiDir = path.join(binRoot, napi);
      for (const osDir of fs.readdirSync(napiDir)) {
        if (osDir !== keepOs) {
          released += removePath(path.join(napiDir, osDir));
          continue;
        }
        for (const archDir of fs.readdirSync(path.join(napiDir, osDir))) {
          const archPath = path.join(napiDir, osDir, archDir);
          if (archDir !== arch) {
            released += removePath(archPath);
            continue;
          }
          for (const file of fs.readdirSync(archPath)) {
            if (GPU_PROVIDER.test(file)) released += removePath(path.join(archPath, file));
          }
        }
      }
    }
  }
  return released;
}

export type PackageResolver = (specifier: string) => string | null;

/** True while any GPU provider binary for this platform is still on disk. */
function gpuProviderLeft(packageDir: string, platform: NodeJS.Platform, arch: string): boolean {
  const keepOs = OS_DIRS[platform];
  if (!keepOs) return false;
  const binRoot = path.join(packageDir, 'bin');
  if (!fs.existsSync(binRoot)) return false;
  for (const napi of fs.readdirSync(binRoot)) {
    const archDir = path.join(binRoot, napi, keepOs, arch);
    if (!fs.existsSync(archDir)) continue;
    if (fs.readdirSync(archDir).some((file) => GPU_PROVIDER.test(file))) return true;
  }
  return false;
}

function resolvePackageDir(specifier: string): string | null {
  try {
    let dir = path.dirname(require.resolve(specifier));
    while (!fs.existsSync(path.join(dir, 'package.json')) && dir !== path.dirname(dir))
      dir = path.dirname(dir);
    return fs.existsSync(path.join(dir, 'package.json')) ? dir : null;
  } catch {
    return null;
  }
}

/**
 * One-shot, marker-guarded prune so repeated CLI/SDK calls stay a single stat.
 * Must run before the inference runtime is imported in this process: on Windows
 * a loaded DLL cannot be deleted.
 */
export function ensureOnnxRuntimePruned(
  globalDir: string = path.join(os.homedir(), '.pmem-global'),
  resolve: PackageResolver = resolvePackageDir,
): number {
  if (process.env.PMEM_ORT_GPU) return 0;
  const marker = path.join(globalDir, ONNX_PRUNE_MARKER);
  try {
    if (fs.existsSync(marker)) return 0;
  } catch {
    return 0;
  }
  const runtimeDir = resolve('onnxruntime-node');
  if (!runtimeDir) return 0;
  const webDir = resolve('onnxruntime-web');
  // Guard against a resolver that maps both specifiers onto one directory.
  const keepWeb =
    webDir !== null &&
    path.basename(webDir) === 'onnxruntime-web' &&
    path.resolve(webDir) !== path.resolve(runtimeDir);
  const released = pruneOnnxRuntime(runtimeDir) + (keepWeb ? removePath(webDir!) : 0);
  // A locked install (a DLL already loaded on Windows, or a read-only directory)
  // must not be marked done, otherwise the next run would never retry.
  if (gpuProviderLeft(runtimeDir, process.platform, process.arch)) return released;
  try {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
  } catch {
    // A read-only global dir only costs a repeated stat on the next call.
  }
  return released;
}
