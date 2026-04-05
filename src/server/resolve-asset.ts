import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve to the plugin root regardless of cwd
const _thisDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
const _pluginRoot = dirname(dirname(_thisDir)); // go up from dist/server/ to plugin root

export function resolveAsset(name: string): string {
    const candidates = [
        join(_pluginRoot, "src", "assets", name),  // plugin-root/src/assets/ (where assets live)
        join(_thisDir, "..", "assets", name),       // dist/assets/ (fallback after build)
        join(_thisDir, name),                       // dist/server/ (legacy fallback)
        join(_pluginRoot, "src", name),             // plugin-root/src/ (legacy fallback)
    ];
    for (const p of candidates) {
        try { if (existsSync(p)) return p; } catch { }
    }
    return candidates[0];
}
