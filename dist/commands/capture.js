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
exports.captureCommand = captureCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const capture_1 = require("../core/capture");
function captureCommand(options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, '.pmem');
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.error('Error: No .pmem directory found. Run `pmem init` first.');
        process.exit(2);
    }
    // Execute core capture
    const result = (0, capture_1.captureCore)(pmemPath, {
        auto: options.auto,
        summary: options.summary,
        next: options.next,
        full: options.full,
        force: options.force
    });
    if (!result.success) {
        console.error(`Error: ${result.message}`);
        process.exit(2);
    }
    if (result.skipped) {
        console.log(result.message);
    }
    else {
        console.log(result.message);
        if (result.tracePath) {
            console.log(`Trace card written: ${path.relative(cwd, result.tracePath)}`);
        }
    }
}
//# sourceMappingURL=capture.js.map