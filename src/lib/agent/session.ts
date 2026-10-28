/**
 * Anonymous browser sessions. The server mints an unguessable id and sets it in an HttpOnly, SameSite=Strict cookie; it is
 * used only to bind approvals and rate limits to the browser that created them. It is NOT authentication: Atlas has no
 * users, and the Security switch remains a scenario setting.
 */
const COOKIE = "atlas_sid";
const SID = /^[a-f0-9]{32}$/;

export function readSid(req: Request): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE) {
      const v = part.slice(i + 1).trim();
      return SID.test(v) ? v : undefined;
    }
  }
  return undefined;
}

export const newSid = (): string => globalThis.crypto.randomUUID().replace(/-/g, "");

export const sidCookie = (sid: string, secure: boolean): string => `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;

/** Per-session fixed-window rate limit, in memory. Bounded so it cannot grow without limit. */
export const CHAT_LIMIT = 60;
export const CHAT_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED = 5000;
const g = globalThis as unknown as { __atlasRate?: Map<string, { start: number; count: number }> };
const windows = (g.__atlasRate ??= new Map());

/** Returns true when the request is allowed. */
export function allowChat(sid: string, now = Date.now(), limit = CHAT_LIMIT): boolean {
  const w = windows.get(sid);
  if (!w || now - w.start >= CHAT_WINDOW_MS) {
    windows.set(sid, { start: now, count: 1 });
    while (windows.size > MAX_TRACKED) windows.delete(windows.keys().next().value as string);
    return true;
  }
  w.count++;
  return w.count <= limit;
}

/** Public-hosting protections: a client that discards its cookie to get a fresh session is still limited per IP and globally. */
export const IP_LIMIT = 150;
export const GLOBAL_LIMIT = 800;
export const MAX_INFLIGHT = 12;
const gg = globalThis as unknown as { __atlasGlobal?: { start: number; count: number }; __atlasInflight?: { n: number } };
const globalWindow = (gg.__atlasGlobal ??= { start: 0, count: 0 });
const inflight = (gg.__atlasInflight ??= { n: 0 });

/**
 * The client address as set by the hosting proxy. A header is trusted only where the platform owns it: `fly-client-ip`
 * on Fly (the route passes onFly from FLY_APP_NAME; this module reads no environment), otherwise `x-real-ip`, then the entry the single trusted proxy appended to
 * `x-forwarded-for` (the rightmost one; anything to its left was written by the caller). Undefined when running without a proxy.
 */
export function clientIp(req: Request, onFly = false): string | undefined {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").at(-1);
  const raw = onFly ? req.headers.get("fly-client-ip") : (req.headers.get("x-real-ip") ?? forwarded);
  const ip = raw?.trim();
  return ip && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : undefined;
}

/** HTTPS as seen by the server or reported by the TLS-terminating proxy. Only used to add the cookie's Secure flag. */
export const isHttps = (req: Request): boolean => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";

export function allowGlobal(now = Date.now(), limit = GLOBAL_LIMIT): boolean {
  if (now - globalWindow.start >= CHAT_WINDOW_MS) {
    globalWindow.start = now;
    globalWindow.count = 0;
  }
  globalWindow.count++;
  return globalWindow.count <= limit;
}

/** Concurrency cap for streaming requests. Returns a release function, or undefined when the server is busy. */
export function acquireSlot(max = MAX_INFLIGHT): (() => void) | undefined {
  if (inflight.n >= max) return undefined;
  inflight.n++;
  let done = false;
  return () => {
    if (!done) {
      done = true;
      inflight.n--;
    }
  };
}

export const resetRateLimits = () => {
  windows.clear();
  globalWindow.start = 0;
  globalWindow.count = 0;
  inflight.n = 0;
};
