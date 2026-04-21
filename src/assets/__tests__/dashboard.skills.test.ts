import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vm from "node:vm";

const DASHBOARD_JS_PATH = join(process.cwd(), "src/assets/dashboard.js.txt");

function extractFunction(source: string, name: string, nextName: string): string {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${nextName}(`, start + 1);
    if (start < 0 || end < 0) throw new Error(`Unable to locate ${name}`);
    return source.slice(start, end);
}

describe("global skills state labels", () => {
    it("distinguishes global, partial, and disabled states", () => {
        const source = readFileSync(DASHBOARD_JS_PATH, "utf-8");
        const stateFn = extractFunction(source, "_getGlobalSkillState", "_renderGlobalSkillCard");
        const renderFn = extractFunction(source, "_renderGlobalSkillCard", "showPluginsPage");

        const ctx: any = {
            esc: (value: unknown) => String(value ?? ""),
        };

        vm.runInNewContext(stateFn, ctx);
        vm.runInNewContext(renderFn, ctx);

        expect(ctx._getGlobalSkillState({ enabled: true })).toEqual({ state: "global", label: "Enabled globally" });
        expect(ctx._getGlobalSkillState({ enabled: false, agentEnabledCount: 2 })).toEqual({ state: "partial", label: "Enabled for some agents" });
        expect(ctx._getGlobalSkillState({ enabled: false, agentEnabledCount: 0 })).toEqual({ state: "disabled", label: "Disabled for all agents" });

        const partialHtml = ctx._renderGlobalSkillCard({
            dirName: "shared-skill",
            name: "Shared Skill",
            tier: "managed",
            enabled: false,
            agentEnabledCount: 1,
            hasValidSkillMd: true,
            description: "Shared",
        });

        expect(partialHtml).toContain("Enabled for some agents");
        expect(partialHtml).toContain("skill-partial");
    });
});
