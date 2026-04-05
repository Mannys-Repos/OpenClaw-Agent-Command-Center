import { describe, it, expect } from "vitest";
import { deriveToolId, deriveFileNames, validateFlowDefinition, moveStepUp, moveStepDown, addToolToAlsoAllow, sortExecutions, TASK_FLOW_TOOL_ID } from "./utils.js";
import type { TaskFlowDefinition, TaskFlowStep, WorkflowExecutionRecord } from "./types.js";

describe("TASK_FLOW_TOOL_ID", () => {
    it("is run_task_flow", () => {
        expect(TASK_FLOW_TOOL_ID).toBe("run_task_flow");
    });
});

describe("deriveToolId (legacy)", () => {
    it("prefixes flow name with start_", () => {
        expect(deriveToolId("coding_pipeline")).toBe("start_coding_pipeline");
    });

    it("handles single-character name", () => {
        expect(deriveToolId("x")).toBe("start_x");
    });
});

describe("deriveFileNames", () => {
    it("returns .flow.ts file name", () => {
        const result = deriveFileNames("coding_pipeline");
        expect(result).toEqual({
            flowFile: "coding_pipeline.flow.ts",
        });
    });
});

describe("validateFlowDefinition", () => {
    function makeFlow(overrides: Partial<TaskFlowDefinition> = {}): TaskFlowDefinition {
        return {
            name: "my_flow",
            description: "A test flow",
            agentId: "orchestrator",
            steps: [{ id: "step1", agentId: "agent1", description: "do stuff", humanIntervention: false }],
            ...overrides,
        };
    }

    it("returns valid for a well-formed flow", () => {
        expect(validateFlowDefinition(makeFlow())).toEqual({ valid: true });
    });

    it("rejects empty name", () => {
        const result = validateFlowDefinition(makeFlow({ name: "" }));
        expect(result.valid).toBe(false);
        expect(result.error).toContain("Flow name must match");
    });

    it("rejects name starting with a number", () => {
        const result = validateFlowDefinition(makeFlow({ name: "1flow" }));
        expect(result.valid).toBe(false);
    });

    it("rejects name with spaces", () => {
        const result = validateFlowDefinition(makeFlow({ name: "my flow" }));
        expect(result.valid).toBe(false);
    });

    it("rejects name with special characters", () => {
        const result = validateFlowDefinition(makeFlow({ name: "my-flow" }));
        expect(result.valid).toBe(false);
    });

    it("rejects flow with no steps", () => {
        const result = validateFlowDefinition(makeFlow({ steps: [] }));
        expect(result.valid).toBe(false);
        expect(result.error).toContain("at least one step");
    });

    it("rejects step with empty id", () => {
        const result = validateFlowDefinition(makeFlow({
            steps: [{ id: "", agentId: "agent1", description: "x", humanIntervention: false }],
        }));
        expect(result.valid).toBe(false);
        expect(result.error).toContain("empty id");
    });

    it("rejects step with whitespace-only id", () => {
        const result = validateFlowDefinition(makeFlow({
            steps: [{ id: "  ", agentId: "agent1", description: "x", humanIntervention: false }],
        }));
        expect(result.valid).toBe(false);
        expect(result.error).toContain("empty id");
    });

    it("rejects step with empty agentId", () => {
        const result = validateFlowDefinition(makeFlow({
            steps: [{ id: "s1", agentId: "", description: "x", humanIntervention: false }],
        }));
        expect(result.valid).toBe(false);
        expect(result.error).toContain("empty agentId");
    });

    it("rejects duplicate step ids", () => {
        const result = validateFlowDefinition(makeFlow({
            steps: [
                { id: "dup", agentId: "a1", description: "x", humanIntervention: false },
                { id: "dup", agentId: "a2", description: "y", humanIntervention: false },
            ],
        }));
        expect(result.valid).toBe(false);
        expect(result.error).toContain("Duplicate step id: dup");
    });

    it("accepts name with underscores and mixed case", () => {
        const result = validateFlowDefinition(makeFlow({ name: "My_Flow_V2" }));
        expect(result.valid).toBe(true);
    });

    it("accepts flow with multiple valid steps", () => {
        const result = validateFlowDefinition(makeFlow({
            steps: [
                { id: "s1", agentId: "a1", description: "x", humanIntervention: false },
                { id: "s2", agentId: "a2", description: "y", humanIntervention: true },
            ],
        }));
        expect(result.valid).toBe(true);
    });
});

