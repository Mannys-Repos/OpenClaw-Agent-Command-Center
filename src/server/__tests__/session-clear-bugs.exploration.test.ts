/**
 * Bug Condition Exploration Test — Session Reset Race & Stale Key References
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**
 *
 * CRITICAL: This test encodes the EXPECTED (correct) behavior.
 * On UNFIXED code, these tests MUST FAIL — failure confirms the bugs exist.
 * After the fix is applied, these tests MUST PASS — confirming the bugs are resolved.
 *
 * Property 1: Bug Condition - Session Reset Race & Stale Key References
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Source code loaders ───
const DASHBOARD_JS_PATH = join(__dirname, "..", "..", "assets", "dashboard.js.txt");
const SESSIONS_TS_PATH = join(__dirname, "..", "routes", "sessions.ts");

function loadDashboardJs(): string {
    return readFileSync(DASHBOARD_JS_PATH, "utf-8");
}

function loadSessionsTs(): string {
    return readFileSync(SESSIONS_TS_PATH, "utf-8");
}

// ─── Arbitraries ───

/** Generate a valid agent ID */
const arbAgentId = fc.stringMatching(/^[a-z0-9_-]{1,20}$/);

/** Generate a valid session key */
const arbSessionKey = fc.stringMatching(/^[a-z0-9_:-]{3,40}$/);

/** Generate a key redirect scenario: oldKey !== newKey */
const arbKeyRedirect = fc.tuple(arbSessionKey, arbSessionKey).filter(
    ([oldKey, newKey]) => oldKey !== newKey,
);

// ─── Bug Condition Checks (static code analysis) ───

