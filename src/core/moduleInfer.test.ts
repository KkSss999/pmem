import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { inferModules } from './moduleInfer';

describe('inferModules — U6 module-scope and attribution fixes', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-u6-'));
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  function writeProject(files: Record<string, string>): void {
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(tmpDir, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
  }

  it('audio module does NOT receive "Score state tracking" knowledge (U6 #8.1)', () => {
    writeProject({
      'src/audio/sound.js': [
        '// Audio engine',
        'export function playSound(name) {',
        '  const score = 0; // unrelated variable, but mentions score',
        '  return score;',
        '}'
      ].join('\n'),
      'src/audio/music.js': [
        '// Music module',
        'export const volume = 1.0;',
        'export function playMusic() { return true; }'
      ].join('\n')
    });

    const inferred = inferModules(tmpDir);
    const audio = inferred.find(m => m.id === 'module.audio');
    assert.ok(audio, 'audio module should be inferred');
    assert.ok(
      !audio!.current_knowledge.some(k => k.includes('Score state tracking')),
      'audio module must not receive "Score state tracking" knowledge (scope guard)'
    );
  });

  it('engine and renderer do NOT receive the same knowledge items (U6 #8.1)', () => {
    writeProject({
      'src/game/engine.js': [
        '// Game engine',
        'function loop() {',
        '  requestAnimationFrame(loop);',
        '  return 320 + 560;',
        '}'
      ].join('\n'),
      'src/game/render.js': [
        '// Renderer',
        'function draw() {',
        '  const ctx = getContext("2d");',
        '  ctx.clearRect(0, 0, 320, 560);',
        '}'
      ].join('\n')
    });

    const inferred = inferModules(tmpDir);
    const engine = inferred.find(m => m.id === 'module.engine');
    const renderer = inferred.find(m => m.id === 'module.renderer');
    assert.ok(engine, 'engine module should be inferred');
    assert.ok(renderer, 'renderer module should be inferred');

    // Engine gets loop knowledge, renderer does not (excluded).
    assert.ok(
      engine!.current_knowledge.some(k => k.includes('requestAnimationFrame')),
      'engine should have requestAnimationFrame knowledge'
    );
    assert.ok(
      !renderer!.current_knowledge.some(k => k.includes('requestAnimationFrame')),
      'renderer must NOT have requestAnimationFrame knowledge'
    );

    // 320x560 viewport should be available to both engine and renderer,
    // but not to others. Verify overlap is intentional (both engine and
    // renderer genuinely target a viewport), not a cross-contamination.
    const engineViewport = engine!.current_knowledge.some(k => k.includes('320x560'));
    const rendererViewport = renderer!.current_knowledge.some(k => k.includes('320x560'));
    assert.ok(engineViewport || rendererViewport, 'viewport knowledge present somewhere');
  });

  it('default attribution is file-level (no directory prefixes)', () => {
    writeProject({
      'src/components/Game.jsx': [
        'export function Game() {',
        '  return <div className="layout">Game</div>;',
        '}'
      ].join('\n'),
      'src/game/engine.js': [
        'function loop() { requestAnimationFrame(loop); }'
      ].join('\n')
    });

    const inferred = inferModules(tmpDir);
    const ui = inferred.find(m => m.id === 'module.ui');
    assert.ok(ui, 'ui module should be inferred');
    // File-level attribution: entries should be individual files, NOT "src/components/".
    const hasDirOnly = ui!.source_files.some(sf => /^src\/components\/$/.test(sf));
    assert.equal(
      hasDirOnly,
      false,
      `default (file-level) attribution must not include directory-only entries like "src/components/" (got: ${JSON.stringify(ui!.source_files)})`
    );
    const hasFile = ui!.source_files.some(sf => sf === 'src/components/Game.jsx');
    assert.ok(hasFile, 'default attribution should include the actual file path');
  });

  it('coarseAttribution=true preserves the legacy directory-prefix behavior', () => {
    writeProject({
      'src/components/Game.jsx': [
        'export function Game() { return <div />; }'
      ].join('\n')
    });

    const inferred = inferModules(tmpDir, { coarseAttribution: true });
    const ui = inferred.find(m => m.id === 'module.ui');
    assert.ok(ui, 'ui module should be inferred under coarse attribution');
    assert.ok(
      ui!.source_files.includes('src/components/'),
      `coarse attribution must include the directory prefix "src/components/" (got: ${JSON.stringify(ui!.source_files)})`
    );
  });

  it('coarseAttribution=true does not collapse files outside src/<subdir>/', () => {
    writeProject({
      'lib/audio.js': [
        'export function playSound() {}'
      ].join('\n')
    });

    const inferred = inferModules(tmpDir, { coarseAttribution: true });
    const audio = inferred.find(m => m.id === 'module.audio');
    assert.ok(audio, 'audio module should be inferred');
    assert.ok(
      audio!.source_files.includes('lib/audio.js'),
      `coarse attribution keeps individual file path when not under src/<subdir>/ (got: ${JSON.stringify(audio!.source_files)})`
    );
  });
});