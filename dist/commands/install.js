"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.installCommand = installCommand;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const agentRules_1 = require("../core/agentRules");
const SKILLS_SRC_DIR = path.join(__dirname, '..', '..', 'skills', 'pmem');
const AGENT_TARGETS = [
    { name: 'Claude Code', flag: 'claude', skillsDir: path.join(os.homedir(), '.claude', 'skills') },
    { name: 'Codex', flag: 'codex', skillsDir: path.join(os.homedir(), '.codex', 'skills') },
    { name: 'Gemini', flag: 'gemini', skillsDir: path.join(os.homedir(), '.gemini', 'skills') },
];
function installCommand(options) {
    if (!options.skills && !options.agentRules) {
        console.log('Usage:');
        console.log('  pmem install --skills [--claude] [--codex] [--gemini] [--all]');
        console.log('  pmem install --agent-rules [--claude] [--codex] [--gemini] [--cursor] [--cline] [--aider] [--windsurf] [--all]');
        console.log('');
        console.log('Install options:');
        console.log('  --skills        Install global agent skill files');
        console.log('  --agent-rules   Install compact agent workspace guidelines (AGENTS.md, etc.)');
        return;
    }
    // Handle agent rules installation
    if (options.agentRules) {
        console.log('Installing agent guidelines/rules in workspace...');
        const written = (0, agentRules_1.writeAgentRules)(process.cwd(), options);
        if (written.length > 0) {
            console.log('\n✓ Rules files written successfully:');
            for (const file of written) {
                console.log(`  - ${file}`);
            }
        }
        else {
            console.log('No rules files written (check option flags).');
        }
        return;
    }
    // Handle skills installation
    if (options.skills) {
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
            }
            catch (err) {
                console.error(`  ✗ Failed: ${err?.message || err}`);
            }
        }
        console.log(`\nInstalled ${installed}/${targets.length} agent(s).`);
        if (installed > 0) {
            console.log('Agents will now discover pmem skills automatically.');
        }
    }
}
function resolveTargets(options) {
    if (options.all) {
        return AGENT_TARGETS.filter(t => fs.existsSync(t.skillsDir));
    }
    const selected = [];
    if (options.claude)
        selected.push(AGENT_TARGETS[0]);
    if (options.codex)
        selected.push(AGENT_TARGETS[1]);
    if (options.gemini)
        selected.push(AGENT_TARGETS[2]);
    return selected;
}
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        }
        else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
//# sourceMappingURL=install.js.map