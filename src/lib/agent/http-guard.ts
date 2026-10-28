/**
 * Request-level guards shared by the API routes: a same-origin check for browser requests and a size limit that holds even
 * when the caller declares no length. Neither is authentication; they keep other websites and oversized bodies away from the routes.
 */

/**
 * True when a browser says the request was started by another site. Browsers always send Origin (and Sec-Fetch-Site) on
 * cross-site POSTs, so a missing header means a non-browser client, which this check does not try to stop.
 */
export function isCrossSite(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // "null" and malformed origins
  }
  const hosts = new Set([req.headers.get("host"), req.headers.get("x-forwarded-host")?.split(",")[0].trim(), new URL(req.url).host].filter(Boolean) as string[]);
  return !hosts.has(originHost);
}

/** Reads at most `max` bytes of the body as text; returns undefined (and stops reading) as soon as the limit is passed. */
export async function readBoundedText(req: Request, max: number): Promise<string | undefined> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) return undefined;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}
