import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const files = new Map<string, string>();
const stagedFiles: any[] = [];
const stagedConfigs: any[] = [];
let mockConfig: any = {
    auth: { profiles: { "openai:main": { token: "live-token" } } },
    agents: { list: [] },
};

vi.mock("../../api-utils.js", () => ({
    json: vi.fn((res: any, status: number, data: any) => {
        res.statusCode = status;
        res._body = data;
    }),
    parseBody: vi.fn(async () => ({})),
    readConfig: vi.fn(() => JSON.parse(JSON.stringify(mockConfig))),
    readEffectiveConfig: vi.fn(() => JSON.parse(JSON.stringify(mockConfig))),
    writeConfig: vi.fn((cfg: any) => {
        mockConfig = JSON.parse(JSON.stringify(cfg));
    }),
    stageConfig: vi.fn((cfg: any) => {
        stagedConfigs.push(JSON.parse(JSON.stringify(cfg)));
    }),
    readEnv: vi.fn(() => ({})),
    tryReadFile: vi.fn((p: string) => files.get(p) ?? null),
    stagePendingFileMutation: vi.fn((op: any) => stagedFiles.push(op)),
    OPENCLAW_DIR: "/tmp/openclaw",
    AGENTS_STATE_DIR: "/tmp/openclaw/agents",
    execAsync: vi.fn(async () => ""),
}));

vi.mock("../providers.js", () => ({
    invalidateProviderCache: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return {
        ...actual,
        existsSync: vi.fn((p: string) => files.has(p) || p === "/tmp/openclaw/agents" || p === "/tmp/openclaw/agents/main"),
        readdirSync: vi.fn((p: string) => (p === "/tmp/openclaw/agents" ? ["main"] : [])),
        readFileSync: vi.fn((p: string) => files.get(p) ?? ""),
        writeFileSync: vi.fn((p: string, content: string) => {
            files.set(p, content);
        }),
    };
});

import { handleAuthProfileRoutes } from "../auth-profiles.js";

function mockReq(method: string): IncomingMessage {
    return { method } as IncomingMessage;
}

function mockRes(): ServerResponse & { _body: any } {
    return { statusCode: 0, _body: null } as unknown as ServerResponse & { _body: any };
}

beforeEach(() => {
    files.clear();
    stagedFiles.length = 0;
    stagedConfigs.length = 0;
    mockConfig = { auth: { profiles: { "openai:main": { token: "live-token" } } }, agents: { list: [] } };
    vi.clearAllMocks();
});

describe("auth profile routes", () => {
    it("stages .env key updates when defer=1", async () => {
        const { parseBody } = await import("../../api-utils.js");
        const { writeFileSync } = await import("node:fs");
        (parseBody as any).mockResolvedValue({ envVar: "OPENAI_API_KEY", value: "sk-test" });
        files.set("/tmp/openclaw/.env", "OPENAI_API_KEY=old\n");

        const req = mockReq("POST");
        const res = mockRes();
        const handled = await handleAuthProfileRoutes(req, res, new URL("http://localhost/api/auth/envkey?defer=1"), "/auth/envkey");

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(writeFileSync).not.toHaveBeenCalled();
        expect(stagedFiles).toHaveLength(1);
        expect(stagedFiles[0].path).toBe("/tmp/openclaw/.env");
        expect(stagedFiles[0].content).toContain('OPENAI_API_KEY="sk-test"');
    });

    it("stages .env key removals when defer=1", async () => {
        const { parseBody } = await import("../../api-utils.js");
        const { writeFileSync } = await import("node:fs");
        (parseBody as any).mockResolvedValue({ envVar: "OPENAI_API_KEY" });
        files.set("/tmp/openclaw/.env", 'OPENAI_API_KEY="live-token"\nOTHER=1\n');

        const req = mockReq("DELETE");
        const res = mockRes();
        const handled = await handleAuthProfileRoutes(req, res, new URL("http://localhost/api/auth/envkey?defer=1"), "/auth/envkey");

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(writeFileSync).not.toHaveBeenCalled();
        expect(stagedFiles[0].content).toContain("OTHER=1");
        expect(stagedFiles[0].content).not.toContain("OPENAI_API_KEY");
    });

    it("stages auth profile deletions when defer=1", async () => {
        const { parseBody, stageConfig } = await import("../../api-utils.js");
        const { writeFileSync } = await import("node:fs");
        (parseBody as any).mockResolvedValue({ profileKey: "openai:main" });
        const profilePath = "/tmp/openclaw/agents/main/agent/auth-profiles.json";
        files.set(profilePath, JSON.stringify({ profiles: { "openai:main": { token: "live-token" }, "anthropic:main": { token: "keep" } } }));

        const req = mockReq("DELETE");
        const res = mockRes();
        const handled = await handleAuthProfileRoutes(req, res, new URL("http://localhost/api/auth/profile?defer=1"), "/auth/profile");

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(writeFileSync).not.toHaveBeenCalled();
        expect(stageConfig).toHaveBeenCalled();
        expect(stagedFiles.some((op) => op.path === profilePath)).toBe(true);
        expect(res._body.deleted).toBe(true);
        expect(res._body.deletedFrom.some((p: string) => p.includes("auth-profiles.json"))).toBe(true);
    });
});
