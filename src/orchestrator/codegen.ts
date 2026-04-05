import type { TaskFlowDefinition, TaskFlowStep } from "./types.js";
import { TASK_FLOW_TOOL_ID } from "./utils.js";

/**
 * Converts a step id like "coder-initial" to a PascalCase type name like "CoderInitialResult".
 * Ensures the result starts with a letter (prefixes with "Step" if it starts with a digit).
 */
function stepIdToTypeName(stepId: string): string {
    const raw = stepId
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join("") + "Result";
    // Ensure it starts with a letter
    if (/^[0-9]/.test(raw)) {
        return "Step" + raw;
    }
    return raw;
}

/**
 * Converts a step id to a safe JavaScript variable name.
 * Replaces non-alphanumeric/underscore chars and prefixes with _ if it starts with a digit.
 */
function stepIdToVarName(stepId: string): string {
    const raw = stepId.replace(/[^a-zA-Z0-9_]/g, "_");
    if (/^[0-9]/.test(raw)) {
        return "_" + raw;
    }
    return raw;
}

/**
 * Escapes a string for safe use inside a JS double-quoted string.
 */
function escapeDoubleQuoted(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/**
 * Sanitizes a string for use in a single-line JS comment.
 * Strips newlines and limits length.
 */
function sanitizeComment(s: string): string {
    return s.replace(/[\r\n]+/g, " ").replace(/\*\//g, "* /").slice(0, 200);
}

/**
 * Converts a flow name like "coding_pipeline" to a PascalCase name like "CodingPipeline".
 */
function flowNameToPascal(flowName: string): string {
    return flowName
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join("");
}

/**
 * Generates the .flow.ts file content for a TaskFlowDefinition.
 *
 * Follows the patterns from Tasks/coding_pipeline.flow.ts:
 * - Typed result interfaces per step
 * - Typed input interface
 * - createManaged() call with correct controllerId and goal
 * - Sequential runTask() calls per step
 * - setWaiting() calls before steps with humanIntervention=true
 * - Error handling with flow.fail() and flow.complete()
 */
export function generateFlowDefinitionFile(flow: TaskFlowDefinition): string {
    const lines: string[] = [];
    const pascal = flowNameToPascal(flow.name);
    const controllerId = `${flow.agentId}/start_${flow.name}`;
    const goalRaw = flow.description || `Execute ${flow.name} flow`;

    // --- Result type per step ---
    for (const step of flow.steps) {
        const typeName = stepIdToTypeName(step.id);
        lines.push(`type ${typeName} = {`);
        lines.push(`    status: string;`);
        lines.push(`    summary?: string;`);
        lines.push(`};`);
        lines.push(``);
    }

    // --- Input type ---
    lines.push(`type ${pascal}FlowInput = {`);
    lines.push(`    task: string;`);
    lines.push(`};`);
    lines.push(``);

    // --- Shared SDK types (matching coding_pipeline.flow.ts) ---
    lines.push(`type AgentTaskResult<T> = {`);
    lines.push(`    output: T;`);
    lines.push(`};`);
    lines.push(``);

    lines.push(`type FlowHandle = {`);
    lines.push(`    runTask<T>(args: {`);
    lines.push(`        id: string;`);
    lines.push(`        agentId: string;`);
    lines.push(`        input: Record<string, unknown>;`);
    lines.push(`    }): Promise<AgentTaskResult<T>>;`);
    lines.push(`    fail(args: {`);
    lines.push(`        reason: string;`);
    lines.push(`        details?: unknown;`);
    lines.push(`    }): Promise<void>;`);
    lines.push(`    complete(args: {`);
    lines.push(`        result: Record<string, unknown>;`);
    lines.push(`    }): Promise<void>;`);
    lines.push(`};`);
    lines.push(``);

    lines.push(`type TaskFlowRuntime = {`);
    lines.push(`    createManaged(args: {`);
    lines.push(`        controllerId: string;`);
    lines.push(`        goal: string;`);
    lines.push(`        metadata?: Record<string, unknown>;`);
    lines.push(`    }): Promise<FlowHandle>;`);
    lines.push(`};`);
    lines.push(``);

    lines.push(`type ToolContext = {`);
    lines.push(`    input: ${pascal}FlowInput;`);
    lines.push(`    api: {`);
    lines.push(`        runtime: {`);
    lines.push(`            taskFlow: {`);
    lines.push(`                fromToolContext(ctx: ToolContext): TaskFlowRuntime;`);
    lines.push(`            };`);
    lines.push(`        };`);
    lines.push(`    };`);
    lines.push(`};`);
    lines.push(``);

    // --- Main flow function ---
    const fnName = `start${pascal}Flow`;
    lines.push(`export async function ${fnName}(ctx: ToolContext) {`);
    lines.push(`    const task = ctx.input.task;`);
    lines.push(``);
    lines.push(`    const taskFlow = ctx.api.runtime.taskFlow.fromToolContext(ctx);`);
    lines.push(``);
    lines.push(`    const flow = await taskFlow.createManaged({`);
    lines.push(`        controllerId: "${controllerId}",`);
    lines.push(`        goal: ${JSON.stringify(goalRaw)},`);
    lines.push(`        metadata: {`);
    lines.push(`            task,`);
    lines.push(`        },`);
    lines.push(`    });`);
    lines.push(``);
    lines.push(`    try {`);

    // --- Sequential step calls ---
    for (let i = 0; i < flow.steps.length; i++) {
        const step = flow.steps[i];
        const typeName = stepIdToTypeName(step.id);
        const varName = stepIdToVarName(step.id);
        const stepNum = i + 1;

        lines.push(``);
        lines.push(`        // Step ${stepNum}: ${sanitizeComment(step.description || step.id)}`);

        // setWaiting before humanIntervention steps
        if (step.humanIntervention) {
            lines.push(`        await taskFlow.setWaiting({`);
            lines.push(`            currentStep: "${escapeDoubleQuoted(step.id)}",`);
            lines.push(`            waitJson: { kind: "approval" },`);
            lines.push(`        });`);
            lines.push(``);
        }

        lines.push(`        const ${varName} = await flow.runTask<${typeName}>({`);
        lines.push(`            id: "${escapeDoubleQuoted(step.id)}",`);
        lines.push(`            agentId: "${escapeDoubleQuoted(step.agentId)}",`);
        lines.push(`            input: {`);
        lines.push(`                task,`);
        if (step.description) {
            lines.push(`                instructions: [${JSON.stringify(step.description)}],`);
        }
        lines.push(`            },`);
        lines.push(`        });`);
    }

    // --- Complete ---
    lines.push(``);
    lines.push(`        const finalResult = {`);
    lines.push(`            status: "SUCCESS",`);
    lines.push(`            task,`);
    for (const step of flow.steps) {
        const varName = stepIdToVarName(step.id);
        lines.push(`            ${varName}: ${varName}.output,`);
    }
    lines.push(`        };`);
    lines.push(``);
    lines.push(`        await flow.complete({`);
    lines.push(`            result: finalResult,`);
    lines.push(`        });`);
    lines.push(``);
    lines.push(`        return finalResult;`);

    // --- Error handling ---
    lines.push(`    } catch (error) {`);
    lines.push(`        const message =`);
    lines.push(`            error instanceof Error ? error.message : "Unknown flow execution error";`);
    lines.push(``);
    lines.push(`        await flow.fail({`);
    lines.push(`            reason: "Unhandled exception during ${flow.name} flow.",`);
    lines.push(`            details: {`);
    lines.push(`                error: message,`);
    lines.push(`            },`);
    lines.push(`        });`);
    lines.push(``);
    lines.push(`        return {`);
    lines.push(`            status: "FAILED",`);
    lines.push(`            reason: message,`);
    lines.push(`        };`);
    lines.push(`    }`);
    lines.push(`}`);
    lines.push(``);

    return lines.join("\n");
}

/**
 * Parses a generated .flow.ts file back into a TaskFlowDefinition object.
 *
 * This is the inverse of generateFlowDefinitionFile(). It extracts:
 * - Flow name and agentId from the controllerId string
 * - Description from the goal template literal
 * - Steps from runTask() calls, with humanIntervention detected via setWaiting() calls
 * - Step descriptions from the instructions array or step comments
 *
 * Returns null if the content cannot be parsed.
 */
export function parseFlowDefinitionFile(content: string): TaskFlowDefinition | null {
    // Extract controllerId: "agentId/start_flowName"
    const controllerMatch = content.match(/controllerId:\s*"([^"]+)"/);
    if (!controllerMatch) return null;

    const controllerId = controllerMatch[1];
    const controllerParts = controllerId.match(/^(.+)\/start_(.+)$/);
    if (!controllerParts) return null;

    const agentId = controllerParts[1];
    const name = controllerParts[2];

    // Extract goal from the goal field (double-quoted string or template literal)
    let description = "";
    const goalStringMatch = content.match(/goal:\s*"((?:[^"\\]|\\.)*)"/);
    const goalTemplateLiteralMatch = content.match(/goal:\s*`([^`]*)`/);
    let goalRaw = "";
    if (goalStringMatch) {
        // Unescape JSON-style escapes
        goalRaw = goalStringMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    } else if (goalTemplateLiteralMatch) {
        goalRaw = goalTemplateLiteralMatch[1];
    }

    // The default goal is "Execute <name> flow" — if it matches, description is empty
    const defaultGoal = `Execute ${name} flow`;
    if (goalRaw !== defaultGoal) {
        description = goalRaw;
    }

    // Collect step IDs that have setWaiting before them
    const waitingStepIds = new Set<string>();
    const setWaitingRegex = /setWaiting\(\{[^}]*currentStep:\s*"([^"]+)"/g;
    let waitMatch: RegExpExecArray | null;
    while ((waitMatch = setWaitingRegex.exec(content)) !== null) {
        waitingStepIds.add(waitMatch[1]);
    }

    // Extract step comments: // Step N: description
    const stepComments = new Map<number, string>();
    const stepCommentRegex = /\/\/\s*Step\s+(\d+):\s*(.+)/g;
    let commentMatch: RegExpExecArray | null;
    while ((commentMatch = stepCommentRegex.exec(content)) !== null) {
        stepComments.set(parseInt(commentMatch[1], 10), commentMatch[2].trim());
    }

    // Extract runTask calls with id, agentId, and instructions
    const steps: TaskFlowStep[] = [];
    const runTaskRegex = /flow\.runTask<[^>]*>\(\{([\s\S]*?)\}\);/g;
    let taskMatch: RegExpExecArray | null;
    let stepIndex = 0;

    while ((taskMatch = runTaskRegex.exec(content)) !== null) {
        const block = taskMatch[1];
        stepIndex++;

        // Extract id
        const idMatch = block.match(/id:\s*"([^"]+)"/);
        if (!idMatch) continue;
        const stepId = idMatch[1];

        // Extract agentId
        const agentIdMatch = block.match(/agentId:\s*"([^"]+)"/);
        if (!agentIdMatch) continue;
        const stepAgentId = agentIdMatch[1];

        // Extract description from instructions array or step comment
        let stepDescription = "";
        const instructionsMatch = block.match(/instructions:\s*\[([^\]]*)\]/);
        if (instructionsMatch) {
            // Parse the first string in the instructions array
            const instrContent = instructionsMatch[1].trim();
            const firstStringMatch = instrContent.match(/^"([^"]*)"/);
            if (firstStringMatch) {
                stepDescription = firstStringMatch[1];
            }
        }

        // Fall back to step comment if no instructions found
        if (!stepDescription && stepComments.has(stepIndex)) {
            stepDescription = stepComments.get(stepIndex)!;
        }

        const humanIntervention = waitingStepIds.has(stepId);

        steps.push({
            id: stepId,
            agentId: stepAgentId,
            description: stepDescription,
            humanIntervention,
        });
    }

    if (steps.length === 0) return null;

    return { name, description, agentId, steps };
}

/**
 * Generates an AGENTS.md workflow policy snippet for a TaskFlowDefinition.
 *
 * Follows the pattern from the README AGENTS.md sample:
 * - "Workflow policy" heading with coordination agent statement and tool name
 * - "Parameters to pass" section from flow input schema
 * - "Execution policy" section listing each step in order with id and agentId
 * - "Approval policy" section
 * - "Your responsibilities" section
 * - "You must not" section
 */
export function generateAgentsMdSnippet(flow: TaskFlowDefinition): string {
    const lines: string[] = [];

    // --- Workflow policy heading ---
    lines.push(`# Workflow policy`);
    lines.push(``);
    lines.push(`You are a coordination agent, not an implementation agent.`);
    lines.push(``);
    lines.push(`For requests that match this workflow:`);
    lines.push(`- Do not perform the work yourself.`);
    lines.push(`- Call the \`${TASK_FLOW_TOOL_ID}\` tool.`);
    lines.push(`- Pass:`);

    // --- Parameters to pass ---
    lines.push(`  - flowName: \`${flow.name}\``);
    lines.push(`  - task summary`);
    lines.push(``);

    // --- Execution policy ---
    lines.push(`Execution policy:`);
    for (let i = 0; i < flow.steps.length; i++) {
        const step = flow.steps[i];
        const stepNum = i + 1;
        let line = `${stepNum}. ${step.id} (agent: ${step.agentId})`;
        if (step.description) {
            line += ` — ${step.description}`;
        }
        if (step.humanIntervention) {
            line += ` [requires human approval]`;
        }
        lines.push(line);
    }
    lines.push(``);

    // --- Approval policy ---
    lines.push(`Approval policy:`);
    const humanSteps = flow.steps.filter(s => s.humanIntervention);
    if (humanSteps.length > 0) {
        lines.push(`- Steps requiring human approval: ${humanSteps.map(s => s.id).join(", ")}.`);
        lines.push(`- When the flow pauses for approval, it returns a resumeToken. Tell the user the flow is waiting and which step needs approval.`);
        lines.push(`- To continue after approval, call \`${TASK_FLOW_TOOL_ID}\` with action="resume", the resumeToken, and approve=true.`);
        lines.push(`- To deny, call with approve=false to cancel the flow.`);
        lines.push(`- The user can also approve from the Dashboard.`);
    } else {
        lines.push(`- No steps currently require human approval.`);
    }
    lines.push(`- Any destructive change, production deployment, secret rotation, infrastructure mutation, or irreversible action requires explicit user approval.`);
    lines.push(``);

    // --- Your responsibilities ---
    lines.push(`Your responsibilities:`);
    lines.push(`- classify the request`);
    lines.push(`- start the workflow by calling \`${TASK_FLOW_TOOL_ID}\` with action="run"`);
    lines.push(`- the tool returns ONE step at a time — execute it via \`sessions_spawn\`, then call \`${TASK_FLOW_TOOL_ID}\` with action="step_complete" and the flowToken`);
    lines.push(`- repeat until the flow completes or pauses for approval`);
    lines.push(`- when the flow pauses for approval, tell the user and wait for their decision`);
    lines.push(`- when approved, call \`${TASK_FLOW_TOOL_ID}\` with action="resume" and the flowToken`);
    lines.push(`- surface failures`);
    lines.push(`- summarize final outputs`);
    lines.push(``);

    // --- You must not ---
    lines.push(`You must not:`);
    lines.push(`- implement work directly when the workflow applies`);
    lines.push(`- skip any flow steps`);
    lines.push(`- bypass approval gates — always ask the user before resuming`);
    lines.push(`- approve a paused flow without explicit user consent`);

    return lines.join("\n");
}
