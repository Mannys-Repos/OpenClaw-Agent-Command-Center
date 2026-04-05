import { describe, it, expect } from "vitest";
import { generateFlowDefinitionFile, parseFlowDefinitionFile, generateAgentsMdSnippet } from "./codegen.js";
import type { TaskFlowDefinition } from "./types.js";

function makeFlow(overrides: Partial<TaskFlowDefinition> = {}): TaskFlowDefinition {
    return {
        name: "my_flow",
        description: "A test flow",
        agentId: "orchestrator",
        steps: [
            { id: "step_one", agentId: "coder", description: "Code the thing", humanIntervention: false },
        ],
        ...overrides,
    };
}

describe("generateFlowDefinitionFile", () => {
    it("returns a non-empty string", () => {
        const result = generateFlowDefinitionFile(makeFlow());
        expect(result.length).toBeGreaterThan(0);
    });

    it("generates typed result interface per step", () => {
        const flow = makeFlow({
            steps: [
                { id: "coder_initial", agentId: "coder", description: "Code", humanIntervention: false },
                { id: "reviewer", agentId: "reviewer", description: "Review", humanIntervention: false },
            ],
        });
        const result = generateFlowDefinitionFile(flow);
        expect(result).toContain("type CoderInitialResult = {");
        expect(result).toContain("type ReviewerResult = {");
    });

    it("generates typed input interface with PascalCase flow name", () => {
        const result = generateFlowDefinitionFile(makeFlow({ name: "coding_pipeline" }));
        expect(result).toContain("type CodingPipelineFlowInput = {");
    });

    it("generates createManaged with correct controllerId", () => {
        const flow = makeFlow({ name: "deploy_flow", agentId: "orchestrator" });
        const result = generateFlowDefinitionFile(flow);
        expect(result).toContain('controllerId: "orchestrator/start_deploy_flow"');
    });

    it("uses flow description as goal", () => {
        const flow = makeFlow({ description: "Deploy the app" });
        const result = generateFlowDefinitionFile(flow);
        expect(result).toContain("Deploy the app");
    });

    it("uses default goal when description is empty", () => {
        const flow = makeFlow({ name: "my_flow", description: "" });
        const result = generateFlowDefinitionFile(flow);
        expect(result).toContain("Execute my_flow flow");
    });

    it("generates exactly one createManaged invocation", () => {
        const flow = makeFlow({
            steps: [
                { id: "s1", agentId: "a1", description: "d1", humanIntervention: false },
                { id: "s2", agentId: "a2", description: "d2", humanIntervention: false },
            ],
        });
        const result = generateFlowDefinitionFile(flow);
        // Match actual call (await ... .createManaged({), not the type definition
        const matches = result.match(/await\s+\w+\.createManaged\(/g);
        expect(matches).toHaveLength(1);
    });

    it("generates runTask call per step", () => {
        const flow = makeFlow({
            steps: [
                { id: "s1", agentId: "a1", description: "d1", humanIntervention: false },
                { id: "s2", agentId: "a2", description: "d2", humanIntervention: false },
                { id: "s3", agentId: "a3", description: "d3", humanIntervention: false },
            ],
        });
        const result = generateFlowDefinitionFile(flow);
        const matches = result.match(/flow\.runTask</g);
        expect(matches).toHaveLength(3);
    });

    it("generates runTask with correct step id and agentId", () => {
        const flow = makeFlow({
            steps: [
                { id: "code_step", agentId: "coder_agent", description: "Code", humanIntervention: false },
            ],
        });
        const result = generateFlowDefinitionFile(flow);
        expect(result).toContain('id: "code_step"');
        expect(result).toContain('agentId: "coder_agent"');
    });

    it("generates setWaiting before humanIntervention steps", () => {
        const flow = makeFlow({
            steps: [
                { id: "auto_step", agentId: "a1", description: "Auto", humanIntervention: false },
                { id: "approval_step", agentId: "a2", description: "Needs approval", humanIntervention: true },
            ],
        });
        const result = generateFlowDefinitionFile(flow);
        // setWaiting should appear before the runTask for approval_step
        const setWaitingIdx = result.indexOf("setWaiting(");
        const runTaskApprovalIdx = result.indexOf('id: "approval_step"');
        expect(setWaitingIdx).toBeGreaterThan(-1);
        expect(runTaskApprovalIdx).toBeGreaterThan(setWaitingIdx);
        expect(result).toContain('currentStep: "approval_step"');
        expect(result).toContain('kind: "approval"');
    });

    it("does not generate setWaiting for non-humanIntervention steps", () => {
        const flow = makeFlow({
            steps: [
                { id: "auto_step", agentId: "a1", description: "Auto", humanIntervention: false },
            ],
        });
        const result = generateFlowDefinitionFile(flow);
        expect(result).not.toContain("setWaiting(");
    });

    it("generates setWaiting for each humanIntervention step", () => {
        const flow = makeFlow({
            steps: [
                { id: "s1", agentId: "a1", description: "d1", humanIntervention: true },
                { id: "s2", agentId: "a2", description: "d2", humanIntervention: false },
                { id: "s3", agentId: "a3", description: "d3", humanIntervention: true },
            ],
        });
        const result = generateFlowDefinitionFile(flow);
        const matches = result.match(/setWaiting\(/g);
        expect(matches).toHaveLength(2);
    });

    it("generates error handling with flow.fail()", () => {
        const result = generateFlowDefinitionFile(makeFlow());
        expect(result).toContain("flow.fail(");
        expect(result).toContain("catch (error)");
    });

    it("generates flow.complete() call", () => {
        const result = generateFlowDefinitionFile(makeFlow());
        expect(result).toContain("flow.complete(");
    });

    it("generates an exported async function", () => {
        const result = generateFlowDefinitionFile(makeFlow({ name: "my_flow" }));
        expect(result).toContain("export async function startMyFlowFlow(ctx: ToolContext)");
    });

    it("generates SDK types (FlowHandle, TaskFlowRuntime, etc.)", () => {
        const result = generateFlowDefinitionFile(makeFlow());
        expect(result).toContain("type FlowHandle = {");
        expect(result).toContain("type TaskFlowRuntime = {");
        expect(result).toContain("type AgentTaskResult<T> = {");
        expect(result).toContain("type ToolContext = {");
    });

    it("does not contain deleteSession", () => {
        const result = generateFlowDefinitionFile(makeFlow());
        expect(result).not.toContain("deleteSession");
    });

    it("generates step comments with descriptions", () => {
        const flow = makeFlow({
            steps: [
                { id: "s1", agentId: "a1", description: "First step", humanIntervention: false },
                { id: "s2", agentId: "a2", description: "Second step", humanIntervention: false },
            ],
        });
        const result = generateFlowDefinitionFile(flow);
        expect(result).toContain("// Step 1: First step");
        expect(result).toContain("// Step 2: Second step");
    });
});

describe("parseFlowDefinitionFile", () => {
    it("returns null for empty content", () => {
        expect(parseFlowDefinitionFile("")).toBeNull();
    });

    it("returns null for content without controllerId", () => {
        expect(parseFlowDefinitionFile("const x = 1;")).toBeNull();
    });

    it("returns null for content with controllerId but no start_ prefix", () => {
        expect(parseFlowDefinitionFile('controllerId: "agent/something"')).toBeNull();
    });

    it("parses flow name and agentId from controllerId", () => {
        const flow = makeFlow({ name: "deploy_flow", agentId: "orchestrator" });
        const generated = generateFlowDefinitionFile(flow);
        const parsed = parseFlowDefinitionFile(generated);
        expect(parsed).not.toBeNull();
        expect(parsed!.name).toBe("deploy_flow");
        expect(parsed!.agentId).toBe("orchestrator");
    });

    it("parses flow description from goal", () => {
        const flow = makeFlow({ description: "Deploy the application" });
        const generated = generateFlowDefinitionFile(flow);
        const parsed = parseFlowDefinitionFile(generated);
        expect(parsed).not.toBeNull();
        expect(parsed!.description).toBe("Deploy the application");
    });

    it("parses empty description when default goal is used", () => {
        const flow = makeFlow({ name: "my_flow", description: "" });
        const generated = generateFlowDefinitionFile(flow);
        const parsed = parseFlowDefinitionFile(generated);
        expect(parsed).not.toBeNull();
        expect(parsed!.description).toBe("");
    });

    it("parses step id and agentId", () => {
        const flow = makeFlow({
            steps: [
                { id: "code_step", agentId: "coder_agent", description: "Code it", humanIntervention: false },
            ],
        });
        const generated = generateFlowDefinitionFile(flow);
        const parsed = parseFlowDefinitionFile(generated);
        expect(parsed).not.toBeNull();
        expect(parsed!.steps).toHaveLength(1);
        expect(parsed!.steps[0].id).toBe("code_step");
        expect(parsed!.steps[0].agentId).toBe("coder_agent");
    });

    it("parses step description from instructions", () => {
        const flow = makeFlow({
            steps: [
                { id: "s1", agentId: "a1", description: "Do the thing", humanIntervention: false },
            ],
        });
        const generated = generateFlowDefinitionFile(flow);
        const parsed = parseFlowDefinitionFile(generated);
        expect(parsed).not.toBeNull();
        expect(parsed!.steps[0].description).toBe("Do the thing");
    });

    it("parses humanIntervention from setWaiting calls", () => {
        const flow = makeFlow({
            steps: [
                { id: "auto_step", agentId: "a1", description: "Auto", humanIntervention: false },
                { id: "approval_step", agentId: "a2", description: "Needs approval", humanIntervention: true },
            ],
        });
        const generated = generateFlowDefinitionFile(flow);
        const parsed = parseFlowDefinitionFile(generated);
        expect(parsed).not.toBeNull();
        expect(parsed!.steps[0].humanIntervention).toBe(false);
        expect(parsed!.steps[1].humanIntervention).toBe(true);
    });

    it("parses multiple steps in order", () => {
        const flow = makeFlow({
            steps: [
                { id: "s1", agentId: "a1", description: "First", humanIntervention: false },
                { id: "s2", agentId: "a2", description: "Second", humanIntervention: true },
                { id: "s3", agentId: "a3", description: "Third", humanIntervention: false },
            ],
        });
        const generated = generateFlowDefinitionFile(flow);
        const parsed = parseFlowDefinitionFile(generated);
        expect(parsed).not.toBeNull();
        expect(parsed!.steps).toHaveLength(3);
        expect(parsed!.steps[0].id).toBe("s1");
        expect(parsed!.steps[1].id).toBe("s2");
        expect(parsed!.steps[2].id).toBe("s3");
        expect(parsed!.steps[1].humanIntervention).toBe(true);
    });

    it("round-trips a simple flow definition", () => {
        const flow = makeFlow();
        const generated = generateFlowDefinitionFile(flow);
        const parsed = parseFlowDefinitionFile(generated);
        expect(parsed).not.toBeNull();
        expect(parsed!.name).toBe(flow.name);
        expect(parsed!.description).toBe(flow.description);
        expect(parsed!.agentId).toBe(flow.agentId);
        expect(parsed!.steps).toHaveLength(flow.steps.length);
        for (let i = 0; i < flow.steps.length; i++) {
            expect(parsed!.steps[i].id).toBe(flow.steps[i].id);
            expect(parsed!.steps[i].agentId).toBe(flow.steps[i].agentId);
            expect(parsed!.steps[i].description).toBe(flow.steps[i].description);
            expect(parsed!.steps[i].humanIntervention).toBe(flow.steps[i].humanIntervention);
        }
    });

    it("round-trips a complex flow with mixed humanIntervention", () => {
        const flow = makeFlow({
            name: "complex_pipeline",
            description: "A complex multi-step pipeline",
            agentId: "main_orchestrator",
            steps: [
                { id: "init", agentId: "setup_agent", description: "Initialize environment", humanIntervention: false },
                { id: "review", agentId: "reviewer", description: "Review changes", humanIntervention: true },
                { id: "deploy", agentId: "deployer", description: "Deploy to production", humanIntervention: true },
                { id: "notify", agentId: "notifier", description: "Send notifications", humanIntervention: false },
            ],
        });
        const generated = generateFlowDefinitionFile(flow);
        const parsed = parseFlowDefinitionFile(generated);
        expect(parsed).not.toBeNull();
        expect(parsed!.name).toBe("complex_pipeline");
        expect(parsed!.description).toBe("A complex multi-step pipeline");
        expect(parsed!.agentId).toBe("main_orchestrator");
        expect(parsed!.steps).toHaveLength(4);
        expect(parsed!.steps[0]).toEqual(flow.steps[0]);
        expect(parsed!.steps[1]).toEqual(flow.steps[1]);
        expect(parsed!.steps[2]).toEqual(flow.steps[2]);
        expect(parsed!.steps[3]).toEqual(flow.steps[3]);
    });

    it("parses step description from comment when no instructions", () => {
        const flow = makeFlow({
            steps: [
                { id: "s1", agentId: "a1", description: "", humanIntervention: false },
            ],
        });
        const generated = generateFlowDefinitionFile(flow);
        const parsed = parseFlowDefinitionFile(generated);
        expect(parsed).not.toBeNull();
        // When description is empty, the step comment says "// Step 1: s1" (falls back to step id)
        expect(parsed!.steps[0].description).toBe("s1");
    });
});


describe("generateAgentsMdSnippet", () => {
    it("returns a non-empty string", () => {
        const result = generateAgentsMdSnippet(makeFlow());
        expect(result.length).toBeGreaterThan(0);
    });

    it("contains the Workflow policy heading", () => {
        const result = generateAgentsMdSnippet(makeFlow());
        expect(result).toContain("# Workflow policy");
    });

    it("contains coordination agent statement", () => {
        const result = generateAgentsMdSnippet(makeFlow());
        expect(result).toContain("You are a coordination agent, not an implementation agent.");
    });

    it("contains the tool name run_task_flow", () => {
        const result = generateAgentsMdSnippet(makeFlow({ name: "deploy_pipeline" }));
        expect(result).toContain("`run_task_flow`");
    });

    it("contains Parameters to pass section with flowName", () => {
        const result = generateAgentsMdSnippet(makeFlow({ name: "my_flow" }));
        expect(result).toContain("- Pass:");
        expect(result).toContain("flowName: `my_flow`");
        expect(result).toContain("task summary");
    });

    it("contains Execution policy section listing all steps in order", () => {
        const flow = makeFlow({
            steps: [
                { id: "code_step", agentId: "coder", description: "Write code", humanIntervention: false },
                { id: "review_step", agentId: "reviewer", description: "Review code", humanIntervention: false },
                { id: "deploy_step", agentId: "deployer", description: "Deploy", humanIntervention: true },
            ],
        });
        const result = generateAgentsMdSnippet(flow);
        expect(result).toContain("Execution policy:");
        expect(result).toContain("1. code_step (agent: coder)");
        expect(result).toContain("2. review_step (agent: reviewer)");
        expect(result).toContain("3. deploy_step (agent: deployer)");
    });

    it("notes human intervention steps in execution policy", () => {
        const flow = makeFlow({
            steps: [
                { id: "auto_step", agentId: "a1", description: "Auto", humanIntervention: false },
                { id: "approval_step", agentId: "a2", description: "Needs approval", humanIntervention: true },
            ],
        });
        const result = generateAgentsMdSnippet(flow);
        expect(result).toContain("approval_step");
        expect(result).toContain("[requires human approval]");
        // auto_step should NOT have the human approval note
        const autoLine = result.split("\n").find(l => l.includes("auto_step"));
        expect(autoLine).not.toContain("[requires human approval]");
    });

    it("contains Approval policy section", () => {
        const result = generateAgentsMdSnippet(makeFlow());
        expect(result).toContain("Approval policy:");
    });

    it("lists human intervention steps in approval policy when present", () => {
        const flow = makeFlow({
            steps: [
                { id: "s1", agentId: "a1", description: "d1", humanIntervention: true },
                { id: "s2", agentId: "a2", description: "d2", humanIntervention: false },
                { id: "s3", agentId: "a3", description: "d3", humanIntervention: true },
            ],
        });
        const result = generateAgentsMdSnippet(flow);
        expect(result).toContain("Steps requiring human approval: s1, s3");
        expect(result).toContain("resumeToken");
    });

    it("states no steps require approval when none have humanIntervention", () => {
        const flow = makeFlow({
            steps: [
                { id: "s1", agentId: "a1", description: "d1", humanIntervention: false },
            ],
        });
        const result = generateAgentsMdSnippet(flow);
        expect(result).toContain("No steps currently require human approval");
    });

    it("contains Your responsibilities section", () => {
        const result = generateAgentsMdSnippet(makeFlow());
        expect(result).toContain("Your responsibilities:");
        expect(result).toContain("classify the request");
        expect(result).toContain("start the workflow");
        expect(result).toContain("surface failures");
        expect(result).toContain("summarize final outputs");
    });

    it("contains You must not section", () => {
        const result = generateAgentsMdSnippet(makeFlow());
        expect(result).toContain("You must not:");
        expect(result).toContain("implement work directly when the workflow applies");
        expect(result).toContain("skip any flow steps");
        expect(result).toContain("bypass approval gates");
    });

    it("includes step descriptions in execution policy", () => {
        const flow = makeFlow({
            steps: [
                { id: "init", agentId: "setup", description: "Initialize environment", humanIntervention: false },
            ],
        });
        const result = generateAgentsMdSnippet(flow);
        expect(result).toContain("Initialize environment");
    });

    it("handles flow with no description", () => {
        const flow = makeFlow({ description: "" });
        const result = generateAgentsMdSnippet(flow);
        expect(result).toContain("`run_task_flow`");
    });
});


// ============================================================================
// Property-based tests using fast-check
// ============================================================================

import fc from "fast-check";
import type { TaskFlowStep } from "./types.js";
import { TASK_FLOW_TOOL_ID } from "./utils.js";
import * as ts from "typescript";

// --- Generators ---

const alphaChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const alphaNumUnderscoreChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('');
const lowerAlphaNumUnderscoreChars = 'abcdefghijklmnopqrstuvwxyz0123456789_'.split('');
const safeDescChars = 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

/** Generates valid flow names matching ^[a-zA-Z][a-zA-Z0-9_]*$ */
const arbFlowName = fc.tuple(
    fc.string({ unit: fc.constantFrom(...alphaChars), minLength: 1, maxLength: 1 }),
    fc.string({ unit: fc.constantFrom(...alphaNumUnderscoreChars), minLength: 0, maxLength: 15 }),
).map(([first, rest]) => first + rest);

/** Generates a valid step id (alphanumeric + underscores, safe for codegen) */
const arbStepId = fc.string({
    unit: fc.constantFrom(...lowerAlphaNumUnderscoreChars),
    minLength: 1, maxLength: 12,
});

/** Generates a valid agent id */
const arbAgentId = fc.string({
    unit: fc.constantFrom(...lowerAlphaNumUnderscoreChars),
    minLength: 1, maxLength: 12,
});

/** Generates a safe description (no special chars that break codegen) */
const arbDescription = fc.string({
    unit: fc.constantFrom(...safeDescChars),
    minLength: 0, maxLength: 30,
});

/** Generates a valid TaskFlowStep */
const arbFlowStep: fc.Arbitrary<TaskFlowStep> = fc.record({
    id: arbStepId,
    agentId: arbAgentId,
    description: arbDescription,
    humanIntervention: fc.boolean(),
});

/** Generates a valid TaskFlowDefinition with unique step ids, 1-10 steps */
const arbTaskFlowDefinition: fc.Arbitrary<TaskFlowDefinition> = fc.tuple(
    arbFlowName,
    arbDescription,
    arbAgentId,
    fc.array(arbFlowStep, { minLength: 1, maxLength: 6 }),
).map(([name, description, agentId, steps]) => {
    const uniqueSteps = steps.map((s, i) => ({ ...s, id: `${s.id}_${i}` }));
    return { name, description, agentId, steps: uniqueSteps };
});

// Feature: orchestrator-task-flow, Property 2: Flow definition round-trip
describe("Property 2: Flow definition round-trip", () => {
    it("parseFlowDefinitionFile(generateFlowDefinitionFile(flow)) produces equivalent definition", () => {
        fc.assert(
            fc.property(arbTaskFlowDefinition, (flow) => {
                const generated = generateFlowDefinitionFile(flow);
                const parsed = parseFlowDefinitionFile(generated);

                expect(parsed).not.toBeNull();
                expect(parsed!.name).toBe(flow.name);
                expect(parsed!.agentId).toBe(flow.agentId);
                expect(parsed!.steps).toHaveLength(flow.steps.length);

                // Description round-trip: if description matches default goal, it comes back empty
                const defaultGoal = `Execute ${flow.name} flow`;
                if (flow.description === defaultGoal || flow.description === "") {
                    // Both map to empty on round-trip when they match the default
                } else {
                    expect(parsed!.description).toBe(flow.description);
                }

                for (let i = 0; i < flow.steps.length; i++) {
                    expect(parsed!.steps[i].id).toBe(flow.steps[i].id);
                    expect(parsed!.steps[i].agentId).toBe(flow.steps[i].agentId);
                    expect(parsed!.steps[i].humanIntervention).toBe(flow.steps[i].humanIntervention);
                    // Description round-trip: empty descriptions fall back to step id from comment
                    if (flow.steps[i].description) {
                        expect(parsed!.steps[i].description).toBe(flow.steps[i].description);
                    }
                }
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: orchestrator-task-flow, Property 3: Flow definition file structure
describe("Property 3: Flow definition file structure", () => {
    it("contains exactly 1 createManaged, N runTask, and setWaiting before each human intervention step", () => {
        fc.assert(
            fc.property(arbTaskFlowDefinition, (flow) => {
                const generated = generateFlowDefinitionFile(flow);
                const N = flow.steps.length;
                const humanCount = flow.steps.filter(s => s.humanIntervention).length;

                // Exactly one createManaged invocation (not the type definition)
                const createManagedCalls = generated.match(/await\s+\w+\.createManaged\(/g);
                expect(createManagedCalls).toHaveLength(1);

                // Exactly N runTask calls
                const runTaskCalls = generated.match(/flow\.runTask</g);
                expect(runTaskCalls).toHaveLength(N);

                // setWaiting count matches human intervention steps
                const setWaitingCalls = generated.match(/setWaiting\(/g);
                if (humanCount === 0) {
                    expect(setWaitingCalls).toBeNull();
                } else {
                    expect(setWaitingCalls).toHaveLength(humanCount);
                }

                // Verify controllerId and goal are present
                expect(generated).toContain(`controllerId: "${flow.agentId}/start_${flow.name}"`);

                // For each human intervention step, setWaiting appears before its runTask
                for (const step of flow.steps) {
                    if (step.humanIntervention) {
                        const waitIdx = generated.indexOf(`currentStep: "${step.id}"`);
                        const taskIdx = generated.indexOf(`id: "${step.id}"`);
                        expect(waitIdx).toBeGreaterThan(-1);
                        expect(taskIdx).toBeGreaterThan(waitIdx);
                    }
                }
            }),
            { numRuns: 100 },
        );
    });
});



// Feature: orchestrator-task-flow, Property 5: Generated TypeScript is syntactically valid
describe("Property 5: Generated TypeScript is syntactically valid", () => {
    it("flow definition file parses without syntax errors", () => {
        fc.assert(
            fc.property(arbTaskFlowDefinition, (flow) => {
                const generated = generateFlowDefinitionFile(flow);
                const sourceFile = ts.createSourceFile(
                    "test.ts",
                    generated,
                    ts.ScriptTarget.Latest,
                    true,
                );
                const diagnostics = (sourceFile as any).parseDiagnostics;
                if (diagnostics && diagnostics.length > 0) {
                    throw new Error(`Syntax errors in flow definition: ${diagnostics.map((d: any) => d.messageText).join(", ")}`);
                }
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: orchestrator-task-flow, Property 6: No cleanup calls in generated files
describe("Property 6: No cleanup calls in generated files", () => {
    it("generated flow definition file does not contain deleteSession", () => {
        fc.assert(
            fc.property(arbTaskFlowDefinition, (flow) => {
                const flowFile = generateFlowDefinitionFile(flow);
                expect(flowFile).not.toContain("deleteSession");
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: orchestrator-task-flow, Property 9: AGENTS.md snippet contains required sections
describe("Property 9: AGENTS.md snippet contains required sections", () => {
    it("contains run_task_flow tool name, flowName param, execution policy, approval policy, responsibilities, and must-not sections", () => {
        fc.assert(
            fc.property(arbTaskFlowDefinition, (flow) => {
                const snippet = generateAgentsMdSnippet(flow);

                // Common tool name present
                expect(snippet).toContain("`run_task_flow`");

                // flowName parameter present
                expect(snippet).toContain("flowName: `" + flow.name + "`");

                // Execution policy lists every step
                expect(snippet).toContain("Execution policy:");
                for (let i = 0; i < flow.steps.length; i++) {
                    const step = flow.steps[i];
                    expect(snippet).toContain(`${i + 1}. ${step.id} (agent: ${step.agentId})`);
                    if (step.humanIntervention) {
                        const stepLine = snippet.split("\n").find(l => l.includes(`${i + 1}. ${step.id}`));
                        expect(stepLine).toContain("[requires human approval]");
                    }
                }

                // Approval policy section
                expect(snippet).toContain("Approval policy:");
                const humanSteps = flow.steps.filter(s => s.humanIntervention);
                if (humanSteps.length > 0) {
                    expect(snippet).toContain("Steps requiring human approval:");
                    expect(snippet).toContain("resumeToken");
                } else {
                    expect(snippet).toContain("No steps currently require human approval");
                }

                // Responsibilities section
                expect(snippet).toContain("Your responsibilities:");
                expect(snippet).toContain("classify the request");
                expect(snippet).toContain("start the workflow");
                expect(snippet).toContain("surface failures");
                expect(snippet).toContain("summarize final outputs");

                // Must-not section
                expect(snippet).toContain("You must not:");
                expect(snippet).toContain("implement work directly when the workflow applies");
                expect(snippet).toContain("skip any flow steps");
                expect(snippet).toContain("bypass approval gates");
            }),
            { numRuns: 100 },
        );
    });
});