describe("Property 1: Bug Condition — Session Reset Race & Stale Key References", () => {
    /**
     * (A) clearMainSession sends a seed message via POST /sessions/{key}/message
     * and then calls POST /sessions/{key}/clear — this is the race condition.
     *
     * Expected behavior: clearMainSession should ONLY call DELETE — no seed message, no /clear.
     *
     * **Validates: Requirements 1.1, 1.2, 1.5**
     */
    describe("clearMainSession race condition", () => {
        it("clearMainSession should NOT send a seed message POST (no 'Session reset. Ready.')", () => {
            fc.assert(
                fc.property(arbAgentId, (_agentId) => {
                    const src = loadDashboardJs();

                    // Extract the clearMainSession function body
                    const fnStart = src.indexOf("function clearMainSession(");
                    expect(fnStart).toBeGreaterThan(-1);

                    // Find the function body — scan forward to find the matching scope
                    const fnBody = extractFunctionBody(src, fnStart);

                    // Bug condition: clearMainSession sends a seed message
                    // The unfixed code contains: api("sessions/...message",...{message:"Session reset. Ready."})
                    const sendsSeedMessage =
                        fnBody.includes("Session reset. Ready.") ||
                        fnBody.includes("/message");

                    // EXPECTED: No seed message sent — only DELETE
                    expect(sendsSeedMessage).toBe(false);
                }),
                { numRuns: 5 },
            );
        });

        it("clearMainSession should NOT call POST /clear after seed", () => {
            fc.assert(
                fc.property(arbAgentId, (_agentId) => {
                    const src = loadDashboardJs();

                    const fnStart = src.indexOf("function clearMainSession(");
                    expect(fnStart).toBeGreaterThan(-1);

                    const fnBody = extractFunctionBody(src, fnStart);

                    // Bug condition: clearMainSession calls /clear to truncate
                    const callsClear = fnBody.includes("/clear");

                    // EXPECTED: No /clear call — DELETE is sufficient
                    expect(callsClear).toBe(false);
                }),
                { numRuns: 5 },
            );
        });

        it("clearMainSession should only use DELETE method (no POST for seed or clear)", () => {
            fc.assert(
                fc.property(arbAgentId, (_agentId) => {
                    const src = loadDashboardJs();

                    const fnStart = src.indexOf("function clearMainSession(");
                    expect(fnStart).toBeGreaterThan(-1);

                    const fnBody = extractFunctionBody(src, fnStart);

                    // Count API calls — should only have DELETE and GET (for refresh)
                    // The unfixed code has: DELETE, then POST /message, then POST /clear
                    const postCalls = (fnBody.match(/method:\s*["']POST["']/g) || []).length;

                    // EXPECTED: Zero POST calls in clearMainSession
                    expect(postCalls).toBe(0);
                }),
                { numRuns: 5 },
            );
        });
    });

    /**
     * (B) _openChatFullscreen hardcodes the session key in HTML event handlers.
     * After a key redirect, the input field still references the old key.
     *
     * Expected behavior: Input handlers should reference _chatSessionKey dynamically.
     *
     * **Validates: Requirements 1.3**
     */
    describe("Input field stale key references", () => {
        it("_openChatFullscreen input handlers should use _chatSessionKey dynamically, not hardcoded key", () => {
            fc.assert(
                fc.property(arbKeyRedirect, ([oldKey, _newKey]) => {
                    const src = loadDashboardJs();

                    const fnStart = src.indexOf("function _openChatFullscreen(");
                    expect(fnStart).toBeGreaterThan(-1);

                    const fnBody = extractFunctionBody(src, fnStart);

                    // Bug condition: input field has hardcoded key in sendMsg call
                    // The unfixed code has: sendMsg('${esc(key)}') baked into HTML
                    const hasHardcodedSendMsg =
                        fnBody.includes("sendMsg(\\''+esc(key)+'\\')") ||
                        fnBody.includes("sendMsg(''+esc(key)+'')") ||
                        fnBody.includes("sendMsg(\\'" + "'+esc(key)+'") ||
                        // Check for the pattern where key is interpolated into the string
                        (fnBody.includes("sendMsg(") && fnBody.includes("esc(key)"));

                    // EXPECTED: Input handlers should use _chatSessionKey, not hardcoded key
                    // The fixed code should have: sendMsg(_chatSessionKey)
                    const usesDynamicKey =
                        fnBody.includes("sendMsg(_chatSessionKey)");

                    // Either there should be no hardcoded key, or it should use dynamic key
                    expect(usesDynamicKey || !hasHardcodedSendMsg).toBe(true);
                }),
                { numRuns: 10 },
            );
        });
    });

    /**
     * (B) sendMsg does not cancel the rapid poll timer when a key redirect occurs.
     * The timer continues calling _refreshChatMessages with the old key.
     *
     * Expected behavior: On key redirect, cancel existing _rapidPollTimer before starting new one.
     *
     * **Validates: Requirements 1.4**
     */
    describe("Rapid poll timer stale key after redirect", () => {
        it("sendMsg should cancel _rapidPollTimer in the key redirect block", () => {
            fc.assert(
                fc.property(arbKeyRedirect, ([_oldKey, _newKey]) => {
                    const src = loadDashboardJs();

                    const fnStart = src.indexOf("function sendMsg(");
                    expect(fnStart).toBeGreaterThan(-1);

                    const fnBody = extractFunctionBody(src, fnStart);

                    // Find the key redirect block: if(d&&d.primarySessionKey&&d.primarySessionKey!==key)
                    const redirectBlockStart = fnBody.indexOf("primarySessionKey!==key");
                    expect(redirectBlockStart).toBeGreaterThan(-1);

                    // The redirect block ends roughly where the next major section starts
                    // Look for timer cancellation WITHIN the redirect block
                    // (before _startRapidPoll at the bottom)
                    const redirectBlockEnd = fnBody.indexOf("_startRapidPoll", redirectBlockStart + 50);
                    const redirectBlock = fnBody.substring(
                        redirectBlockStart,
                        redirectBlockEnd > redirectBlockStart ? redirectBlockEnd : undefined,
                    );

                    // Bug condition: redirect block does NOT cancel the rapid poll timer
                    // _syncChatToSession internally calls _cancelAllPollTimers(), so it counts
                    const cancelsTimerInRedirect =
                        redirectBlock.includes("clearInterval(_rapidPollTimer)") ||
                        redirectBlock.includes("clearInterval( _rapidPollTimer)") ||
                        redirectBlock.includes("_cancelAllPollTimers()") ||
                        redirectBlock.includes("_cancelAllPollTimers(") ||
                        redirectBlock.includes("_syncChatToSession(");

                    // EXPECTED: Timer should be cancelled in the redirect block
                    expect(cancelsTimerInRedirect).toBe(true);
                }),
                { numRuns: 10 },
            );
        });
    });

    /**
     * _refreshChatMessages discards messages when key !== _chatSessionKey
     * but does NOT stop the poll timer that called it.
     *
     * Expected behavior: On key mismatch, also clear _rapidPollTimer.
     *
     * **Validates: Requirements 1.4**
     */
    describe("_refreshChatMessages stale poll self-termination", () => {
        it("_refreshChatMessages should clear _rapidPollTimer on key mismatch", () => {
            fc.assert(
                fc.property(arbKeyRedirect, ([_oldKey, _newKey]) => {
                    const src = loadDashboardJs();

                    const fnStart = src.indexOf("function _refreshChatMessages(");
                    expect(fnStart).toBeGreaterThan(-1);

                    const fnBody = extractFunctionBody(src, fnStart);

                    // Find the stale key guard: if(_chatSessionKey!==key)return
                    const guardIdx = fnBody.indexOf("_chatSessionKey!==key");
                    expect(guardIdx).toBeGreaterThan(-1);

                    // Check if the guard also clears the rapid poll timer
                    // Look at the code around the guard (within ~200 chars)
                    const guardContext = fnBody.substring(
                        Math.max(0, guardIdx - 20),
                        guardIdx + 200,
                    );

                    const clearsTimerOnMismatch =
                        guardContext.includes("clearInterval(_rapidPollTimer)") ||
                        guardContext.includes("clearInterval( _rapidPollTimer)") ||
                        guardContext.includes("_cancelAllPollTimers()") ||
                        guardContext.includes("_cancelAllPollTimers(");

                    // EXPECTED: Timer should be cleared when key mismatch is detected
                    expect(clearsTimerOnMismatch).toBe(true);
                }),
                { numRuns: 10 },
            );
        });
    });

    /**
     * POST /sessions/{key}/message uses exec("openclaw agent --message ...")
     * instead of callGatewayChat().
     *
     * Expected behavior: Should use callGatewayChat, not CLI exec.
     *
     * **Validates: Requirements 1.6**
     */
    describe("Backend CLI message handler", () => {
        it("POST /sessions/{key}/message should use callGatewayChat, not exec CLI", () => {
            fc.assert(
                fc.property(arbAgentId, (_agentId) => {
                    const src = loadSessionsTs();

                    // Find the POST /sessions/{key}/message handler
                    const handlerMarker = 'action === "message"';
                    const handlerStart = src.indexOf(handlerMarker);
                    expect(handlerStart).toBeGreaterThan(-1);

                    // Extract a reasonable chunk of the handler body
                    const handlerBody = src.substring(handlerStart, handlerStart + 2000);

                    // Bug condition: handler uses exec("openclaw agent --message ...")
                    const usesCliExec =
                        handlerBody.includes('exec(') &&
                        handlerBody.includes("openclaw agent");

                    // Bug condition: handler does NOT use callGatewayChat
                    const usesGatewayChat = handlerBody.includes("callGatewayChat");

                    // EXPECTED: Should use callGatewayChat, not CLI exec
                    expect(usesCliExec).toBe(false);
                    expect(usesGatewayChat).toBe(true);
                }),
                { numRuns: 5 },
            );
        });

        it("POST /sessions/{key}/message should resolve primarySessionKey AFTER gateway call", () => {
            fc.assert(
                fc.property(arbAgentId, (_agentId) => {
                    const src = loadSessionsTs();

                    const handlerMarker = 'action === "message"';
                    const handlerStart = src.indexOf(handlerMarker);
                    expect(handlerStart).toBeGreaterThan(-1);

                    const handlerBody = src.substring(handlerStart, handlerStart + 2000);

                    // Bug condition: primarySessionKey is resolved BEFORE the CLI/gateway call
                    // In unfixed code, the for loop over sessionIndex happens before exec()
                    const pkLookupIdx = handlerBody.indexOf("primarySessionKey = entry.sessionKey");
                    const execIdx = handlerBody.indexOf("exec(");
                    const gatewayIdx = handlerBody.indexOf("callGatewayChat");

                    // The call point (whichever is used)
                    const callIdx = gatewayIdx > -1 ? gatewayIdx : execIdx;

                    if (pkLookupIdx > -1 && callIdx > -1) {
                        // EXPECTED: primarySessionKey lookup should happen AFTER the call, not before
                        expect(pkLookupIdx).toBeGreaterThan(callIdx);
                    }
                }),
                { numRuns: 5 },
            );
        });
    });
});

// ─── Helper: Extract function body ───
/**
 * Extracts the body of a function starting from the given index in the source.
 * Handles nested braces to find the complete function body.
 */
function extractFunctionBody(src: string, startIdx: number): string {
    let braceCount = 0;
    let started = false;
    let bodyStart = startIdx;

    for (let i = startIdx; i < src.length && i < startIdx + 10000; i++) {
        if (src[i] === "{") {
            if (!started) {
                started = true;
                bodyStart = i;
            }
            braceCount++;
        } else if (src[i] === "}") {
            braceCount--;
            if (started && braceCount === 0) {
                return src.substring(bodyStart, i + 1);
            }
        }
    }

    // Fallback: return a large chunk if brace matching fails
    return src.substring(startIdx, startIdx + 5000);
}
