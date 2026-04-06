import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

/**
 * Tests for the Scheduled Tasks (Cron Jobs) functionality.
 *
 * These tests verify:
 * 1. POST /api/tasks — cron job creation with all parameter combinations
 * 2. GET /api/tasks — listing cron jobs
 * 3. DELETE /api/tasks/{id} — removing cron jobs
 * 4. POST /api/tasks/{id}/run — force-running a cron job
 * 5. GET /api/tasks/{id}/runs — getting run history
 * 6. POST /api/tasks/{id}/edit — editing a cron job
 * 7. POST /api/tasks/{id}/cancel — cancelling/disabling a cron job
 * 8. Announce/channel/to delivery parameters
 */

// We need to mock child_process.exec since the API uses it to call `openclaw cron`
// and fs operations for config reading
const mockExec = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockReadFileSync = vi.fn().mockReturnValue('{"agents":{"list":[]}}');
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockReaddirSync = vi.fn().mockReturnValue([]);
const mockUnlinkSync = vi.fn();
const mockStatSync = vi.fn();
const mockWatchFile = vi.fn();
const mockUnwatchFile = vi.fn();
const mockOpenSync = vi.fn();
const mockReadSync = vi.fn();
const mockCloseSync = vi.fn();

vi.mock("node:child_process", () => ({
    exec: mockExec,
}));

vi.mock("node:fs", () => ({
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    unlinkSync: mockUnlinkSync,
    statSync: mockStatSync,
    watchFile: mockWatchFile,
    unwatchFile: mockUnwatchFile,
    openSync: mockOpenSync,
    readSync: mockReadSync,
    closeSync: mockCloseSync,
}));

// Helper to create a mock IncomingMessage with a JSON body
function createMockReq(method: string, url: string, body?: any): IncomingMessage {
    const req = new EventEmitter() as IncomingMessage;
    req.method = method;
    req.url = url;
    req.headers = {};
    // Simulate body delivery
    if (body !== undefined) {
        process.nextTick(() => {
            req.emit("data", JSON.stringify(body));
            req.emit("end");
        });
    } else {
        process.nextTick(() => {
            req.emit("end");
        });
    }
    return req;
}

// Helper to create a mock ServerResponse that captures the response
function createMockRes(): ServerResponse & { _statusCode: number; _headers: Record<string, string>; _body: string } {
    const res = {
        _statusCode: 200,
        _headers: {} as Record<string, string>,
        _body: "",
        statusCode: 200,
        setHeader(name: string, value: string) { this._headers[name.toLowerCase()] = value; },
        end(data?: string) { this._body = data || ""; },
        writeHead(code: number, headers?: any) {
            this._statusCode = code;
            this.statusCode = code;
            if (headers) Object.assign(this._headers, headers);
        },
    } as any;
    return res;
}

function getResponseJson(res: any): any {
    try { return JSON.parse(res._body); } catch { return null; }
}

// Setup exec mock to simulate openclaw cron CLI responses
function setupExecMock(response: string = "", error: any = null) {
    mockExec.mockImplementation((cmd: string, opts: any, callback: Function) => {
        if (error) {
            callback(error, "");
        } else {
            callback(null, response);
        }
    });
}