function makeStep(id: string): TaskFlowStep {
    return { id, agentId: `agent_${id}`, description: `do ${id}`, humanIntervention: false };
}

describe("moveStepUp", () => {
    it("swaps step with the one above it", () => {
        const steps = [makeStep("a"), makeStep("b"), makeStep("c")];
        const result = moveStepUp(steps, 1);
        expect(result.map(s => s.id)).toEqual(["b", "a", "c"]);
    });

    it("is a no-op when index is 0", () => {
        const steps = [makeStep("a"), makeStep("b")];
        const result = moveStepUp(steps, 0);
        expect(result.map(s => s.id)).toEqual(["a", "b"]);
    });

    it("returns a new array (immutable)", () => {
        const steps = [makeStep("a"), makeStep("b")];
        const result = moveStepUp(steps, 1);
        expect(result).not.toBe(steps);
    });

    it("preserves step content after swap", () => {
        const steps = [makeStep("a"), { id: "b", agentId: "special", description: "important", humanIntervention: true }];
        const result = moveStepUp(steps, 1);
        expect(result[0]).toEqual({ id: "b", agentId: "special", description: "important", humanIntervention: true });
        expect(result[1]).toEqual(makeStep("a"));
    });

    it("preserves total count", () => {
        const steps = [makeStep("a"), makeStep("b"), makeStep("c")];
        const result = moveStepUp(steps, 2);
        expect(result).toHaveLength(3);
    });
});

describe("moveStepDown", () => {
    it("swaps step with the one below it", () => {
        const steps = [makeStep("a"), makeStep("b"), makeStep("c")];
        const result = moveStepDown(steps, 1);
        expect(result.map(s => s.id)).toEqual(["a", "c", "b"]);
    });

    it("is a no-op when index is last", () => {
        const steps = [makeStep("a"), makeStep("b")];
        const result = moveStepDown(steps, 1);
        expect(result.map(s => s.id)).toEqual(["a", "b"]);
    });

    it("returns a new array (immutable)", () => {
        const steps = [makeStep("a"), makeStep("b")];
        const result = moveStepDown(steps, 0);
        expect(result).not.toBe(steps);
    });

    it("preserves step content after swap", () => {
        const steps = [{ id: "a", agentId: "special", description: "important", humanIntervention: true }, makeStep("b")];
        const result = moveStepDown(steps, 0);
        expect(result[0]).toEqual(makeStep("b"));
        expect(result[1]).toEqual({ id: "a", agentId: "special", description: "important", humanIntervention: true });
    });

    it("preserves total count", () => {
        const steps = [makeStep("a"), makeStep("b"), makeStep("c")];
        const result = moveStepDown(steps, 0);
        expect(result).toHaveLength(3);
    });
});

describe("addToolToAlsoAllow", () => {
    it("adds a new tool id", () => {
        const result = addToolToAlsoAllow(["tool_a"], "tool_b");
        expect(result).toEqual(["tool_a", "tool_b"]);
    });

    it("does not add a duplicate", () => {
        const result = addToolToAlsoAllow(["tool_a", "tool_b"], "tool_b");
        expect(result).toEqual(["tool_a", "tool_b"]);
    });

    it("adds to an empty array", () => {
        const result = addToolToAlsoAllow([], "start_my_flow");
        expect(result).toEqual(["start_my_flow"]);
    });

    it("returns a new array (immutable)", () => {
        const original = ["tool_a"];
        const result = addToolToAlsoAllow(original, "tool_b");
        expect(result).not.toBe(original);
    });

    it("returns a new array even when not adding", () => {
        const original = ["tool_a"];
        const result = addToolToAlsoAllow(original, "tool_a");
        expect(result).not.toBe(original);
        expect(result).toEqual(["tool_a"]);
    });
});

