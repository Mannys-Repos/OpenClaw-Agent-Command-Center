/**
 * Bug Condition Exploration Test — Chat View Overwritten With Fewer Messages
 *
 * **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6**
 *
 * CRITICAL: This test encodes the EXPECTED (correct) behavior.
 * On UNFIXED code, these tests MUST FAIL — failure confirms the bugs exist.
 * After the fix is applied, these tests MUST PASS — confirming the bugs are resolved.
 *
 * Property 1: Bug Condition — Chat View Overwritten With Fewer Messages
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Source code loader ───
const DASHBOARD_JS_PATH = join(
    __dirname,
    "..",
    "..",
    "assets",
    "dashboard.js.txt",
);

function loadDashboardJs(): string {
    return readFileSync(DASHBOARD_JS_PATH, "utf-8");
}

// ─── Helper: Extract function body ───
function extractFunctionBody(src: string, startIdx: number): string {
    let braceCount = 0;
    let started = false;
    let bodyStart = startIdx;

    for (let i = startIdx; i < src.length && i < startIdx + 15000; i++) {
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
    return src.substring(startIdx, startIdx + 8000);
}

// ─── Arbitraries ───

/** Generate a positive message count representing _chatLastMsgCount > 0 */
const arbPositiveMsgCount = fc.integer({ min: 1, max: 100 });

/** Generate a message count that is strictly less than a given count (including 0) */
function arbFewerMessages(currentCount: number) {
    return fc.integer({ min: 0, max: Math.max(0, currentCount - 1) });
}

/** Generate a valid session key */
const arbSessionKey = fc.stringMatching(/^[a-z0-9_:-]{3,40}$/);

