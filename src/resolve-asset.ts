import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve to the plugin root regardless of cwd
const _thisDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
const _pluginRoot = dirname(_thisDir); // go up from dist/ to plugin root

export function resolveAsset(name: string): string {
    const candidates = [
        join(_pluginRoot, "src", name),  // plugin-root/src/  (where assets live)
        join(_thisDir, name),            // dist/  (fallback)
        join(_thisDir, "..", "src", name),
    ];
    for (const p of candidates) {
        try { if (existsSync(p)) return p; } catch { }
    }
    return candidates[0];
}
