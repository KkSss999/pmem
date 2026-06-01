import { Manifest, ManifestV03, InitMode } from '../types';
export declare function getDefaultManifest(projectName: string, initMode?: InitMode): ManifestV03;
export declare function getDefaultManifestV03(projectName: string, initMode?: InitMode): ManifestV03;
export declare function loadManifest(pmemDir: string): Manifest | null;
export declare function saveManifest(pmemDir: string, manifest: Manifest): void;
//# sourceMappingURL=manifest.d.ts.map