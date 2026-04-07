import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Compute test dirs at module level using a stable identifier
const TEST_BASE = join(tmpdir(), "session-refresh-test");

// vi.mock is hoisted — must use inline values, not variables
vi.mock("../api-utils.js", async (importOriginal) => {
    const orig = (await importOriginal()) as any;
    const { join: pjoin } = await import("node:path");
    const { tmpdir: ptmpdir } = await import("node:os");
    const base = pjoin(ptmpdir(), "session-refresh-test");
    return {
        ...orig,
        AGENTS_STATE_DIR: pjoin(base, "agents"),
        DASHBOARD_SESSIONS_DIR: pjoin(base, "dashboard-sessions"),
    };
});

import { sessionIndex, refreshSessionIndex } from "../routes/sessions.js";

const AGENTS_DIR = join(TEST_BASE, "agents");
const DASH_DIR = join(TEST_BASE, "dashboard-sessions");

function ensureDirs() {
    mkdirSync(AGENTS_DIR, { recursive: true });
    mkdirSync(DASH_DIR, { recursive: true });
}

function cleanDirs() {
    try { rmSync(TEST_BASE, { recursive: true, force: true }); } catch { }
}

function makeAgentSessionDir(agentId: string): string {
    const dir = join(AGENTS_DIR, agentId, "sessions");
    mkdirSync(dir, { recursive: true });
    return dir;
}

function writeJsonlFile(filePath: string, header: any, messages: any[]): void {
    const lines = [JSON.stringify(header)];
    for (const msg of messages) {
        lines.push(JSON.stringify(msg));
    }
    writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}

