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
exports.moduleInferCommand = moduleInferCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const moduleInfer_1 = require("../core/moduleInfer");
function moduleInferCommand(options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, '.pmem');
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.error('Error: No .pmem directory found. Run `pmem init` first.');
        process.exit(2);
    }
    const inferred = (0, moduleInfer_1.inferModules)(cwd);
    if (inferred.length === 0) {
        console.log('No modules could be inferred from the current project structure.');
        return;
    }
    if (options.write && !options.dryRun) {
        const written = (0, moduleInfer_1.writeInferredModules)(pmemPath, inferred);
        console.log(`Successfully wrote ${written.length} inferred module card(s):`);
        for (const p of written) {
            console.log(`- ${path.relative(cwd, p)}`);
        }
        console.log('Next: run `pmem rebuild` to rebuild indexes.');
    }
    else {
        console.log(`Inferred ${inferred.length} module candidate(s) (dry-run):`);
        for (const m of inferred) {
            console.log(`\n- ID: ${m.id}`);
            console.log(`  Title: ${m.title}`);
            console.log(`  Purpose: ${m.purpose}`);
            console.log(`  Files: ${m.source_files.join(', ')}`);
            console.log(`  Knowledge:`);
            for (const k of m.current_knowledge) {
                console.log(`    - ${k}`);
            }
        }
        console.log('\nRun `pmem module infer --write` to save these cards to .pmem/modules/.');
    }
}
//# sourceMappingURL=module.js.map