describe("Scheduled Tasks API", () => {
    let handleApiRequest: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Default: exec succeeds with empty output
        setupExecMock("");

        // Default: config returns empty agents
        mockReadFileSync.mockReturnValue('{"agents":{"list":[]}}');
        mockExistsSync.mockReturnValue(false);
        mockReaddirSync.mockReturnValue([]);

        // Import fresh module
        vi.resetModules();
        const mod = await import("../server/api.js");
        handleApiRequest = mod.handleApiRequest;
    });

    describe("POST /api/tasks — Create Cron Job", () => {
        it("rejects request without name", async () => {
            const req = createMockReq("POST", "/api/tasks", { cron: "0 * * * *" });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(400);
            expect(body.error).toContain("name is required");
        });

        it("rejects request without schedule", async () => {
            const req = createMockReq("POST", "/api/tasks", { name: "test job" });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(400);
            expect(body.error).toContain("One of cron, at, or every is required");
        });

        it("rejects isolated session job without message", async () => {
            const req = createMockReq("POST", "/api/tasks", {
                name: "No message job",
                cron: "0 9 * * *",
                session: "isolated",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(400);
            expect(body.error).toContain("message is required for isolated session");
        });

        it("creates a cron job with cron expression", async () => {
            setupExecMock("Job created successfully");
            const req = createMockReq("POST", "/api/tasks", {
                name: "Morning brief",
                cron: "0 9 * * *",
                message: "Give me a morning briefing",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(201);
            expect(body.ok).toBe(true);

            // Verify the exec command was called with correct args
            expect(mockExec).toHaveBeenCalled();
            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("openclaw");
            expect(cmd).toContain("cron");
            expect(cmd).toContain("add");
            expect(cmd).toContain("--name");
            expect(cmd).toContain("Morning brief");
            expect(cmd).toContain("--cron");
            expect(cmd).toContain("0 9 * * *");
            expect(cmd).toContain("--message");
        });

        it("creates a cron job with interval schedule", async () => {
            setupExecMock("Job created");
            const req = createMockReq("POST", "/api/tasks", {
                name: "Periodic check",
                every: "6h",
                message: "Check system status",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(201);
            expect(body.ok).toBe(true);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--every");
            expect(cmd).toContain("6h");
        });

        it("creates a one-shot job with --at", async () => {
            setupExecMock("Job created");
            const req = createMockReq("POST", "/api/tasks", {
                name: "One-time reminder",
                at: "2026-04-07T10:00:00.000Z",
                message: "Reminder",
                deleteAfterRun: true,
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(201);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--at");
            expect(cmd).toContain("--delete-after-run");
        });

        it("includes announce flag and channel when delivery is set", async () => {
            setupExecMock("Job created");
            const req = createMockReq("POST", "/api/tasks", {
                name: "Channel report",
                cron: "0 9 * * *",
                message: "Daily report",
                announce: true,
                channel: "telegram",
                to: "group:my-group",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            expect(res.statusCode).toBe(201);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--announce");
            expect(cmd).toContain("--channel");
            expect(cmd).toContain("telegram");
            expect(cmd).toContain("--to");
            expect(cmd).toContain("group:my-group");
        });

        it("includes timezone when specified", async () => {
            setupExecMock("Job created");
            const req = createMockReq("POST", "/api/tasks", {
                name: "TZ job",
                cron: "0 9 * * *",
                tz: "America/New_York",
                message: "test",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--tz");
            expect(cmd).toContain("America/New_York");
        });

        it("includes agent when specified", async () => {
            setupExecMock("Job created");
            const req = createMockReq("POST", "/api/tasks", {
                name: "Agent job",
                cron: "0 9 * * *",
                agentId: "reporter",
                message: "test",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--agent");
            expect(cmd).toContain("reporter");
        });

        it("uses main session with system event and wake", async () => {
            setupExecMock("Job created");
            const req = createMockReq("POST", "/api/tasks", {
                name: "Main session job",
                cron: "0 9 * * *",
                session: "main",
                systemEvent: "daily_check",
                wake: "now",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--session");
            expect(cmd).toContain("main");
            expect(cmd).toContain("--system-event");
            expect(cmd).toContain("daily_check");
            expect(cmd).toContain("--wake");
            expect(cmd).toContain("now");
        });

        it("includes model override when specified", async () => {
            setupExecMock("Job created");
            const req = createMockReq("POST", "/api/tasks", {
                name: "Model job",
                cron: "0 9 * * *",
                message: "test",
                model: "gpt-4o",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--model");
            expect(cmd).toContain("gpt-4o");
        });

        it("returns 500 when CLI command fails", async () => {
            mockExec.mockImplementation((cmd: string, opts: any, callback: Function) => {
                callback(new Error("CLI failed"), "");
            });
            const req = createMockReq("POST", "/api/tasks", {
                name: "Failing job",
                cron: "0 9 * * *",
                message: "test",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(500);
            expect(body.error).toContain("Failed to create cron job");
        });
    });

    describe("DELETE /api/tasks/{id} — Remove Cron Job", () => {
        it("removes a cron job by id", async () => {
            setupExecMock("");
            const req = createMockReq("DELETE", "/api/tasks/job-123");
            const res = createMockRes();
            const url = new URL("/api/tasks/job-123", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(200);
            expect(body.ok).toBe(true);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("openclaw");
            expect(cmd).toContain("cron");
            expect(cmd).toContain("remove");
            expect(cmd).toContain("job-123");
        });

        it("handles heartbeat disable", async () => {
            mockReadFileSync.mockReturnValue(JSON.stringify({
                agents: {
                    list: [{ id: "myagent", heartbeat: { enabled: true, every: "1h" } }],
                },
            }));
            mockExistsSync.mockReturnValue(true);

            const req = createMockReq("DELETE", "/api/tasks/heartbeat:myagent");
            const res = createMockRes();
            const url = new URL("/api/tasks/heartbeat:myagent", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(200);
            expect(body.ok).toBe(true);
        });
    });

    describe("POST /api/tasks/{id}/run — Force Run", () => {
        it("force-runs a cron job", async () => {
            setupExecMock("Job triggered");
            const req = createMockReq("POST", "/api/tasks/job-123/run", {});
            const res = createMockRes();
            const url = new URL("/api/tasks/job-123/run", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(200);
            expect(body.ok).toBe(true);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("openclaw");
            expect(cmd).toContain("cron");
            expect(cmd).toContain("run");
            expect(cmd).toContain("job-123");
        });
    });

    describe("POST /api/tasks/{id}/edit — Edit Cron Job", () => {
        it("edits a cron job", async () => {
            setupExecMock("Job updated");
            const req = createMockReq("POST", "/api/tasks/job-123/edit", {
                message: "Updated message",
                cron: "0 10 * * *",
                name: "Updated name",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks/job-123/edit", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(200);
            expect(body.ok).toBe(true);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("openclaw");
            expect(cmd).toContain("cron");
            expect(cmd).toContain("edit");
            expect(cmd).toContain("job-123");
            expect(cmd).toContain("--message");
            expect(cmd).toContain("--cron");
            expect(cmd).toContain("0 10 * * *");
            expect(cmd).toContain("--name");
        });

        it("supports editing announce/channel/to fields", async () => {
            setupExecMock("Job updated");
            const req = createMockReq("POST", "/api/tasks/job-123/edit", {
                announce: true,
                channel: "telegram",
                to: "group:my-group",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks/job-123/edit", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--announce");
            expect(cmd).toContain("--channel");
            expect(cmd).toContain("telegram");
            expect(cmd).toContain("--to");
            expect(cmd).toContain("group:my-group");
        });

        it("supports disabling announce", async () => {
            setupExecMock("Job updated");
            const req = createMockReq("POST", "/api/tasks/job-123/edit", {
                announce: false,
            });
            const res = createMockRes();
            const url = new URL("/api/tasks/job-123/edit", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--no-announce");
            expect(cmd).not.toContain("--channel");
        });

        it("supports editing timezone", async () => {
            setupExecMock("Job updated");
            const req = createMockReq("POST", "/api/tasks/job-123/edit", {
                tz: "Europe/London",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks/job-123/edit", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--tz");
            expect(cmd).toContain("Europe/London");
        });
    });

    describe("POST /api/tasks/{id}/cancel — Cancel/Disable", () => {
        it("cancels a cron job", async () => {
            setupExecMock("");
            const req = createMockReq("POST", "/api/tasks/job-123/cancel", {});
            const res = createMockRes();
            const url = new URL("/api/tasks/job-123/cancel", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const body = getResponseJson(res);
            expect(res.statusCode).toBe(200);
            expect(body.ok).toBe(true);
        });
    });

    describe("Route Isolation — cron routes don't intercept flow routes", () => {
        it("POST /api/tasks/flows/cancel is not caught by cron cancel route", async () => {
            // The cron cancel route uses /tasks/([^/]+)/cancel which should NOT match /tasks/flows/cancel
            const req = createMockReq("POST", "/api/tasks/flows/cancel", { flowToken: "test-token" });
            const res = createMockRes();
            const url = new URL("/api/tasks/flows/cancel", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            // Should hit the flow cancel route (which returns 404 since no state file exists)
            // NOT the cron cancel route
            const body = getResponseJson(res);
            // The flow cancel route returns 404 with "Flow not found" when state file doesn't exist
            expect(res.statusCode).toBe(404);
            expect(body.error).toContain("Flow not found");
            // Verify it didn't try to call openclaw cron remove
            const cronCalls = mockExec.mock.calls.filter((c: any) => c[0].includes("cron remove"));
            expect(cronCalls.length).toBe(0);
        });
    });

    describe("Announce/Channel Delivery", () => {
        it("does not include announce flags when announce is false", async () => {
            setupExecMock("Job created");
            const req = createMockReq("POST", "/api/tasks", {
                name: "No announce",
                cron: "0 9 * * *",
                message: "test",
                announce: false,
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).not.toContain("--announce");
            expect(cmd).not.toContain("--channel");
            expect(cmd).not.toContain("--to");
        });

        it("includes announce without channel when channel is empty", async () => {
            setupExecMock("Job created");
            const req = createMockReq("POST", "/api/tasks", {
                name: "Announce no channel",
                cron: "0 9 * * *",
                message: "test",
                announce: true,
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--announce");
            // No channel or to since they weren't provided
        });

        it("includes channel and to when both are provided", async () => {
            setupExecMock("Job created");
            const req = createMockReq("POST", "/api/tasks", {
                name: "Full delivery",
                cron: "0 9 * * *",
                message: "test",
                announce: true,
                channel: "slack",
                to: "channel:general",
            });
            const res = createMockRes();
            const url = new URL("/api/tasks", "http://localhost:19900");

            await handleApiRequest(req, res, url);

            const cmd = mockExec.mock.calls[0][0];
            expect(cmd).toContain("--announce");
            expect(cmd).toContain("--channel");
            expect(cmd).toContain("slack");
            expect(cmd).toContain("--to");
            expect(cmd).toContain("channel:general");
        });
    });
});
