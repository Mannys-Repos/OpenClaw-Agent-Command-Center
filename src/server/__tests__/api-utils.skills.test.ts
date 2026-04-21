import { describe, it, expect, vi, beforeEach } from "vitest";

const files = new Map<string, string>();
const dirs = new Set<string>();

function parentDir(path: string): string {
    const idx = path.lastIndexOf("/");
    return idx > 0 ? path.slice(0, idx) : "/";
}

function markDir(path: string): void {
    let cur = path;
    while (cur && cur !== "/") {
        dirs.add(cur);
        cur = parentDir(cur);
    }
}

function removePath(path: string): void {
    files.delete(path);
    dirs.delete(path);
    for (const key of [...files.keys()]) if (key === path || key.startsWith(path + "/")) files.delete(key);
    for (const key of [...dirs]) if (key === path || key.startsWith(path + "/")) dirs.delete(key);
}

function copyPath(src: string, dest: string): void {
    markDir(parentDir(dest));
    if (dirs.has(src)) {
        markDir(dest);
        for (const dir of [...dirs]) {
            if (dir === src || dir.startsWith(src + "/")) {
                const rel = dir.slice(src.length);
                if (rel) dirs.add(dest + rel);
            }
        }
        for (const [file, content] of [...files.entries()]) {
            if (file === src || file.startsWith(src + "/")) {
                const rel = file.slice(src.length);
                files.set(dest + rel, content);
            }
        }
    } else if (files.has(src)) {
        files.set(dest, files.get(src)!);
    }
}

vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return {
        ...actual,
        existsSync: vi.fn((p: string) => files.has(p) || dirs.has(p)),
        readFileSync: vi.fn((p: string) => files.get(p) || ""),
        writeFileSync: vi.fn((p: string, data: any) => {
            files.set(p, String(data));
            markDir(parentDir(p));
        }),
        mkdirSync: vi.fn((p: string) => markDir(p)),
        rmSync: vi.fn((p: string) => removePath(p)),
        cpSync: vi.fn((src: string, dest: string) => copyPath(src, dest)),
        statSync: vi.fn((p: string) => ({ isDirectory: () => dirs.has(p) })),
    };
});

import {
    stagePendingSkillOp,
    commitPendingChanges,
    discardPendingChanges,
    getPendingSkillOps,
    stagePendingSkillsConfig,
    readEffectiveSkillsConfig,
} from "../api-utils.js";
import { writeFileSync } from "node:fs";

beforeEach(() => {
    files.clear();
    dirs.clear();
    markDir("/tmp");
    markDir("/tmp/openclaw");
    markDir("/tmp/openclaw/dashboard");
    markDir("/tmp/openclaw/skills");
});

describe("pending skill ops", () => {
    it("commits staged skill installs", () => {
        const stageDir = "/tmp/openclaw/.tmp-skill-stage/install-main-new-skill";
        const liveDir = "/tmp/openclaw/workspace/new-skill";
        markDir(stageDir);
        files.set(`${stageDir}/SKILL.md`, "---\nname: New Skill\n---\n\nbody");

        stagePendingSkillOp({
            kind: "skill",
            key: "skill:workspace:main:new-skill",
            action: "install",
            agentId: "main",
            dirName: "new-skill",
            scope: "workspace",
            tempDir: stageDir,
            description: "Install skill: new-skill",
            apply: () => {
                if (dirs.has(liveDir)) removePath(liveDir);
                copyPath(stageDir, liveDir);
            },
        });

        const result = commitPendingChanges();
        expect(result.committed).toBe(true);
        expect(result.skillsConfigWritten).toBe(false);
        expect(files.get(`${liveDir}/SKILL.md`)).toContain("New Skill");
        expect(dirs.has(stageDir)).toBe(false);
        expect(getPendingSkillOps()).toEqual([]);
    });

    it("persists staged skills config during commit", () => {
        stagePendingSkillsConfig({ __globalManagedSkills: { helper: { enabled: false } } });

        const result = commitPendingChanges();
        expect(result.committed).toBe(true);
        expect(result.skillsConfigWritten).toBe(true);
        const writes = (writeFileSync as any).mock.calls.map((call: any[]) => call[0]);
        expect(writes.some((p: string) => String(p).endsWith("skills-config.json"))).toBe(true);
    });

    it("discards staged skill ops and pending staged config", () => {
        stagePendingSkillsConfig({ __globalManagedSkills: { helper: { enabled: true } } });
        stagePendingSkillOp({
            kind: "skill",
            key: "skill:workspace:main:helper",
            action: "delete",
            agentId: "main",
            dirName: "helper",
            scope: "workspace",
            description: "Delete skill: helper",
            apply: () => removePath("/tmp/openclaw/workspace/helper"),
        });

        discardPendingChanges();
        expect(getPendingSkillOps()).toEqual([]);
        expect(readEffectiveSkillsConfig()).toEqual({});
    });
});