function writeDashboardJson(filePath: string, data: any): void {
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

describe("refreshSessionIndex", () => {
    beforeEach(() => {
        cleanDirs();
        ensureDirs();
        sessionIndex.clear();
    });

    afterAll(() => {
        cleanDirs();
    });

    it("removes entries for deleted files", async () => {
        const fakePath = join(TEST_BASE, "nonexistent.jsonl");
        sessionIndex.set("deleted-session", {
            sessionKey: "deleted-session",
            agentId: "agent1",
            filePath: fakePath,
            channel: "cli",
            gatewayKey: "",
            messageCount: 5,
            updatedAt: "2024-01-01T00:00:00Z",
            mtime: 1000,
        });

        expect(sessionIndex.has("deleted-session")).toBe(true);
        await refreshSessionIndex();
        expect(sessionIndex.has("deleted-session")).toBe(false);
    });

    it("removes entries with no filePath", async () => {
        sessionIndex.set("no-path-session", {
            sessionKey: "no-path-session",
            agentId: "agent1",
            filePath: "",
            channel: "cli",
            gatewayKey: "",
            messageCount: 0,
            updatedAt: null,
            mtime: 0,
        });

        await refreshSessionIndex();
        expect(sessionIndex.has("no-path-session")).toBe(false);
    });

    it("updates entry when JSONL file mtime changes", async () => {
        const sessDir = makeAgentSessionDir("agent1");
        const fp = join(sessDir, "sess-1.jsonl");
        writeJsonlFile(fp, { type: "session", agentId: "agent1", channel: "cli" }, [
            { type: "message", message: { role: "user", content: "hello" }, timestamp: "2024-01-01T00:00:00Z" },
        ]);

        sessionIndex.set("sess-1", {
            sessionKey: "sess-1",
            agentId: "agent1",
            filePath: fp,
            channel: "cli",
            gatewayKey: "",
            messageCount: 1,
            updatedAt: "2024-01-01T00:00:00Z",
            mtime: 0, // Force mtime mismatch
        });

        await refreshSessionIndex();

        const entry = sessionIndex.get("sess-1")!;
        expect(entry).toBeDefined();
        expect(entry.agentId).toBe("agent1");
        expect(entry.channel).toBe("cli");
        expect(entry.mtime).toBeGreaterThan(0);
    });

    it("updates agentId and channel from JSONL header on mtime change", async () => {
        const sessDir = makeAgentSessionDir("agent1");
        const fp = join(sessDir, "sess-2.jsonl");
        writeJsonlFile(fp, { type: "session", agentId: "new-agent", channel: "discord" }, [
            { type: "message", message: { role: "user", content: "hi" }, timestamp: "2024-06-01T00:00:00Z" },
        ]);

        sessionIndex.set("sess-2", {
            sessionKey: "sess-2",
            agentId: "old-agent",
            filePath: fp,
            channel: "cli",
            gatewayKey: "gw-key",
            messageCount: 1,
            updatedAt: "2024-01-01T00:00:00Z",
            mtime: 0,
        });

        await refreshSessionIndex();

        const entry = sessionIndex.get("sess-2")!;
        expect(entry.agentId).toBe("new-agent");
        expect(entry.channel).toBe("discord");
        expect(entry.gatewayKey).toBe("gw-key");
    });

    it("updates messageCount and updatedAt from JSON file on mtime change", async () => {
        const fp = join(DASH_DIR, "dash-sess.json");
        writeDashboardJson(fp, {
            sessionKey: "dash-sess",
            agentId: "agent1",
            channel: "dashboard",
            messages: [
                { role: "user", content: "hello" },
                { role: "assistant", content: "hi" },
                { role: "user", content: "bye" },
            ],
            updatedAt: "2024-06-15T12:00:00Z",
            createdAt: "2024-06-15T10:00:00Z",
        });

        sessionIndex.set("dash-sess", {
            sessionKey: "dash-sess",
            agentId: "old-agent",
            filePath: fp,
            channel: "dashboard",
            gatewayKey: "",
            messageCount: 0,
            updatedAt: "2024-01-01T00:00:00Z",
            mtime: 0,
        });

        await refreshSessionIndex();

        const entry = sessionIndex.get("dash-sess")!;
        expect(entry.agentId).toBe("agent1");
        expect(entry.messageCount).toBe(3);
        expect(entry.updatedAt).toBe("2024-06-15T12:00:00Z");
    });

    it("skips entries with unchanged mtime", async () => {
        const sessDir = makeAgentSessionDir("agent1");
        const fp = join(sessDir, "unchanged.jsonl");
        writeJsonlFile(fp, { type: "session", agentId: "agent1", channel: "cli" }, []);

        const st = statSync(fp);

        sessionIndex.set("unchanged", {
            sessionKey: "unchanged",
            agentId: "agent1",
            filePath: fp,
            channel: "cli",
            gatewayKey: "",
            messageCount: 1,
            updatedAt: "2024-01-01T00:00:00Z",
            mtime: st.mtimeMs,
        });

        await refreshSessionIndex();

        const entry = sessionIndex.get("unchanged")!;
        expect(entry.updatedAt).toBe("2024-01-01T00:00:00Z");
        expect(entry.messageCount).toBe(1);
    });

    it("discovers new JSONL files in agent session directories", async () => {
        const sessDir = makeAgentSessionDir("agent2");
        const fp = join(sessDir, "new-sess.jsonl");
        writeJsonlFile(fp, { type: "session", agentId: "agent2", channel: "slack" }, [
            { type: "message", message: { role: "user", content: "test" }, timestamp: "2024-03-01T00:00:00Z" },
        ]);

        expect(sessionIndex.size).toBe(0);
        await refreshSessionIndex();

        const entry = sessionIndex.get("new-sess");
        expect(entry).toBeDefined();
        expect(entry!.agentId).toBe("agent2");
        expect(entry!.channel).toBe("slack");
        expect(entry!.filePath).toBe(fp);
    });

    it("discovers new files in dashboard sessions directory", async () => {
        const fp = join(DASH_DIR, "new-dash.json");
        writeDashboardJson(fp, {
            sessionKey: "new-dash",
            agentId: "agent3",
            channel: "dashboard",
            messages: [{ role: "user", content: "hi" }],
            updatedAt: "2024-05-01T00:00:00Z",
        });

        expect(sessionIndex.size).toBe(0);
        await refreshSessionIndex();

        const entry = sessionIndex.get("new-dash");
        expect(entry).toBeDefined();
        expect(entry!.agentId).toBe("agent3");
        expect(entry!.channel).toBe("dashboard");
        expect(entry!.messageCount).toBe(1);
    });

    it("discovers new entries from sessions.json index", async () => {
        const sessDir = makeAgentSessionDir("agent4");

        writeFileSync(join(sessDir, "sessions.json"), JSON.stringify({
            "agent:agent4:main": {
                sessionId: "indexed-sess",
                agentId: "agent4",
                channel: "api",
                updatedAt: "2024-04-01T00:00:00Z",
            },
        }), "utf-8");

        writeJsonlFile(join(sessDir, "indexed-sess.jsonl"),
            { type: "session", agentId: "agent4", channel: "api" },
            [{ type: "message", message: { role: "user", content: "test" }, timestamp: "2024-04-01T00:00:00Z" }]
        );

        await refreshSessionIndex();

        const entry = sessionIndex.get("indexed-sess");
        expect(entry).toBeDefined();
        expect(entry!.agentId).toBe("agent4");
        expect(entry!.gatewayKey).toBe("agent:agent4:main");
    });

    it("does not overwrite existing index entries during discovery", async () => {
        const sessDir = makeAgentSessionDir("agent5");
        const fp = join(sessDir, "existing.jsonl");
        writeJsonlFile(fp, { type: "session", agentId: "agent5", channel: "cli" }, []);

        const st = statSync(fp);
        sessionIndex.set("existing", {
            sessionKey: "existing",
            agentId: "agent5",
            filePath: fp,
            channel: "cli",
            gatewayKey: "custom-key",
            messageCount: 42,
            updatedAt: "2024-01-01T00:00:00Z",
            mtime: st.mtimeMs,
        });

        await refreshSessionIndex();

        const entry = sessionIndex.get("existing")!;
        expect(entry.gatewayKey).toBe("custom-key");
        expect(entry.messageCount).toBe(42);
    });

    it("handles gracefully when AGENTS_STATE_DIR does not exist", async () => {
        rmSync(AGENTS_DIR, { recursive: true, force: true });

        await refreshSessionIndex();
        expect(sessionIndex.size).toBe(0);

        ensureDirs();
    });
});
