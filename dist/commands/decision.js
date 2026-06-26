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
exports.decisionInferCommand = decisionInferCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const decisionInfer_1 = require("../core/decisionInfer");
function decisionInferCommand(options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, '.pmem');
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.error('Error: No .pmem directory found. Run `pmem init` first.');
        process.exit(2);
    }
    const inferred = (0, decisionInfer_1.inferDecisions)(pmemPath);
    if (inferred.length === 0) {
        console.log('No decisions could be inferred from the current project traces.');
        return;
    }
    if (options.write) {
        const written = (0, decisionInfer_1.writeInferredDecisions)(pmemPath, inferred);
        console.log(`Successfully wrote ${written.length} inferred decision card(s):`);
        for (const p of written) {
            console.log(`- ${path.relative(cwd, p)}`);
        }
        console.log('Next: run `pmem rebuild` to rebuild indexes.');
    }
    else {
        const candidatePath = (0, decisionInfer_1.writeDecisionCandidates)(pmemPath, inferred);
        console.log(`Inferred ${inferred.length} decision candidate(s).`);
        console.log(`Candidate list written to: ${path.relative(cwd, candidatePath)}`);
        console.log('Run `pmem decision infer --write` to promote them to formal cards.');
    }
}
//# sourceMappingURL=decision.js.map