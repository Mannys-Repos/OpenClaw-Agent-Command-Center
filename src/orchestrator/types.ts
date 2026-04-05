/**
 * Core data types for the Orchestrator Task Flow feature.
 * Shared between API endpoints and code generation.
 */

/** A single step within a Task Flow. */
export interface TaskFlowStep {
    /** Step identifier, unique within the flow. */
    id: string;
    /** Target agent to execute this step. */
    agentId: string;
    /** What this step does. */
    description: string;
    /** Whether to pause for approval before this step. */
    humanIntervention: boolean;
}

/** The core flow definition passed between the Orchestrator tab and the save API. */
export interface TaskFlowDefinition {
    /** Flow name, validated: ^[a-zA-Z][a-zA-Z0-9_]*$ */
    name: string;
    /** Optional flow description. */
    description: string;
    /** Owning agent ID. */
    agentId: string;
    /** Ordered list of flow steps. */
    steps: TaskFlowStep[];
}

/** A record of a single step's execution within a workflow. */
export interface WorkflowStepRecord {
    /** Step ID. */
    id: string;
    /** Target agent. */
    agentId: string;
    /** Step execution status. */
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    /** ISO timestamp when the step started. */
    startedAt?: string;
    /** ISO timestamp when the step ended. */
    endedAt?: string;
    /** Duration in milliseconds. */
    duration?: number;
    /** Step failure reason. */
    error?: string;
}

/** A record of a workflow execution, returned by GET /api/tasks/flows. */
export interface WorkflowExecutionRecord {
    /** Unique execution ID. */
    flowId: string;
    /** Derived from controllerId. */
    flowName: string;
    /** e.g., "orchestrator/start_my_flow" */
    controllerId: string;
    /** Current execution state. */
    state: "running" | "completed" | "failed" | "waiting";
    /** Step-level progress. */
    steps: WorkflowStepRecord[];
    /** ISO timestamp. */
    startedAt: string;
    /** ISO timestamp (if completed/failed). */
    endedAt?: string;
    /** Failure reason (if failed). */
    error?: string;
    /** Step ID currently waiting (if waiting). */
    waitingStep?: string;
}

/** POST body for saving a flow. */
export interface SaveFlowRequest {
    flow: TaskFlowDefinition;
    /** When true, overwrite an existing flow file instead of returning 409. */
    overwrite?: boolean;
}

/** Response from POST /api/tasks/flows/save. */
export interface SaveFlowResponse {
    ok: boolean;
    /** Path to generated .flow.ts */
    flowFile: string;
    /** The common tool id: "run_task_flow" */
    toolId: string;
    /** Generated AGENTS.md snippet. */
    snippet: string;
}
