import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const SKILLS_SRC_DIR = path.join(__dirname, '..', '..', 'skills', 'pmem');

interface AgentTarget {
  name: string;
  flag: string;
  skillsDir: string;
}

const AGENT_TARGETS: AgentTarget[] = [
  { name: 'Claude Code', flag: 'claude', skillsDir: path.join(os.homedir(), '.claude', 'skills') },
  { name: 'Codex', flag: 'codex', skillsDir: path.join(os.homedir(), '.codex', 'skills') },
  { name: 'Gemini', flag: 'gemini', skillsDir: path.join(os.homedir(), '.gemini', 'skills') },
];

export function installCommand(options: { skills?: boolean; claude?: boolean; codex?: boolean; gemini?: boolean; all?: boolean }): void {
  if (!options.skills) {
    console.log('Usage: pmem install --skills [--claude] [--codex] [--gemini] [--all]');
    console.log('');
    console.log('Install pmem skills to agent global skills directories:');
    console.log('  --claude   → ~/.claude/skills/pmem/');
    console.log('  --codex    → ~/.codex/skills/pmem/');
    console.log('  --gemini   → ~/.gemini/skills/pmem/');
    console.log('  --all       → all detected agents');
    return;
  }

  // Verify skills source exists
  if (!fs.existsSync(SKILLS_SRC_DIR)) {
    console.error('Skills source directory not found. Make sure pmem-ai is installed correctly.');
    console.error(`Expected: ${SKILLS_SRC_DIR}`);
    process.exit(2);
  }

  // Resolve targets
  const targets = resolveTargets(options);
  if (targets.length === 0) {
    console.log('No agent targets specified. Use --claude, --codex, --gemini, or --all.');
    console.log('Detected agents:');
    for (const t of AGENT_TARGETS) {
      const detected = fs.existsSync(t.skillsDir);
      console.log(`  ${t.name}: ${detected ? 'detected' : 'not detected'} (${t.skillsDir})`);
    }
    return;
  }

  let installed = 0;
  for (const target of targets) {
    const destDir = path.join(target.skillsDir, 'pmem');
    console.log(`Installing pmem skills for ${target.name}...`);

    try {
      copyDir(SKILLS_SRC_DIR, destDir);
      console.log(`  ✓ ${destDir}`);
      installed++;
    } catch (err: any) {
      console.error(`  ✗ Failed: ${err?.message || err}`);
    }
  }

  console.log(`\nInstalled ${installed}/${targets.length} agent(s).`);
  if (installed > 0) {
    console.log('Agents will now discover pmem skills automatically.');
  }
}

function resolveTargets(options: { claude?: boolean; codex?: boolean; gemini?: boolean; all?: boolean }): AgentTarget[] {
  if (options.all) {
    return AGENT_TARGETS.filter(t => fs.existsSync(t.skillsDir));
  }

  const selected: AgentTarget[] = [];
  if (options.claude) selected.push(AGENT_TARGETS[0]);
  if (options.codex) selected.push(AGENT_TARGETS[1]);
  if (options.gemini) selected.push(AGENT_TARGETS[2]);
  return selected;
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
