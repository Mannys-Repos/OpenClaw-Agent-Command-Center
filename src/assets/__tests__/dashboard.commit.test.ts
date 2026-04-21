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

describe("dashboard commit flow", () => {
    it("shows destructive-op failures from config commit without waiting for restart", async () => {
        const source = readFileSync(DASHBOARD_JS_PATH, "utf-8");
        const commitFn = extractFunction(source, "_commitAndRestart", "_discardPending");

        const calls: string[] = [];
        const ctx: any = {
            api: () => Promise.resolve({
                ok: false,
                committed: true,
                configWritten: true,
                error: "Config was saved, but some destructive operations failed",
                destructiveOpFailures: [{ key: "flow:solo", description: "Delete flow: solo", error: "permission denied" }],
            }),
            toast: (message: string) => calls.push(`toast:${message}`),
            _hidePendingBanner: () => calls.push("hidePending"),
            _lockProgress: () => calls.push("lock"),
            _showRestartOverlay: () => calls.push("overlay:show"),
            _unlockProgress: () => calls.push("unlock"),
            _hideRestartOverlay: () => calls.push("overlay:hide"),
            _waitForGateway: () => calls.push("wait"),
            load: () => calls.push("load"),
        };

        vm.runInNewContext(commitFn, ctx);
        ctx._commitAndRestart();

        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        expect(calls).toContain("hidePending");
        expect(calls).toContain("lock");
        expect(calls).toContain("overlay:show");
        expect(calls).toContain("unlock");
        expect(calls).toContain("overlay:hide");
        expect(calls).not.toContain("wait");
        expect(calls).not.toContain("load");
        const toastCall = calls.find((call) => call.startsWith("toast:"));
        expect(toastCall).toBeDefined();
        expect(toastCall).toContain("Delete flow: solo: permission denied");
    });

    it("uses deferred plugin install requests from the UI", () => {
        const source = readFileSync(DASHBOARD_JS_PATH, "utf-8");
        const installFn = extractFunction(source, "submitInstallPlugin", "showLogs");

        const calls: any[] = [];
        const ctx: any = {
            V: () => "@openclaw/test",
            closeModal: () => calls.push("close"),
            toast: (message: string) => calls.push(`toast:${message}`),
            api: (path: string) => {
                calls.push(path);
                return Promise.resolve({});
            },
            _pluginsCache: null,
            _refreshToolRegistry: () => calls.push("refresh"),
            renderPluginsPage: () => calls.push("render"),
            _deferRestart: () => calls.push("defer"),
        };

        vm.runInNewContext(installFn, ctx);
        ctx.submitInstallPlugin();

        expect(calls).toContain("plugins/install?defer=1");
        expect(calls).not.toContain("refresh");
    });
});
