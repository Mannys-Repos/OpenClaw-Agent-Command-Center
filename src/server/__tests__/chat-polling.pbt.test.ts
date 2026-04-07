import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Property 1: Monotonic Message Count Guard ───
// **Validates: Requirements 3.3**

/**
 * Pure function extracted from `_refreshChatMessages` in dashboard.js.txt.
 *
 * The monotonic guard logic:
 *   if (newCount <= _chatLastMsgCount && _chatLastMsgCount > 0) return; // skip
 *   // otherwise re-render
 *
 * Returns true when a re-render should happen, false when it should be skipped.
 */
function shouldReRender(chatLastMsgCount: number, fetchedCount: number): boolean {
    if (fetchedCount <= chatLastMsgCount && chatLastMsgCount > 0) return false;
    return true;
}

describe("Property 1: Monotonic Message Count Guard", () => {
    it("re-renders iff fetchedCount > chatLastMsgCount OR chatLastMsgCount === 0", () => {
        fc.assert(
            fc.property(
                fc.nat({ max: 10000 }),
                fc.nat({ max: 10000 }),
                (chatLastMsgCount: number, fetchedCount: number) => {
                    const result = shouldReRender(chatLastMsgCount, fetchedCount);
                    const expected =
                        fetchedCount > chatLastMsgCount || chatLastMsgCount === 0;

                    expect(result).toBe(expected);
                },
            ),
            { numRuns: 100 },
        );
    });

    it("always re-renders when chatLastMsgCount is 0 (initial state)", () => {
        fc.assert(
            fc.property(fc.nat({ max: 10000 }), (fetchedCount: number) => {
                expect(shouldReRender(0, fetchedCount)).toBe(true);
            }),
            { numRuns: 100 },
        );
    });

    it("never re-renders when fetchedCount is 0 and chatLastMsgCount > 0", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10000 }),
                (chatLastMsgCount: number) => {
                    expect(shouldReRender(chatLastMsgCount, 0)).toBe(false);
                },
            ),
            { numRuns: 100 },
        );
    });

    it("never re-renders when fetchedCount equals chatLastMsgCount and chatLastMsgCount > 0", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10000 }),
                (count: number) => {
                    expect(shouldReRender(count, count)).toBe(false);
                },
            ),
            { numRuns: 100 },
        );
    });

    it("always re-renders when fetchedCount is strictly greater than chatLastMsgCount", () => {
        fc.assert(
            fc.property(
                fc.nat({ max: 9999 }),
                fc.integer({ min: 1, max: 10000 }),
                (chatLastMsgCount: number, delta: number) => {
                    const fetchedCount = chatLastMsgCount + delta;
                    expect(shouldReRender(chatLastMsgCount, fetchedCount)).toBe(
                        true,
                    );
                },
            ),
            { numRuns: 100 },
        );
    });
});
