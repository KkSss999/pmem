import { Manifest, ManifestV03, InitMode, ResolvedConfig } from '../types';
export declare const V064_DEFAULT_TYPES: string[];
export declare const V064_DEFAULT_MERGE_TYPES: string[];
export declare const V064_DEFAULT_CREATABLE_TYPES: string[];
/**
 * Compute a ResolvedConfig from a manifest object.
 *
 * v0.7.0 contract:
 * - If manifest.schema.card_types is defined → use it.
 * - Otherwise → fall back to the v0.6.4 id_pattern whitelist.
 * - This is a PURE FUNCTION — it does NOT write back to the manifest file.
 *   The only path that writes schema.* fields is `pmem init --domain ...`.
 */
export declare function resolveConfig(manifest: Manifest): ResolvedConfig;
/**
 * Render a card_policy.id_pattern by replacing the `{types}` placeholder
 * with the regex-escaped card type names.
 *
 * If the pattern contains `{types}`, it is replaced with the alternation
 * of all card_types (each regex-escaped).  If the pattern does NOT contain
 * `{types}`, it is returned unchanged (v0.6.4 compat).
 */
export declare function renderIdPattern(idPattern: string, cardTypes: string[]): string;
export declare function getDefaultManifest(projectName: string, initMode?: InitMode): ManifestV03;
export declare function getDefaultManifestV03(projectName: string, initMode?: InitMode): ManifestV03;
export declare function loadManifest(pmemDir: string): Manifest | null;
export declare function saveManifest(pmemDir: string, manifest: Manifest): void;
//# sourceMappingURL=manifest.d.ts.map