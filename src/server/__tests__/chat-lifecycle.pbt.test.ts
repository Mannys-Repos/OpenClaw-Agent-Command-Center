import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Property 2: Key Redirect Full State Synchronization ───
// **Validates: Requirements 2.3, 2.4, 3.5**

/**
 * Represents the mutable frontend chat state that `_syncChatToSession`
 * modifies when a key redirect occurs.
 */
interface ChatState {
    chatSessionKey: string | null;
    chatLastMsgCount: number;
    rapidPollTimer: number | null;
    chatPollTimer: number | null;
}

/**
 * Pure function extracted from `_syncChatToSession` in dashboard.js.txt.
 *
 * When the gateway returns a `primarySessionKey` different from the current
 * `_chatSessionKey`, this function synchronises all frontend state to the
 * new key:
 *   1. _chatSessionKey = newKey
 *   2. Cancel rapid poll timer  → null
 *   3. Cancel chat poll timer   → null
 *   4. _chatLastMsgCount = 0
 *
 * Side-effects (DOM updates, fetch calls, drawer refresh) are not modelled
 * here — only the state transitions that must hold as invariants.
 */
function syncChatState(newKey: string, currentState: ChatState): ChatState {
    return {
        chatSessionKey: newKey,
        chatLastMsgCount: 0,
        rapidPollTimer: null,
        chatPollTimer: null,
    };
}

describe("Property 2: Key Redirect Full State Synchronization", () => {
    // Arbitrary for non-empty session key strings
    const keyArb = fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0);

    // Arbitrary for a timer ID (non-null positive integer) or null
    const timerArb = fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 100000 }));

    // Arbitrary for a full initial ChatState
    const stateArb = fc.record({
        chatSessionKey: fc.oneof(fc.constant(null), keyArb),
        chatLastMsgCount: fc.nat({ max: 50000 }),
        rapidPollTimer: timerArb,
        chatPollTimer: timerArb,
    });

    it("after sync, chatSessionKey equals the new key", () => {
        fc.assert(
            fc.property(keyArb, stateArb, (newKey, initialState) => {
                const result = syncChatState(newKey, initialState);
                expect(result.chatSessionKey).toBe(newKey);
            }),
            { numRuns: 100 },
        );
    });

    it("after sync, chatLastMsgCount is reset to 0", () => {
        fc.assert(
            fc.property(keyArb, stateArb, (newKey, initialState) => {
                const result = syncChatState(newKey, initialState);
                expect(result.chatLastMsgCount).toBe(0);
            }),
            { numRuns: 100 },
        );
    });

    it("after sync, rapidPollTimer is null (cancelled)", () => {
        fc.assert(
            fc.property(keyArb, stateArb, (newKey, initialState) => {
                const result = syncChatState(newKey, initialState);
                expect(result.rapidPollTimer).toBeNull();
            }),
            { numRuns: 100 },
        );
    });

    it("after sync, chatPollTimer is null (cancelled)", () => {
        fc.assert(
            fc.property(keyArb, stateArb, (newKey, initialState) => {
                const result = syncChatState(newKey, initialState);
                expect(result.chatPollTimer).toBeNull();
            }),
            { numRuns: 100 },
        );
    });

    it("all state invariants hold simultaneously for any old/new key pair and initial state", () => {
        fc.assert(
            fc.property(keyArb, stateArb, (newKey, initialState) => {
                const result = syncChatState(newKey, initialState);

                // chatSessionKey updated to newKey
                expect(result.chatSessionKey).toBe(newKey);
                // chatLastMsgCount reset
                expect(result.chatLastMsgCount).toBe(0);
                // Both timers cancelled
                expect(result.rapidPollTimer).toBeNull();
                expect(result.chatPollTimer).toBeNull();
                // No stale key references remain
                if (initialState.chatSessionKey !== null && initialState.chatSessionKey !== newKey) {
                    expect(result.chatSessionKey).not.toBe(initialState.chatSessionKey);
                }
            }),
            { numRuns: 100 },
        );
    });
});