describe("Property 1: Bug Condition — Chat View Overwritten With Fewer Messages", () => {
    /**
     * Property 1: _refreshChatMessages SHALL skip re-render when
     * newCount <= _chatLastMsgCount && _chatLastMsgCount > 0
     *
     * The UNFIXED code uses: if(_chatLastMsgCount===newCount&&newCount>0)return;
     * This only skips when counts are EQUAL. It does NOT skip when newCount < _chatLastMsgCount.
     *
     * The FIXED code should use: if(newCount<=_chatLastMsgCount&&_chatLastMsgCount>0)return;
     *
     * We test this by checking the guard condition in the source code.
     *
     * **Validates: Requirements 1.1, 1.2, 1.5**
     */
    describe("_refreshChatMessages count guard rejects fewer messages", () => {
        it("guard should use <= (not ===) to prevent overwriting with fewer messages", () => {
            fc.assert(
                fc.property(
                    arbPositiveMsgCount,
                    (currentCount) => {
                        const src = loadDashboardJs();

                        const fnStart = src.indexOf(
                            "function _refreshChatMessages(",
                        );
                        expect(fnStart).toBeGreaterThan(-1);

                        const fnBody = extractFunctionBody(src, fnStart);

                        // The guard line in the function
                        // UNFIXED: if(_chatLastMsgCount===newCount&&newCount>0)return;
                        // FIXED:   if(newCount<=_chatLastMsgCount&&_chatLastMsgCount>0)return;

                        const hasEqualityOnlyGuard =
                            fnBody.includes(
                                "_chatLastMsgCount===newCount&&newCount>0",
                            ) ||
                            fnBody.includes(
                                "_chatLastMsgCount===newCount && newCount>0",
                            );

                        const hasLessOrEqualGuard =
                            fnBody.includes(
                                "newCount<=_chatLastMsgCount&&_chatLastMsgCount>0",
                            ) ||
                            fnBody.includes(
                                "newCount <= _chatLastMsgCount && _chatLastMsgCount > 0",
                            ) ||
                            fnBody.includes(
                                "newCount<=_chatLastMsgCount&&_chatLastMsgCount>0",
                            );

                        // EXPECTED: The guard should use <= to reject fewer messages
                        // On UNFIXED code, hasEqualityOnlyGuard is true and hasLessOrEqualGuard is false
                        // This assertion will FAIL on unfixed code (confirming the bug)
                        expect(hasLessOrEqualGuard).toBe(true);
                        expect(hasEqualityOnlyGuard).toBe(false);
                    },
                ),
                { numRuns: 5 },
            );
        });

        it("simulated guard: equality-only guard allows overwrite with fewer messages", () => {
            fc.assert(
                fc.property(
                    arbPositiveMsgCount,
                    fc.integer({ min: 0, max: 99 }),
                    (chatLastMsgCount, rawNewCount) => {
                        // Ensure newCount < chatLastMsgCount (the bug condition)
                        const newCount = rawNewCount % chatLastMsgCount;

                        // Simulate the UNFIXED guard logic
                        const unfixedSkips =
                            chatLastMsgCount === newCount && newCount > 0;

                        // Simulate the FIXED guard logic
                        const fixedSkips =
                            newCount <= chatLastMsgCount &&
                            chatLastMsgCount > 0;

                        // When newCount < chatLastMsgCount:
                        // - UNFIXED guard does NOT skip (unfixedSkips = false) → re-renders with fewer messages (BUG)
                        // - FIXED guard DOES skip (fixedSkips = true) → retains current view (CORRECT)

                        // EXPECTED: The guard should skip re-render when newCount < chatLastMsgCount
                        // This assertion checks the ACTUAL code behavior by reading the source
                        const src = loadDashboardJs();
                        const fnStart = src.indexOf(
                            "function _refreshChatMessages(",
                        );
                        const fnBody = extractFunctionBody(src, fnStart);

                        const usesFixedGuard =
                            fnBody.includes("newCount<=_chatLastMsgCount") ||
                            fnBody.includes("newCount <= _chatLastMsgCount");

                        // On UNFIXED code: usesFixedGuard is false → this FAILS (confirming bug)
                        expect(usesFixedGuard).toBe(true);
                    },
                ),
                { numRuns: 10 },
            );
        });
    });

    /**
     * Property 2: sendMsg SHALL set _chatLastMsgCount >= 2 after rendering response
     *
     * The UNFIXED code has _chatLastMsgCount=0 on line ~2843 AFTER the redirect block,
     * which clobbers the count set by the redirect fetch. This means the rapid poll
     * starts with _chatLastMsgCount=0 and can overwrite the chat with empty data.
     *
     * The FIXED code should:
     * - Remove the unconditional _chatLastMsgCount=0 after the redirect block
     * - Set _chatLastMsgCount = Math.max(_chatLastMsgCount, 2) after rendering response
     *
     * **Validates: Requirements 1.1, 1.6**
     */
    describe("sendMsg does not clobber _chatLastMsgCount after redirect", () => {
        it("sendMsg should NOT have unconditional _chatLastMsgCount=0 after redirect block", () => {
            fc.assert(
                fc.property(arbSessionKey, (_key) => {
                    const src = loadDashboardJs();

                    const fnStart = src.indexOf("function sendMsg(");
                    expect(fnStart).toBeGreaterThan(-1);

                    const fnBody = extractFunctionBody(src, fnStart);

                    // Find the redirect block
                    const redirectBlockStart = fnBody.indexOf(
                        "primarySessionKey!==key",
                    );
                    expect(redirectBlockStart).toBeGreaterThan(-1);

                    // After the redirect block, look for the unconditional reset
                    // The comment "Reset message count so rapid poll picks up new messages"
                    // followed by _chatLastMsgCount=0 is the bug
                    const afterRedirect = fnBody.substring(redirectBlockStart);

                    // Find the rapid poll setup section (after the redirect block closes)
                    const rapidPollComment = afterRedirect.indexOf(
                        "Reset message count",
                    );

                    if (rapidPollComment > -1) {
                        // The unconditional reset exists — this is the bug
                        const resetSection = afterRedirect.substring(
                            rapidPollComment,
                            rapidPollComment + 100,
                        );
                        const hasUnconditionalReset =
                            resetSection.includes("_chatLastMsgCount=0");

                        // EXPECTED: No unconditional reset after redirect block
                        // On UNFIXED code: hasUnconditionalReset is true → this FAILS
                        expect(hasUnconditionalReset).toBe(false);
                    }
                }),
                { numRuns: 5 },
            );
        });

        it("sendMsg should set _chatLastMsgCount floor of 2 after rendering response", () => {
            fc.assert(
                fc.property(arbSessionKey, (_key) => {
                    const src = loadDashboardJs();

                    const fnStart = src.indexOf("function sendMsg(");
                    expect(fnStart).toBeGreaterThan(-1);

                    const fnBody = extractFunctionBody(src, fnStart);

                    // After the agent response is rendered (the "Thinking…" bubble is replaced),
                    // there should be a floor set: _chatLastMsgCount = Math.max(_chatLastMsgCount, 2)
                    const hasFloor =
                        fnBody.includes(
                            "Math.max(_chatLastMsgCount, 2)",
                        ) ||
                        fnBody.includes(
                            "Math.max(_chatLastMsgCount,2)",
                        );

                    // EXPECTED: Floor should be set after rendering response
                    // On UNFIXED code: hasFloor is false → this FAILS
                    expect(hasFloor).toBe(true);
                }),
                { numRuns: 5 },
            );
        });
    });

    /**
     * Property 3: _openChatModal SHALL use _chatSessionKey dynamically
     *
     * The UNFIXED code hardcodes the key parameter in sendMsg calls:
     *   sendMsg('${esc(key)}')
     *
     * The FIXED code should use _chatSessionKey dynamically:
     *   sendMsg(_chatSessionKey)
     *
     * **Validates: Requirements 1.4**
     */
    describe("_openChatModal uses dynamic session key", () => {
        it("_openChatModal input handlers should use _chatSessionKey, not hardcoded key", () => {
            fc.assert(
                fc.property(arbSessionKey, (_key) => {
                    const src = loadDashboardJs();

                    const fnStart = src.indexOf(
                        "function _openChatModal(",
                    );
                    expect(fnStart).toBeGreaterThan(-1);

                    const fnBody = extractFunctionBody(src, fnStart);

                    // Bug condition: input handlers hardcode the key
                    // UNFIXED: sendMsg(''+esc(key)+'') or sendMsg(\'+esc(key)+\')
                    const hasHardcodedKey =
                        fnBody.includes("sendMsg(\\''+esc(key)+'\\')") ||
                        fnBody.includes("sendMsg(''+esc(key)+'')") ||
                        (fnBody.includes("sendMsg(") &&
                            fnBody.includes("esc(key)") &&
                            !fnBody.includes("sendMsg(_chatSessionKey)"));

                    // EXPECTED: Should use _chatSessionKey dynamically
                    const usesDynamicKey = fnBody.includes(
                        "sendMsg(_chatSessionKey)",
                    );

                    // On UNFIXED code: hasHardcodedKey is true, usesDynamicKey is false → FAILS
                    expect(usesDynamicKey).toBe(true);
                    expect(hasHardcodedKey).toBe(false);
                }),
                { numRuns: 5 },
            );
        });
    });
});
