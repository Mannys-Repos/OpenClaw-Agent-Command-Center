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

describe("dashboard channels visibility", () => {
    function loadDiscordBindingHelpers(source: string, endMarker: string): string {
        const start = source.indexOf("function _getDiscordBindingAccountIds(");
        const end = source.indexOf(endMarker, start + 1);
        if (start < 0 || end < 0) throw new Error(`Unable to locate helpers before ${endMarker}`);
        return source.slice(start, end);
    }

    it("keeps binding-only channels visible alongside configured ones", () => {
        const source = readFileSync(DASHBOARD_JS_PATH, "utf-8");
        const visibleFn = extractFunction(source, "_getVisibleChannels", "_setEffectiveBindings");
        const renderFn = extractFunction(source, "renderChannelsPage", "toggleChannelPage");

        const channelsBody = { innerHTML: "" };
        const ctx: any = {
            D: {
                channels: {
                    discord: { enabled: true, accounts: { default: { enabled: true } } },
                },
                bindings: [
                    { agentId: "alpha", match: { channel: "discord", accountId: "default" } },
                    { agentId: "beta", match: { channel: "slack" } },
                ],
            },
            Q: (id: string) => (id === "channels-body" ? channelsBody : null),
            esc: (value: unknown) => String(value ?? ""),
            chIcon: (ch: string) => `[${ch}]`,
            agentColor: () => "#123456",
            _bindingKey: (b: any, idx: number) => b.id || `binding-${idx}`,
            _describeBindingRoute: (m: any) => m.guildId ? `guild: ${m.guildId}` : "all channels",
            showAddAccountModal: () => undefined,
            showAddBindingModal: () => undefined,
            toggleChannelPage: () => undefined,
            editChannelSettings: () => undefined,
            deleteChannelPage: () => undefined,
            editAccountPage: () => undefined,
            deleteAccount: () => undefined,
            showEditBindingModal: () => undefined,
            removeBindingGlobal: () => undefined,
        };

        vm.runInNewContext(visibleFn, ctx);
        vm.runInNewContext(renderFn, ctx);

        const visible = ctx._getVisibleChannels();
        expect(Object.keys(visible).sort()).toEqual(["discord", "slack"]);

        ctx.renderChannelsPage();
        expect(channelsBody.innerHTML).toContain("discord");
        expect(channelsBody.innerHTML).toContain("slack");
        expect(channelsBody.innerHTML).toContain("beta");
    });

    it("renders dependent Discord guild and channel dropdowns", () => {
        const source = readFileSync(DASHBOARD_JS_PATH, "utf-8");
        const addPeerFn = loadDiscordBindingHelpers(source, "function onBindingChChange()");
        const ctx: any = {
            D: {
                channels: {
                    discord: {
                        accounts: {
                            default: {
                                guilds: {
                                    "guild-1": { channels: { "chan-1": { enabled: true } } },
                                    "guild-2": { channels: { "chan-2": { enabled: true } } },
                                },
                            },
                            support: {
                                guilds: {
                                    "guild-9": { channels: { "chan-9": { enabled: true } } },
                                },
                            },
                        },
                    },
                },
            },
            V: (id: string) => values[id] || "",
            tip: (_label: string, body: string) => body,
            esc: (value: unknown) => String(value ?? ""),
        };
        const values: Record<string, string> = {};

        vm.runInNewContext(addPeerFn, ctx);

        values["ab-acc"] = "default";
        const defaultHtml = ctx._buildBindingAccPeer("discord");
        expect(defaultHtml).toContain("guild-1");
        expect(defaultHtml).toContain("guild-2");
        expect(defaultHtml).not.toContain("guild-9");

        values["ab-guild-id"] = "guild-1";
        const filteredHtml = ctx._buildBindingAccPeer("discord");
        expect(filteredHtml).toContain("chan-1");
        expect(filteredHtml).not.toContain("chan-2");
        expect(filteredHtml).not.toContain("chan-9");

        values["ab-acc"] = "";
        values["ab-guild-id"] = "";
        const anyAccountHtml = ctx._buildBindingAccPeer("discord");
        expect(anyAccountHtml).toContain("any (all accounts)");
        expect(anyAccountHtml).toContain("guild-9");
    });

    it("preserves missing guild and channel selections when editing stale bindings", () => {
        const source = readFileSync(DASHBOARD_JS_PATH, "utf-8");
        const editPeerFn = loadDiscordBindingHelpers(source, "function onEditBindingChChange()");
        const ctx: any = {
            D: {
                channels: {
                    discord: {
                        accounts: {
                            default: {
                                guilds: {
                                    "guild-9": { channels: { "chan-9": { enabled: true } } },
                                },
                            },
                        },
                    },
                },
            },
            tip: (_label: string, body: string) => body,
            esc: (value: unknown) => String(value ?? ""),
        };

        vm.runInNewContext(editPeerFn, ctx);

        const html = ctx._buildEditBindingAccPeer("discord", {
            accountId: "default",
            guildId: "guild-missing",
            peer: { kind: "channel", id: "chan-missing" },
        });

        expect(html).toContain("(missing) guild-missing");
        expect(html).toContain("(missing) chan-missing");
        expect(html).toContain("eb-guild-id");
        expect(html).toContain("eb-peer-id");
    });

    it("shows empty-state help when guilds or channels are unavailable", () => {
        const source = readFileSync(DASHBOARD_JS_PATH, "utf-8");
        const addPeerFn = loadDiscordBindingHelpers(source, "function onBindingChChange()");
        const ctx: any = {
            D: {
                channels: {
                    discord: {
                        accounts: {
                            default: { guilds: {} },
                        },
                    },
                },
            },
            V: (id: string) => values[id] || "",
            tip: (_label: string, body: string) => body,
            esc: (value: unknown) => String(value ?? ""),
        };
        const values: Record<string, string> = { "ab-acc": "default" };

        vm.runInNewContext(addPeerFn, ctx);

        const html = ctx._buildBindingAccPeer("discord");
        expect(html).toContain("No configured Discord guilds for the selected account.");

        ctx.D.channels.discord.accounts.default.guilds = { "guild-1": { channels: {} } };
        values["ab-guild-id"] = "guild-1";
        const html2 = ctx._buildBindingAccPeer("discord");
        expect(html2).toContain("No configured channels for the selected guild.");
    });

    it("sends guild IDs when saving Discord bindings", () => {
        const source = readFileSync(DASHBOARD_JS_PATH, "utf-8");
        const addFn = extractFunction(source, "doAddBinding", "showEditBindingModal");
        const editFn = extractFunction(source, "doEditBinding", "saveAccountConfig");
        const payloads: any[] = [];
        const values: Record<string, string> = {
            "ab-agent": "alpha",
            "ab-acc": "default",
            "ab-guild-id": "guild-1",
            "ab-peer-id": "chan-1",
            "eb-agent": "alpha",
            "eb-acc": "default",
            "eb-ch": "discord",
            "eb-guild-id": "guild-2",
            "eb-peer-id": "chan-2",
        };
        const ctx: any = {
            D: { bindings: [] },
            V: (id: string) => values[id] || "",
            _bindingKey: (b: any, idx: number) => b.id || `binding-${idx}`,
            _bindingRefIndex: (ref: string) => ref === "bind-1" ? 0 : -1,
            api: (_url: string, opts: any) => { payloads.push(JSON.parse(opts.body)); return Promise.resolve({}); },
            _deferParam: (path: string) => path,
            toast: () => undefined,
            _deferRestart: () => undefined,
            closeModal: () => undefined,
            _refreshEffectiveUi: () => undefined,
        };

        vm.runInNewContext(addFn, ctx);
        vm.runInNewContext(editFn, ctx);

        ctx.doAddBinding("discord");
        ctx.D.bindings = [{ id: "bind-1", agentId: "alpha", match: { channel: "discord", accountId: "default" } }];
        ctx.doEditBinding("bind-1");

        expect(payloads[0].bindings[0].id).toBeTruthy();
        expect(payloads[0].bindings[0].match.guildId).toBe("guild-1");
        expect(payloads[0].bindings[0].match.peer).toEqual({ kind: "channel", id: "chan-1" });
        expect(payloads[1].bindings[0].match.guildId).toBe("guild-2");
        expect(payloads[1].bindings[0].match.peer).toEqual({ kind: "channel", id: "chan-2" });
        expect(payloads[1].bindings[0].id).toBe("bind-1");
    });

    it("targets sibling bindings by stable id in the agent drawer", () => {
        const source = readFileSync(DASHBOARD_JS_PATH, "utf-8");
        const renderFn = extractFunction(source, "renderChannels", "addBinding");
        const ctx: any = {
            D: {
                bindings: [
                    { id: "bind-a", agentId: "alpha", match: { channel: "discord", accountId: "default" } },
                    { id: "bind-b", agentId: "alpha", match: { channel: "discord", accountId: "default" } },
                ],
            },
            esc: (value: unknown) => String(value ?? ""),
            chIcon: (ch: string) => `[${ch}]`,
            _bindingKey: (b: any) => b.id,
            _bindingCountLabel: (count: number) => `${count} bindings`,
            _bindingCountForAgent: (agentId: string) => agentId === "alpha" ? 2 : 0,
        };

        vm.runInNewContext(renderFn, ctx);

        const html = ctx.renderChannels({ id: "alpha" });
        expect(html).toContain("2 bindings");
        expect(html).toContain("showEditBindingModal('bind-a')");
        expect(html).toContain("showEditBindingModal('bind-b')");
        expect(html).toContain("removeBinding('alpha','bind-a')");
        expect(html).toContain("removeBinding('alpha','bind-b')");
    });

    it("keeps orphaned binding channels selectable when editing", () => {
        const source = readFileSync(DASHBOARD_JS_PATH, "utf-8");
        const editModalFn = extractFunction(source, "showEditBindingModal", "_buildEditBindingAccPeer");
        let modalHtml = "";
        const ctx: any = {
            D: {
                agents: [{ id: "alpha" }],
                bindings: [
                    { id: "missing-1", agentId: "alpha", match: { channel: "legacy", accountId: "default" } },
                ],
                channels: {
                    discord: { accounts: { default: {} } },
                },
            },
            tip: (_label: string, body: string) => body,
            esc: (value: unknown) => String(value ?? ""),
            chIcon: (ch: string) => `[${ch}]`,
            document: { querySelector: () => null },
            openModal: (_title: string, html: string) => { modalHtml = html; },
            closeModal: () => undefined,
            onEditBindingChChange: () => undefined,
            onEditBindingAccChange: () => undefined,
            setTimeout: (_fn: Function) => undefined,
            _bindingRefIndex: (ref: string) => ref === "missing-1" ? 0 : -1,
            _buildEditBindingAccPeer: () => "",
        };

        vm.runInNewContext(editModalFn, ctx);
        ctx.showEditBindingModal("missing-1");

        expect(modalHtml).toContain("(missing) legacy");
    });
});
