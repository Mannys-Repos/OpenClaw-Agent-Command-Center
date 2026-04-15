import { writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
    json,
    parseBody,
    readConfig,
    writeConfig,
    stageConfig,
    readEffectiveConfig,
    readEnv,
    execAsync,
    tryReadFile,
    OPENCLAW_DIR,
    AGENTS_STATE_DIR,
} from "../api-utils.js";
import { invalidateProviderCache } from "./providers.js";

export async function handleAuthProfileRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    _url: URL,
    path: string,
): Promise<boolean> {
    const method = req.method || "GET";

    // ─── DELETE /api/auth/profile — remove an auth profile entry from ALL locations ───
    if (path === "/auth/profile" && method === "DELETE") {
        const body = await parseBody(req);
        const profileKey = body.profileKey;
        if (!profileKey) { json(res, 400, { error: "profileKey required" }); return true; }

        let deleted = false;
        const deletedFrom: string[] = [];

        // Build list of ALL auth-profiles.json files to check
        const authFiles: string[] = [
            join(AGENTS_STATE_DIR, "main", "agent", "auth-profiles.json"),
            join(AGENTS_STATE_DIR, "main", "auth-profiles.json"),
            join(OPENCLAW_DIR, "credentials", "oauth.json"),
        ];
        // Also scan all other agent auth-profiles
        if (existsSync(AGENTS_STATE_DIR)) {
            try {
                for (const agentDir of readdirSync(AGENTS_STATE_DIR)) {
                    const agentAuthFile = join(AGENTS_STATE_DIR, agentDir, "agent", "auth-profiles.json");
                    if (!authFiles.includes(agentAuthFile) && existsSync(agentAuthFile)) {
                        authFiles.push(agentAuthFile);
                    }
                }
            } catch { }
        }

        // Remove from all auth-profiles files
        for (const authFile of authFiles) {
            const authRaw = tryReadFile(authFile);
            if (authRaw === null) continue;
            try {
                const raw = JSON.parse(authRaw);
                const profiles = raw.profiles || raw;
                if (profiles && typeof profiles === "object" && !Array.isArray(profiles) && profiles[profileKey]) {
                    delete profiles[profileKey];
                    if (raw.profiles) {
                        raw.profiles = profiles;
                        writeFileSync(authFile, JSON.stringify(raw, null, 2), "utf-8");
                    } else {
                        writeFileSync(authFile, JSON.stringify(profiles, null, 2), "utf-8");
                    }
                    deleted = true;
                    deletedFrom.push(authFile.replace(OPENCLAW_DIR, "~/.openclaw"));
                }
            } catch { }
        }

        // Also remove from openclaw.json auth.profiles
        try {
            const defer = _url.searchParams?.get("defer") === "1";
            const config = defer ? readEffectiveConfig() : readConfig();
            if (config.auth?.profiles?.[profileKey]) {
                delete config.auth.profiles[profileKey];
                if (defer) {
                    stageConfig(config, "Remove auth profile: " + profileKey);
                } else {
                    writeConfig(config);
                }
                deleted = true;
                deletedFrom.push("openclaw.json (auth.profiles)");
            }
        } catch { }

        // Invalidate the provider cache and rebuild in background
        invalidateProviderCache();

        json(res, 200, { ok: true, deleted, deletedFrom });
        return true;
    }

    // ─── POST /api/auth/refresh — refresh an OAuth token via token endpoint ───
    if (path === "/auth/refresh" && method === "POST") {
        try {
            const body = await parseBody(req);
            const profileKey = body.profileKey || "";
            const provider = body.provider || "";

            // Scan all auth-profiles.json files to find the matching OAuth profile
            const authFiles: string[] = [];
            if (existsSync(AGENTS_STATE_DIR)) {
                try {
                    for (const agentDir of readdirSync(AGENTS_STATE_DIR)) {
                        for (const sub of ["auth-profiles.json", "agent/auth-profiles.json"]) {
                            const f = join(AGENTS_STATE_DIR, agentDir, sub);
                            if (existsSync(f)) authFiles.push(f);
                        }
                    }
                } catch { }
            }
            const oauthJsonPath = join(OPENCLAW_DIR, "credentials", "oauth.json");
            if (existsSync(oauthJsonPath)) authFiles.push(oauthJsonPath);

            // Find the first file that has this profile with a refresh token
            let refreshToken = "";
            let sourceFile = "";
            let profileObj: any = null;

            for (const f of authFiles) {
                const raw = tryReadFile(f);
                if (!raw) continue;
                try {
                    const data = JSON.parse(raw);
                    const profiles = data.profiles || data;
                    const p = profiles[profileKey];
                    if (p && (p.refresh || p.refresh_token)) {
                        refreshToken = p.refresh || p.refresh_token;
                        sourceFile = f;
                        profileObj = p;
                        break;
                    }
                } catch { }
            }

            if (!refreshToken) {
                const provName = provider || profileKey.split(":")[0];
                json(res, 400, {
                    ok: false,
                    result: "No refresh token found for profile \"" + profileKey + "\". Re-authenticate manually on the server:\n\nopenclaw models auth login --provider " + provName,
                });
                return true;
            }

            // Extract client_id from the access token JWT if available
            let clientId = profileObj?.client_id || "";
            if (!clientId && profileObj?.access) {
                try {
                    const parts = profileObj.access.split(".");
                    if (parts.length >= 2) {
                        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
                        if (payload.client_id) clientId = payload.client_id;
                    }
                } catch { }
            }

            // Determine the token endpoint based on provider
            const providerName = provider || profileObj?.provider || profileKey.split(":")[0];
            let tokenUrl = "";
            if (providerName === "openai-codex" || providerName === "openai") {
                tokenUrl = "https://auth.openai.com/oauth/token";
                if (!clientId) clientId = "app_live_cx_sZMRqPKcOe9HMKlRMsYGin5o";
            } else if (providerName === "google") {
                tokenUrl = "https://oauth2.googleapis.com/token";
            } else if (providerName === "anthropic") {
                tokenUrl = "https://auth.anthropic.com/oauth/token";
            }

            if (!tokenUrl) {
                json(res, 400, {
                    ok: false,
                    result: "Unknown OAuth provider \"" + providerName + "\". Cannot determine token endpoint.\n\nRe-authenticate manually: openclaw models auth login --provider " + providerName,
                });
                return true;
            }

            console.log("[agent-dashboard] OAuth refresh: provider=%s profileKey=%s clientId=%s tokenUrl=%s sourceFile=%s", providerName, profileKey, clientId, tokenUrl, sourceFile.replace(OPENCLAW_DIR, "~/.openclaw"));

            // Perform the OAuth2 refresh_token grant
            const params = new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: clientId,
            });
            if (profileObj?.client_secret) {
                params.set("client_secret", profileObj.client_secret);
            }

            const tokenResult = await new Promise<any>((resolve, reject) => {
                const url = new URL(tokenUrl);
                const postData = params.toString();
                const httpReq = httpsRequest({
                    hostname: url.hostname,
                    port: 443,
                    path: url.pathname,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Content-Length": String(Buffer.byteLength(postData)),
                    },
                }, (httpRes) => {
                    let data = "";
                    httpRes.on("data", (chunk: string) => { data += chunk; });
                    httpRes.on("end", () => {
                        try { resolve({ status: httpRes.statusCode, body: JSON.parse(data) }); }
                        catch { resolve({ status: httpRes.statusCode, body: data }); }
                    });
                });
                httpReq.on("error", reject);
                httpReq.setTimeout(25000, () => { httpReq.destroy(new Error("Token refresh request timed out")); });
                httpReq.write(postData);
                httpReq.end();
            });

            console.log("[agent-dashboard] OAuth refresh response: status=%d hasAccessToken=%s error=%s", tokenResult.status, !!tokenResult.body?.access_token, tokenResult.body?.error || "none");

            if (tokenResult.status !== 200 || tokenResult.body.error) {
                const errMsg = tokenResult.body?.error_description || tokenResult.body?.error || JSON.stringify(tokenResult.body);
                json(res, 200, {
                    ok: false,
                    result: "Token refresh failed (" + tokenResult.status + "): " + errMsg + "\n\nRe-authenticate manually: openclaw models auth login --provider " + providerName,
                });
                return true;
            }

            const newTokens = tokenResult.body;
            const newExpiry = newTokens.expires_in
                ? new Date(Date.now() + newTokens.expires_in * 1000).toISOString()
                : undefined;
            const newExpiresMs = newTokens.expires_in
                ? Date.now() + newTokens.expires_in * 1000
                : undefined;

            // Update ALL auth-profiles files that have this profile
            let updatedCount = 0;
            for (const f of authFiles) {
                const raw = tryReadFile(f);
                if (!raw) continue;
                try {
                    const data = JSON.parse(raw);
                    const profiles = data.profiles || data;
                    const p = profiles[profileKey];
                    if (!p) continue;
                    if (newTokens.access_token) {
                        p.access = newTokens.access_token;
                        p.token = newTokens.access_token;
                    }
                    if (newTokens.refresh_token) {
                        p.refresh = newTokens.refresh_token;
                        p.refresh_token = newTokens.refresh_token;
                    }
                    if (newExpiresMs) {
                        p.expires = newExpiresMs;
                        p.expiry = newExpiry;
                        p.expires_at = newExpiresMs;
                    }
                    if (newTokens.id_token) p.id_token = newTokens.id_token;
                    writeFileSync(f, JSON.stringify(data, null, 2), "utf-8");
                    updatedCount++;
                } catch { }
            }

            invalidateProviderCache();
            json(res, 200, {
                ok: true,
                note: "Token refreshed successfully. Updated " + updatedCount + " auth file(s). New expiry: " + (newExpiry || "unknown"),
            });
        } catch (e: any) {
            console.error("[agent-dashboard] OAuth refresh error:", e);
            json(res, 500, {
                ok: false,
                result: "Internal error during token refresh: " + (e.message || String(e)),
            });
        }
        return true;
    }

    // ─── POST /api/auth/reveal — reveal the full API key for a given env var ───
    if (path === "/auth/reveal" && method === "POST") {
        const body = await parseBody(req);
        const envVar = body.envVar || "";
        const profileKey = body.profileKey || "";

        if (envVar) {
            const env = readEnv();
            const val = env[envVar];
            if (val) {
                console.log("[agent-dashboard] API key revealed: envVar=%s at=%s", envVar, new Date().toISOString());
                json(res, 200, { key: val });
                return true;
            }
            json(res, 404, { error: "Key not found in .env" });
            return true;
        }

        if (profileKey) {
            // Look up the token from auth-profiles
            const authFiles = [
                join(AGENTS_STATE_DIR, "main", "agent", "auth-profiles.json"),
                join(AGENTS_STATE_DIR, "main", "auth-profiles.json"),
                join(OPENCLAW_DIR, "credentials", "oauth.json"),
            ];
            for (const f of authFiles) {
                const authRaw = tryReadFile(f);
                if (authRaw === null) continue;
                try {
                    const raw = JSON.parse(authRaw);
                    const profiles = raw.profiles || raw;
                    if (profiles?.[profileKey]) {
                        const p = profiles[profileKey];
                        const token = p.access || p.access_token || p.key || "";
                        console.log("[agent-dashboard] API key revealed: envVar=%s at=%s", profileKey, new Date().toISOString());
                        json(res, 200, { key: token });
                        return true;
                    }
                } catch { }
            }
            json(res, 404, { error: "Profile not found" });
            return true;
        }

        json(res, 400, { error: "envVar or profileKey required" });
        return true;
    }

    // ─── DELETE /api/auth/envkey — remove an API key from .env ───
    if (path === "/auth/envkey" && method === "DELETE") {
        const body = await parseBody(req);
        const envVar = body.envVar || "";
        if (!envVar || !/^[A-Z0-9_]+$/.test(envVar)) { json(res, 400, { error: "Invalid env var name" }); return true; }

        const envPath = join(OPENCLAW_DIR, ".env");
        const envContent = tryReadFile(envPath);
        if (envContent === null) { json(res, 404, { error: ".env file not found" }); return true; }

        try {
            const lines = envContent.split("\n");
            const filtered = lines.filter(line => {
                const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
                return !(m && m[1] === envVar);
            });
            writeFileSync(envPath, filtered.join("\n"), "utf-8");
            json(res, 200, { ok: true });
            return true;
        } catch (e: any) {
            json(res, 500, { error: e.message });
            return true;
        }
    }

    // ─── POST /api/auth/envkey — add or update an API key in .env ───
    if (path === "/auth/envkey" && method === "POST") {
        const body = await parseBody(req);
        const envVar = (body.envVar || "").trim();
        const value = (body.value || "").trim();
        if (!envVar || !/^[A-Z0-9_]+$/.test(envVar)) { json(res, 400, { error: "Invalid env var name. Use uppercase with underscores, e.g. ANTHROPIC_API_KEY" }); return true; }
        if (!value) { json(res, 400, { error: "Value is required" }); return true; }

        const envPath = join(OPENCLAW_DIR, ".env");
        try {
            let content = tryReadFile(envPath) ?? "";
            // Check if the key already exists — update it
            const lines = content.split("\n");
            let found = false;
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^\s*([A-Z0-9_]+)\s*=/);
                if (m && m[1] === envVar) {
                    lines[i] = `${envVar}="${value}"`;
                    found = true;
                    break;
                }
            }
            if (!found) {
                // Append to end (ensure trailing newline)
                if (content.length > 0 && !content.endsWith("\n")) lines.push("");
                lines.push(`${envVar}="${value}"`);
            }
            writeFileSync(envPath, lines.join("\n"), "utf-8");
            json(res, 200, { ok: true, updated: found });
            return true;
        } catch (e: any) {
            json(res, 500, { error: e.message });
            return true;
        }
    }

    return false;
}
