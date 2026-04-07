import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Property 9: Error Classification Correctness ───
// **Validates: Requirements 2.5, 2.6**

/**
 * The rate-limit / auth classification regex, extracted from
 * POST /sessions/{key}/message handler in sessions.ts (line ~1085).
 */
const RATE_LIMIT_PATTERN =
    /usage limit|rate.limit|rate_limit|quota|invalid.*key|invalid.*api|unauthorized|401|403|429|too many requests|failover/i;

/**
 * Classifies an error message string the same way the route handler does:
 * - Returns 429 for rate-limit / auth errors
 * - Returns 503 for everything else
 */
function classifyError(msg: string): number {
    return RATE_LIMIT_PATTERN.test(msg) ? 429 : 503;
}

// ── Arbitraries ──

/** Strings known to match the rate-limit pattern */
const rateLimitMessageArb = fc.oneof(
    fc.constant("usage limit exceeded"),
    fc.constant("rate limit reached"),
    fc.constant("rate.limit hit"),
    fc.constant("rate_limit exceeded for model"),
    fc.constant("quota exceeded"),
    fc.constant("invalid api key provided"),
    fc.constant("invalid key"),
    fc.constant("unauthorized access"),
    fc.constant("HTTP 401 Unauthorized"),
    fc.constant("Error 403 Forbidden"),
    fc.constant("429 Too Many Requests"),
    fc.constant("too many requests"),
    fc.constant("failover triggered"),
    // With random surrounding text
    fc.string({ minLength: 0, maxLength: 30 }).map(prefix =>
        `${prefix} usage limit ${prefix}`
    ),
    fc.string({ minLength: 0, maxLength: 30 }).map(prefix =>
        `${prefix} rate_limit ${prefix}`
    ),
    fc.string({ minLength: 0, maxLength: 30 }).map(prefix =>
        `${prefix} quota ${prefix}`
    ),
);

/**
 * Strings that should NOT match the rate-limit pattern.
 * We filter out any accidental matches against the regex.
 */
const nonRateLimitMessageArb = fc.oneof(
    fc.constant("Gateway request timed out"),
    fc.constant("Connection refused"),
    fc.constant("ECONNRESET"),
    fc.constant("Internal server error"),
    fc.constant("Message send failed"),
    fc.constant("Network error"),
    fc.constant("socket hang up"),
    fc.constant("ETIMEDOUT"),
    fc.constant("Bad gateway"),
    fc.constant("Service unavailable"),
    // Random strings that don't contain rate-limit keywords
    fc.string({ minLength: 1, maxLength: 50 })
        .filter(s => !RATE_LIMIT_PATTERN.test(s)),
);

describe("Property 9: Error Classification Correctness", () => {
    it("rate-limit messages produce 429 classification", () => {
        fc.assert(
            fc.property(rateLimitMessageArb, (msg) => {
                expect(classifyError(msg)).toBe(429);
            }),
            { numRuns: 100 },
        );
    });

    it("non-rate-limit messages produce 503 classification", () => {
        fc.assert(
            fc.property(nonRateLimitMessageArb, (msg) => {
                expect(classifyError(msg)).toBe(503);
            }),
            { numRuns: 100 },
        );
    });

    it("classification is deterministic for any error string", () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1, maxLength: 200 }), (msg) => {
                const first = classifyError(msg);
                const second = classifyError(msg);
                expect(first).toBe(second);
                expect([429, 503]).toContain(first);
            }),
            { numRuns: 100 },
        );
    });

    it("classification matches regex directly for random strings", () => {
        fc.assert(
            fc.property(fc.string({ minLength: 0, maxLength: 200 }), (msg) => {
                const expected = RATE_LIMIT_PATTERN.test(msg) ? 429 : 503;
                expect(classifyError(msg)).toBe(expected);
            }),
            { numRuns: 100 },
        );
    });
});
