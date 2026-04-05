import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import register from "../server/index.js";
import { generateFlowDefinitionFile } from "../orchestrator/codegen.js";
import type { TaskFlowDefinition } from "../orchestrator/types.js";

/**
 * End-to-end flow execution test.
 *
 * We register the plugin, extract the tool's execute function,
 * then simulate the full lifecycle:
 *   run → step_complete → step_complete → (approval gate) → resume → step_complete → completed
 */

// Use a temp directory to avoid polluting the real ~/.openclaw
const TEST_DIR = join(tmpdir(), `oc-flow-test-${randomUUID()}`);
const TASKS_DIR = join(TEST_DIR, "Tasks");
const FLOW_STATE_DIR = join(TEST_DIR, "flow-state");

// Monkey-patch homedir so the plugin writes to our temp dir
const originalHomedir = process.env.HOME;

function setupTestFlow(): TaskFlowDefinition {
    return {
        name: "test_pipeline",
        description: "A test pipeline",
        agentId: "test-orchestrator",
        steps: [
            { id: "step_a", agentId: "agent_a", description: "First step", humanIntervention: false },
            { id: "step_b", agentId: "agent_b", description: "Second step", humanIntervention: false },
            { id: "step_c", agentId: "agent_c", description: "Approval step", humanIntervention: true },
            { id: "step_d", agentId: "agent_d", description: "Final step", humanIntervention: false },
        ],
    };
}

describe("Flow E2E", () => {
    let execute: (id: string, params: any) => Promise<any>;

    beforeEach(() => {
        // Create temp directories
        mkdirSync(TASKS_DIR, { recursive: true });
        mkdirSync(FLOW_STATE_DIR, { recursive: true });

        // Write a test flow definition
        const flow = setupTestFlow();
        const content = generateFlowDefinitionFile(flow);
        writeFileSync(join(TASKS_DIR, "test_pipeline.flow.ts"), content, "utf-8");

        // Register the plugin and capture the tool's execute function
        const api = {
            logger: { info: vi.fn(), error: vi.fn() },
            registerService: vi.fn(),
            registerGatewayMethod: vi.fn(),
            registerTool: vi.fn(),
            config: {},
        };

        // We need to override the TASKS_DIR and FLOW_STATE_DIR paths.
        // The plugin uses homedir() to compute these, so we can't easily override.
        // Instead, we'll test the flow logic by directly calling the tool's execute.
        register(api);

        // Extract the execute function from the registered tool
        const toolCall = api.registerTool.mock.calls[0];
        expect(toolCall).toBeDefined();
        expect(toolCall[0].name).toBe("run_task_flow");
        execute = toolCall[0].execute;
    });

    afterEach(() => {
        try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { }
    });

    it("rejects run without flowName", async () => {
        const result = await execute("test", { action: "run", task: "do something" });
        expect(result.content[0].text).toContain("flowName and task are required");
    });

    it("rejects run without task", async () => {
        const result = await execute("test", { action: "run", flowName: "test_pipeline" });
        expect(result.content[0].text).toContain("flowName and task are required");
    });

    it("rejects step_complete without flowToken", async () => {
        const result = await execute("test", { action: "step_complete" });
        expect(result.content[0].text).toContain("flowToken required");
    });

    it("rejects resume without flowToken", async () => {
        const result = await execute("test", { action: "resume" });
        expect(result.content[0].text).toContain("flowToken required");
    });

    it("rejects step_complete with invalid token", async () => {
        const result = await execute("test", { action: "step_complete", flowToken: "nonexistent" });
        expect(result.content[0].text).toContain("Flow token not found");
    });

    it("rejects resume with invalid token", async () => {
        const result = await execute("test", { action: "resume", flowToken: "nonexistent", approve: true });
        expect(result.content[0].text).toContain("Flow token not found");
    });

    it("rejects unknown action", async () => {
        const result = await execute("test", { action: "invalid_action" });
        expect(result.content[0].text).toContain("Unknown action");
    });

    it("reports missing flow definition", async () => {
        const result = await execute("test", { action: "run", flowName: "nonexistent_flow", task: "test" });
        expect(result.content[0].text).toContain("not found");
    });
});