describe("sortExecutions", () => {
    function makeExec(state: WorkflowExecutionRecord["state"], startedAt: string): WorkflowExecutionRecord {
        return {
            flowId: `flow_${startedAt}`,
            flowName: "test",
            controllerId: "orchestrator/start_test",
            state,
            steps: [],
            startedAt,
        };
    }

    it("places running before completed", () => {
        const records = [
            makeExec("completed", "2024-01-01T00:00:00Z"),
            makeExec("running", "2024-01-01T00:00:00Z"),
        ];
        const result = sortExecutions(records);
        expect(result[0].state).toBe("running");
        expect(result[1].state).toBe("completed");
    });

    it("places waiting before failed", () => {
        const records = [
            makeExec("failed", "2024-01-02T00:00:00Z"),
            makeExec("waiting", "2024-01-01T00:00:00Z"),
        ];
        const result = sortExecutions(records);
        expect(result[0].state).toBe("waiting");
        expect(result[1].state).toBe("failed");
    });

    it("sorts newest first within active group", () => {
        const records = [
            makeExec("running", "2024-01-01T00:00:00Z"),
            makeExec("running", "2024-01-03T00:00:00Z"),
            makeExec("waiting", "2024-01-02T00:00:00Z"),
        ];
        const result = sortExecutions(records);
        expect(result.map(r => r.startedAt)).toEqual([
            "2024-01-03T00:00:00Z",
            "2024-01-02T00:00:00Z",
            "2024-01-01T00:00:00Z",
        ]);
    });

    it("sorts newest first within inactive group", () => {
        const records = [
            makeExec("completed", "2024-01-01T00:00:00Z"),
            makeExec("failed", "2024-01-03T00:00:00Z"),
            makeExec("completed", "2024-01-02T00:00:00Z"),
        ];
        const result = sortExecutions(records);
        expect(result.map(r => r.startedAt)).toEqual([
            "2024-01-03T00:00:00Z",
            "2024-01-02T00:00:00Z",
            "2024-01-01T00:00:00Z",
        ]);
    });

    it("handles mixed states correctly", () => {
        const records = [
            makeExec("completed", "2024-01-04T00:00:00Z"),
            makeExec("running", "2024-01-01T00:00:00Z"),
            makeExec("failed", "2024-01-03T00:00:00Z"),
            makeExec("waiting", "2024-01-02T00:00:00Z"),
        ];
        const result = sortExecutions(records);
        // Active first (waiting, running), then inactive (failed, completed)
        expect(result[0].state).toBe("waiting");
        expect(result[1].state).toBe("running");
        expect(result[2].state).toBe("completed");
        expect(result[3].state).toBe("failed");
    });

    it("returns a new array (immutable)", () => {
        const records = [makeExec("running", "2024-01-01T00:00:00Z")];
        const result = sortExecutions(records);
        expect(result).not.toBe(records);
    });

    it("handles empty array", () => {
        expect(sortExecutions([])).toEqual([]);
    });
});


// ============================================================================
// Property-based tests using fast-check
// ============================================================================

import fc from "fast-check";

// --- Generators ---

const alphaChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const alphaNumUnderscoreChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('');
const lowerAlphaNumUnderscoreChars = 'abcdefghijklmnopqrstuvwxyz0123456789_'.split('');
const safeDescChars = 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Generates valid flow names matching ^[a-zA-Z][a-zA-Z0-9_]*$ */
const arbFlowName = fc.tuple(
    fc.string({ unit: fc.constantFrom(...alphaChars), minLength: 1, maxLength: 1 }),
    fc.string({ unit: fc.constantFrom(...alphaNumUnderscoreChars), minLength: 0, maxLength: 20 }),
).map(([first, rest]) => first + rest);

