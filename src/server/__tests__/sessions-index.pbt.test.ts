import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as fc from "fast-check";

// ─── Property 10: Stale Index Entry Cleanup ───
// **Validates: Requirements 8.6**

// Use a unique base dir per test run to avoid collisions
const TEST_BASE = join(tmpdir(), `sessions-index-pbt-${Date.now()}`);

// Mock AGENTS_STATE_DIR and DASHBOARD_SESSIONS_DIR to point to our temp dirs.
// We point them to empty dirs so refreshSessionIndex() discovery phase
// doesn't pick up our temp files as "new" agent sessions.
vi.mock("../api-utils.js", async (importOriginal) => {
    const orig = (await importOriginal()) as any;
    const { join: pjoin } = await import("node:path");
    const { tmpdir: ptmpdir } = await import("node:os");
    // Use a separate empty dir for agents/dashboard so discovery doesn't interfere
    const base = pjoin(ptmpdir(), `sessions-index-pbt-${Date.now()}-dirs`);
    return {
        ...orig,
        AGENTS_STATE_DIR: pjoin(base, "agents"),
        DASHBOARD_SESSIONS_DIR: pjoin(base, "dashboard-sessions"),
    };
});

import { sessionIndex, refreshSessionIndex } from "../routes/sessions.js";
import { AGENTS_STATE_DIR, DASHBOARD_SESSIONS_DIR } from "../api-utils.js";

function ensureDirs() {
    mkdirSync(TEST_BASE, { recursive: true });
    // Ensure the mocked dirs exist so refreshSessionIndex doesn't throw
    mkdirSync(AGENTS_STATE_DIR, { recursive: true });
    mkdirSync(DASHBOARD_SESSIONS_DIR, { recursive: true });
}

function cleanDirs() {
    try { rmSync(TEST_BASE, { recursive: true, force: true }); } catch { }
}

// ─── Arbitrary: generate a list of session entries, each with a real temp file ───

/** Generate a simple alphanumeric session key */
const sessionKeyArb = fc.stringMatching(/^[a-z][a-z0-9]{2,15}$/).filter(s => s.length >= 3);

/** Generate a session entry config (we'll create the file on disk during the test) */
const sessionEntryConfigArb = fc.record({
    sessionKey: sessionKeyArb,
    agentId: fc.stringMatching(/^[a-z]{3,10}$/),
    channel: fc.constantFrom("cli", "dashboard", "discord", "slack", "api"),
});

type EntryConfig = { sessionKey: string; agentId: string; channel: string };

/**
 * Generate a set of unique session entry configs.
 * We use uniqueBy on sessionKey to avoid duplicate keys.
 */
const entrySetArb = fc.uniqueArray(sessionEntryConfigArb, {
    minLength: 1,
    maxLength: 20,
    comparator: (a, b) => a.sessionKey === b.sessionKey,
});

describe("Property 10: Stale Index Entry Cleanup", () => {
    let fileCounter = 0;

    beforeEach(() => {
        cleanDirs();
        ensureDirs();
        sessionIndex.clear();
        fileCounter = 0;
    });

    afterAll(() => {
        cleanDirs();
    });

    /** Create a real temp file for a session entry and return the file path */
    function createTempFile(config: EntryConfig): string {
        const filePath = join(TEST_BASE, `${config.sessionKey}-${fileCounter++}.jsonl`);
        const header = JSON.stringify({
            type: "session",
            agentId: config.agentId,
            channel: config.channel,
            sessionId: config.sessionKey,
        });
        writeFileSync(filePath, header + "\n", "utf-8");
        return filePath;
    }

    it("after refreshSessionIndex(), no entry references a non-existent file", async () => {
        await fc.assert(
            fc.asyncProperty(
                entrySetArb,
                // Generate a boolean mask for which files to delete
                fc.infiniteStream(fc.boolean()),
                async (entries, deleteStream) => {
                    // Reset state for each iteration
                    sessionIndex.clear();

                    // 1. Create temp files and populate sessionIndex
                    const filePaths: string[] = [];
                    for (const config of entries) {
                        const fp = createTempFile(config);
                        filePaths.push(fp);

                        const { statSync } = await import("node:fs");
                        const st = statSync(fp);

                        sessionIndex.set(config.sessionKey, {
                            sessionKey: config.sessionKey,
                            agentId: config.agentId,
                            filePath: fp,
                            channel: config.channel,
                            gatewayKey: "",
                            messageCount: 1,
                            updatedAt: new Date().toISOString(),
                            mtime: st.mtimeMs,
                        });
                    }

                    // 2. Randomly delete a subset of files
                    const deleteIterator = deleteStream[Symbol.iterator]();
                    for (const fp of filePaths) {
                        const shouldDelete = deleteIterator.next().value;
                        if (shouldDelete) {
                            try { unlinkSync(fp); } catch { }
                        }
                    }

                    // 3. Call refreshSessionIndex
                    await refreshSessionIndex();

                    // 4. Assert: no entry in sessionIndex references a non-existent file
                    const { existsSync } = await import("node:fs");
                    for (const [key, entry] of sessionIndex.entries()) {
                        if (entry.filePath) {
                            expect(
                                existsSync(entry.filePath),
                                `Entry "${key}" references non-existent file: ${entry.filePath}`,
                            ).toBe(true);
                        }
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
