type CoderImplementResult = {
    status: string;
    summary?: string;
};

type CodeReviewResult = {
    status: string;
    summary?: string;
};

type SecurityAuditResult = {
    status: string;
    summary?: string;
};

type DeployPrepResult = {
    status: string;
    summary?: string;
};

type CodingPipelineFlowInput = {
    task: string;
};

type AgentTaskResult<T> = {
    output: T;
};

type FlowHandle = {
    runTask<T>(args: {
        id: string;
        agentId: string;
        input: Record<string, unknown>;
    }): Promise<AgentTaskResult<T>>;
    fail(args: {
        reason: string;
        details?: unknown;
    }): Promise<void>;
    complete(args: {
        result: Record<string, unknown>;
    }): Promise<void>;
};

type TaskFlowRuntime = {
    createManaged(args: {
        controllerId: string;
        goal: string;
        metadata?: Record<string, unknown>;
    }): Promise<FlowHandle>;
};

type ToolContext = {
    input: CodingPipelineFlowInput;
    api: {
        runtime: {
            taskFlow: {
                fromToolContext(ctx: ToolContext): TaskFlowRuntime;
            };
        };
    };
};

export async function startCodingPipelineFlow(ctx: ToolContext) {
    const task = ctx.input.task;

    const taskFlow = ctx.api.runtime.taskFlow.fromToolContext(ctx);

    const flow = await taskFlow.createManaged({
        controllerId: "coding-orchestrator/start_coding_pipeline",
        goal: "Execute coding workflow: implement, review, security audit, and deploy preparation",
        metadata: {
            task,
        },
    });

    try {

        // Step 1: Implement the requested code changes
        const coder_implement = await flow.runTask<CoderImplementResult>({
            id: "coder_implement",
            agentId: "coding",
            input: {
                task,
                instructions: ["Implement the requested code changes"],
            },
        });

        // Step 2: Review implementation for quality and correctness
        const code_review = await flow.runTask<CodeReviewResult>({
            id: "code_review",
            agentId: "code-reviewer",
            input: {
                task,
                instructions: ["Review implementation for quality and correctness"],
            },
        });

        // Step 3: Perform security and safety review of the implementation
        const security_audit = await flow.runTask<SecurityAuditResult>({
            id: "security_audit",
            agentId: "code-security",
            input: {
                task,
                instructions: ["Perform security and safety review of the implementation"],
            },
        });

        // Step 4: Prepare deployment artifacts or deploy if explicitly allowed
        await taskFlow.setWaiting({
            currentStep: "deploy_prep",
            waitJson: { kind: "approval" },
        });

        const deploy_prep = await flow.runTask<DeployPrepResult>({
            id: "deploy_prep",
            agentId: "code-devops",
            input: {
                task,
                instructions: ["Prepare deployment artifacts or deploy if explicitly allowed"],
            },
        });

        const finalResult = {
            status: "SUCCESS",
            task,
            coder_implement: coder_implement.output,
            code_review: code_review.output,
            security_audit: security_audit.output,
            deploy_prep: deploy_prep.output,
        };

        await flow.complete({
            result: finalResult,
        });

        return finalResult;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown flow execution error";

        await flow.fail({
            reason: "Unhandled exception during coding_pipeline flow.",
            details: {
                error: message,
            },
        });

        return {
            status: "FAILED",
            reason: message,
        };
    }
}