/** Generates invalid flow names that do NOT match the pattern */
const arbInvalidFlowName = fc.oneof(
    fc.constant(""),
    fc.tuple(
        fc.string({ unit: fc.constantFrom(...'0123456789'.split('')), minLength: 1, maxLength: 1 }),
        fc.string({ unit: fc.constantFrom(...lowerAlphaNumUnderscoreChars), minLength: 0, maxLength: 10 }),
    ).map(([first, rest]) => first + rest),
    fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz -!@#$%'.split('')), minLength: 2, maxLength: 10 }).filter(s => /[\s\-!@#$%]/.test(s)),
);

/** Generates a valid TaskFlowStep */
const arbFlowStep: fc.Arbitrary<TaskFlowStep> = fc.record({
    id: fc.string({ unit: fc.constantFrom(...lowerAlphaNumUnderscoreChars), minLength: 1, maxLength: 15 }),
    agentId: fc.string({ unit: fc.constantFrom(...lowerAlphaNumUnderscoreChars), minLength: 1, maxLength: 15 }),
    description: fc.string({ unit: fc.constantFrom(...safeDescChars), minLength: 0, maxLength: 30 }),
    humanIntervention: fc.boolean(),
});

/** Generates a valid TaskFlowDefinition with unique step ids */
const arbTaskFlowDefinition: fc.Arbitrary<TaskFlowDefinition> = fc.tuple(
    arbFlowName,
    fc.string({ minLength: 0, maxLength: 40 }).map(s => s.replace(/[\\"`${}]/g, '')),
    fc.string({ unit: fc.constantFrom(...lowerAlphaNumUnderscoreChars), minLength: 1, maxLength: 15 }),
    fc.array(arbFlowStep, { minLength: 1, maxLength: 10 }),
).map(([name, description, agentId, steps]) => {
    // Ensure unique step ids by appending index
    const uniqueSteps = steps.map((s, i) => ({ ...s, id: `${s.id}_${i}` }));
    return { name, description, agentId, steps: uniqueSteps };
});

/** Generates a WorkflowExecutionRecord with random state and timestamp */
const arbExecutionRecord: fc.Arbitrary<WorkflowExecutionRecord> = fc.record({
    flowId: fc.uuid(),
    flowName: arbFlowName,
    controllerId: arbFlowName.map(n => `orchestrator/start_${n}`),
    state: fc.constantFrom("running" as const, "completed" as const, "failed" as const, "waiting" as const),
    steps: fc.constant([]),
    startedAt: fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ms => new Date(ms).toISOString()),
});

// Feature: orchestrator-task-flow, Property 1: Tool ID derivation
describe("Property 1: Tool ID derivation", () => {
    it("TASK_FLOW_TOOL_ID is always run_task_flow", () => {
        expect(TASK_FLOW_TOOL_ID).toBe("run_task_flow");
    });

    it("deriveToolId (legacy) always returns 'start_' + flowName for valid names", () => {
        fc.assert(
            fc.property(arbFlowName, (name) => {
                expect(deriveToolId(name)).toBe("start_" + name);
            }),
            { numRuns: 100 },
        );
    });

    it("deriveFileNames returns correct .flow.ts path", () => {
        fc.assert(
            fc.property(arbFlowName, (name) => {
                const result = deriveFileNames(name);
                expect(result.flowFile).toBe(name + ".flow.ts");
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: orchestrator-task-flow, Property 7: Comprehensive flow validation
describe("Property 7: Comprehensive flow validation", () => {
    it("accepts all valid TaskFlowDefinitions", () => {
        fc.assert(
            fc.property(arbTaskFlowDefinition, (flow) => {
                const result = validateFlowDefinition(flow);
                expect(result.valid).toBe(true);
            }),
            { numRuns: 100 },
        );
    });

    it("rejects flows with invalid names", () => {
        fc.assert(
            fc.property(
                arbInvalidFlowName,
                fc.array(arbFlowStep, { minLength: 1, maxLength: 3 }),
                (name, steps) => {
                    const uniqueSteps = steps.map((s, i) => ({ ...s, id: `s_${i}` }));
                    const flow: TaskFlowDefinition = { name, description: "", agentId: "a", steps: uniqueSteps };
                    const result = validateFlowDefinition(flow);
                    expect(result.valid).toBe(false);
                },
            ),
            { numRuns: 100 },
        );
    });

    it("rejects flows with zero steps", () => {
        fc.assert(
            fc.property(arbFlowName, (name) => {
                const flow: TaskFlowDefinition = { name, description: "", agentId: "a", steps: [] };
                const result = validateFlowDefinition(flow);
                expect(result.valid).toBe(false);
                expect(result.error).toContain("at least one step");
            }),
            { numRuns: 100 },
        );
    });

    it("rejects flows with empty step ids", () => {
        fc.assert(
            fc.property(arbFlowName, (name) => {
                const flow: TaskFlowDefinition = {
                    name,
                    description: "",
                    agentId: "a",
                    steps: [{ id: "", agentId: "agent1", description: "x", humanIntervention: false }],
                };
                const result = validateFlowDefinition(flow);
                expect(result.valid).toBe(false);
                expect(result.error).toContain("empty id");
            }),
            { numRuns: 100 },
        );
    });

    it("rejects flows with empty step agentIds", () => {
        fc.assert(
            fc.property(arbFlowName, (name) => {
                const flow: TaskFlowDefinition = {
                    name,
                    description: "",
                    agentId: "a",
                    steps: [{ id: "s1", agentId: "", description: "x", humanIntervention: false }],
                };
                const result = validateFlowDefinition(flow);
                expect(result.valid).toBe(false);
                expect(result.error).toContain("empty agentId");
            }),
            { numRuns: 100 },
        );
    });

    it("rejects flows with duplicate step ids", () => {
        fc.assert(
            fc.property(arbFlowName, arbFlowStep, (name, step) => {
                const flow: TaskFlowDefinition = {
                    name,
                    description: "",
                    agentId: "a",
                    steps: [
                        { ...step, id: "dup_id" },
                        { ...step, id: "dup_id", agentId: "other" },
                    ],
                };
                const result = validateFlowDefinition(flow);
                expect(result.valid).toBe(false);
                expect(result.error).toContain("Duplicate step id");
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: orchestrator-task-flow, Property 8: Step reorder preserves content
describe("Property 8: Step reorder preserves content", () => {
    it("moveStepUp swaps neighbors without altering content, total count unchanged", () => {
        fc.assert(
            fc.property(
                fc.array(arbFlowStep, { minLength: 2, maxLength: 10 }).chain(steps => {
                    const uniqueSteps = steps.map((s, i) => ({ ...s, id: `s_${i}` }));
                    return fc.tuple(fc.constant(uniqueSteps), fc.integer({ min: 1, max: uniqueSteps.length - 1 }));
                }),
                ([steps, index]) => {
                    const result = moveStepUp(steps, index);
                    expect(result).toHaveLength(steps.length);
                    // The swapped elements
                    expect(result[index - 1]).toEqual(steps[index]);
                    expect(result[index]).toEqual(steps[index - 1]);
                    // All other elements unchanged
                    for (let i = 0; i < steps.length; i++) {
                        if (i !== index && i !== index - 1) {
                            expect(result[i]).toEqual(steps[i]);
                        }
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    it("moveStepUp is a no-op at index 0", () => {
        fc.assert(
            fc.property(
                fc.array(arbFlowStep, { minLength: 1, maxLength: 10 }).map(steps =>
                    steps.map((s, i) => ({ ...s, id: `s_${i}` }))
                ),
                (steps) => {
                    const result = moveStepUp(steps, 0);
                    expect(result).toHaveLength(steps.length);
                    for (let i = 0; i < steps.length; i++) {
                        expect(result[i]).toEqual(steps[i]);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    it("moveStepDown swaps neighbors without altering content, total count unchanged", () => {
        fc.assert(
            fc.property(
                fc.array(arbFlowStep, { minLength: 2, maxLength: 10 }).chain(steps => {
                    const uniqueSteps = steps.map((s, i) => ({ ...s, id: `s_${i}` }));
                    return fc.tuple(fc.constant(uniqueSteps), fc.integer({ min: 0, max: uniqueSteps.length - 2 }));
                }),
                ([steps, index]) => {
                    const result = moveStepDown(steps, index);
                    expect(result).toHaveLength(steps.length);
                    expect(result[index]).toEqual(steps[index + 1]);
                    expect(result[index + 1]).toEqual(steps[index]);
                    for (let i = 0; i < steps.length; i++) {
                        if (i !== index && i !== index + 1) {
                            expect(result[i]).toEqual(steps[i]);
                        }
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    it("moveStepDown is a no-op at last index", () => {
        fc.assert(
            fc.property(
                fc.array(arbFlowStep, { minLength: 1, maxLength: 10 }).map(steps =>
                    steps.map((s, i) => ({ ...s, id: `s_${i}` }))
                ),
                (steps) => {
                    const result = moveStepDown(steps, steps.length - 1);
                    expect(result).toHaveLength(steps.length);
                    for (let i = 0; i < steps.length; i++) {
                        expect(result[i]).toEqual(steps[i]);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: orchestrator-task-flow, Property 10: Workflow execution sort order
describe("Property 10: Workflow execution sort order", () => {
    it("running/waiting records appear before completed/failed, newest first within groups", () => {
        fc.assert(
            fc.property(
                fc.array(arbExecutionRecord, { minLength: 0, maxLength: 20 }),
                (records) => {
                    const sorted = sortExecutions(records);
                    expect(sorted).toHaveLength(records.length);

                    // Find the boundary between active and inactive
                    let lastActiveIdx = -1;
                    for (let i = 0; i < sorted.length; i++) {
                        if (sorted[i].state === "running" || sorted[i].state === "waiting") {
                            lastActiveIdx = i;
                        }
                    }

                    // All active records should come before all inactive records
                    for (let i = lastActiveIdx + 1; i < sorted.length; i++) {
                        expect(sorted[i].state === "completed" || sorted[i].state === "failed").toBe(true);
                    }

                    // Within active group, sorted by startedAt descending
                    for (let i = 1; i <= lastActiveIdx; i++) {
                        expect(new Date(sorted[i - 1].startedAt).getTime())
                            .toBeGreaterThanOrEqual(new Date(sorted[i].startedAt).getTime());
                    }

                    // Within inactive group, sorted by startedAt descending
                    for (let i = lastActiveIdx + 2; i < sorted.length; i++) {
                        expect(new Date(sorted[i - 1].startedAt).getTime())
                            .toBeGreaterThanOrEqual(new Date(sorted[i].startedAt).getTime());
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: orchestrator-task-flow, Property 11: AlsoAllow idempotence
describe("Property 11: AlsoAllow idempotence", () => {
    it("after addToolToAlsoAllow, the tool ID appears exactly once", () => {
        fc.assert(
            fc.property(
                fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 10 }),
                fc.string({ minLength: 1, maxLength: 20 }),
                (alsoAllow, toolId) => {
                    const result = addToolToAlsoAllow(alsoAllow, toolId);
                    const count = result.filter(t => t === toolId).length;
                    expect(count).toBe(1);
                },
            ),
            { numRuns: 100 },
        );
    });

    it("applying addToolToAlsoAllow twice is the same as once", () => {
        fc.assert(
            fc.property(
                fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 10 }),
                fc.string({ minLength: 1, maxLength: 20 }),
                (alsoAllow, toolId) => {
                    const once = addToolToAlsoAllow(alsoAllow, toolId);
                    const twice = addToolToAlsoAllow(once, toolId);
                    expect(twice).toEqual(once);
                },
            ),
            { numRuns: 100 },
        );
    });
});
