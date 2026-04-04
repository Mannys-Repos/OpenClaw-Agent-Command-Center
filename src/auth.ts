// Dashboard authentication — credentials file + session tokens
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const DASHBOARD_DIR = join(homedir(), ".openclaw", "extensions", "openclaw-agent-dashboard");
const CREDENTIALS_PATH = join(DASHBOARD_DIR, ".credentials");

// In-memory session store: token -> expiry timestamp
const sessions = new Map<string, number>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Credential helpers ───

function hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const derived = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
}

interface Credentials {
    username: string;
    passwordHash: string;
}

function readCredentials(): Credentials | null {
    if (!existsSync(CREDENTIALS_PATH)) return null;
    try {
        const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
        if (raw.username && raw.passwordHash) return raw as Credentials;
        return null;
    } catch {
        return null;
    }
}

function writeCredentials(username: string, password: string): void {
    if (!existsSync(DASHBOARD_DIR)) mkdirSync(DASHBOARD_DIR, { recursive: true });
    const creds: Credentials = { username, passwordHash: hashPassword(password) };
    writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), "utf-8");
}

// ─── Session helpers ───

function createSession(): string {
    const token = randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
}

function isValidSession(token: string): boolean {
    const expiry = sessions.get(token);
    if (!expiry) return false;
    if (Date.now() > expiry) {
        sessions.delete(token);
        return false;
    }
    return true;
}

function destroySession(token: string): void {
    sessions.delete(token);
}

function getTokenFromRequest(req: IncomingMessage): string | null {
    // Check Authorization header first (for curl / API clients)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
        return authHeader.slice(7);
    }
    // Check cookie
    const cookies = req.headers.cookie ?? "";
    const match = cookies.match(/(?:^|;\s*)oc_session=([a-f0-9]+)/);
    return match ? match[1] : null;
}

// ─── Public API ───

export function isSetupRequired(): boolean {
    return readCredentials() === null;
}

export function isAuthenticated(req: IncomingMessage): boolean {
    const token = getTokenFromRequest(req);
    return token !== null && isValidSession(token);
}

// Handle POST /auth/setup — first-time credential creation
export function handleSetup(req: IncomingMessage, res: ServerResponse): void {
    if (!isSetupRequired()) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Credentials already configured" }));
        return;
    }
    let body = "";
    req.on("data", (c: any) => body += c);
    req.on("end", () => {
        try {
            const { username, password } = JSON.parse(body);
            if (!username || !password || username.length < 1 || password.length < 8) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Username required, password must be at least 8 characters" }));
                return;
            }
            writeCredentials(username, password);
            const token = createSession();
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Set-Cookie", `oc_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
            res.end(JSON.stringify({ ok: true, token }));
        } catch {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid request body" }));
        }
    });
}

// Handle POST /auth/login
export function handleLogin(req: IncomingMessage, res: ServerResponse): void {
    const creds = readCredentials();
    if (!creds) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "No credentials configured — use setup first" }));
        return;
    }
    let body = "";
    req.on("data", (c: any) => body += c);
    req.on("end", () => {
        try {
            const { username, password } = JSON.parse(body);
            if (username !== creds.username || !verifyPassword(password, creds.passwordHash)) {
                res.statusCode = 401;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Invalid username or password" }));
                return;
            }
            const token = createSession();
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Set-Cookie", `oc_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
            res.end(JSON.stringify({ ok: true, token }));
        } catch {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid request body" }));
        }
    });
}

// Handle POST /auth/logout
export function handleLogout(req: IncomingMessage, res: ServerResponse): void {
    const token = getTokenFromRequest(req);
    if (token) destroySession(token);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Set-Cookie", "oc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    res.end(JSON.stringify({ ok: true }));
}

// Serve the login/setup HTML page
export function serveLoginPage(res: ServerResponse, title: string, isSetup: boolean): void {
    const heading = isSetup ? "Create Dashboard Account" : "Sign In";
    const subtitle = isSetup
        ? "Set up a username and password to secure your dashboard."
        : "Enter your credentials to continue.";
    const endpoint = isSetup ? "/auth/setup" : "/auth/login";
    const buttonText = isSetup ? "Create Account" : "Sign In";
    const usernameVal = isSetup ? "" : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — ${heading}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0b0b10;color:#e4e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#111118;border:1px solid #2a2a3e;border-radius:12px;padding:40px;width:100%;max-width:400px;margin:20px}
h1{font-size:20px;margin-bottom:6px}
.sub{color:#9898b0;font-size:14px;margin-bottom:28px}
label{display:block;font-size:12px;color:#9898b0;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
input{width:100%;padding:11px 14px;background:#0b0b10;border:1px solid #2a2a3e;border-radius:8px;color:#e4e4f0;font-size:15px;font-family:inherit;margin-bottom:18px;transition:border-color .15s}
input:focus{outline:none;border-color:#7c6cf0;box-shadow:0 0 0 3px rgba(124,108,240,.12)}
button{width:100%;padding:12px;background:#7c6cf0;border:none;border-radius:8px;color:#fff;font-size:15px;font-family:inherit;cursor:pointer;transition:background .15s}
button:hover{background:#9080ff}
button:disabled{opacity:.5;cursor:not-allowed}
.err{color:#ff4757;font-size:13px;margin-bottom:14px;display:none}
</style>
</head>
<body>
<div class="card">
<h1>${heading}</h1>
<p class="sub">${subtitle}</p>
<div class="err" id="err"></div>
<form id="form">
<label for="username">Username</label>
<input id="username" name="username" type="text" autocomplete="username" required value="${usernameVal}" />
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="${isSetup ? "new-password" : "current-password"}" required minlength="${isSetup ? 8 : 1}" />
<button type="submit" id="btn">${buttonText}</button>
</form>
</div>
<script>
document.getElementById("form").addEventListener("submit",function(e){
  e.preventDefault();
  var btn=document.getElementById("btn");
  var err=document.getElementById("err");
  btn.disabled=true;err.style.display="none";
  fetch("${endpoint}",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:document.getElementById("username").value,password:document.getElementById("password").value})})
  .then(function(r){return r.json().then(function(d){return{ok:r.ok,data:d}})})
  .then(function(r){
    if(!r.ok){err.textContent=r.data.error||"Login failed";err.style.display="block";btn.disabled=false;return}
    window.location.href="/";
  })
  .catch(function(){err.textContent="Network error";err.style.display="block";btn.disabled=false});
});
</script>
</body>
</html>`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
}
