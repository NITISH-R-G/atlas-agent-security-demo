// Minimal REAL smoke test for the Groq OpenAI-compatible API: authentication, model availability, streaming, tool calling.
// Makes at most ~4 requests, never retries after a 401/403/429, never prints the key.
//
//   node scripts/smoke-groq.mjs            # test GROQ_MODEL (or discover a tool-capable one from the account's model list)
//   node scripts/smoke-groq.mjs --write    # also save the verified model id to .env.local as GROQ_MODEL
//
// The key is read from the GROQ_API_KEY environment variable or from .env.local (never from arguments).
import fs from "node:fs";

const BASE = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
let envFile = "";
try {
  envFile = fs.readFileSync(".env.local", "utf8");
} catch {
  /* optional */
}
const fromFile = (name) => {
  const l = envFile.split(/\r?\n/).find((x) => x.startsWith(name + "="));
  return l ? l.slice(l.indexOf("=") + 1).trim() : "";
};
const key = (process.env.GROQ_API_KEY || fromFile("GROQ_API_KEY") || "").trim();
const wanted = (process.env.GROQ_MODEL || fromFile("GROQ_MODEL") || "").trim();
if (!key) {
  console.log("FAIL no GROQ_API_KEY found (environment variable or .env.local)");
  process.exit(2);
}
const red = (s) => String(s).split(key).join("[key]").replace(/\s+/g, " ").slice(0, 220);
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

// Tool-capable models documented by Groq, in preference order. Only ones present in THIS account's model list are tried.
const CANDIDATES = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3-32b", "llama-3.1-8b-instant"];

async function call(path, init) {
  const r = await fetch(BASE + path, { ...init, headers });
  return r;
}
async function stopOn(r, step) {
  if (r.ok) return false;
  let msg = "";
  try {
    msg = red(JSON.stringify((await r.json()).error ?? {}));
  } catch {
    /* ignore */
  }
  console.log(`FAIL ${step}: HTTP ${r.status} ${msg}`);
  return true;
}

// 1. Authentication + the account's model list
let r = await call("/models", { method: "GET" });
if (await stopOn(r, "authentication/models")) process.exit(1);
const available = (await r.json()).data.map((m) => m.id);
console.log(`OK   authentication: ${available.length} models visible to this account`);

const order = wanted ? [wanted] : CANDIDATES.filter((c) => available.includes(c));
if (wanted && !available.includes(wanted)) {
  console.log(`FAIL configured GROQ_MODEL is not in this account's model list`);
  process.exit(1);
}
if (!order.length) {
  console.log("FAIL none of the known tool-capable models is available to this account; set GROQ_MODEL from the Groq console");
  process.exit(1);
}

const tools = [{ type: "function", function: { name: "get_project", description: "Get a project record by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } }];
let verified = "";
for (const model of order.slice(0, 2)) {
  // 2. Streaming
  const t0 = Date.now();
  r = await call("/chat/completions", { method: "POST", body: JSON.stringify({ model, stream: true, max_tokens: 40, messages: [{ role: "user", content: "Reply with a short greeting." }] }) });
  if (await stopOn(r, `streaming (${model})`)) process.exit(1);
  let chunks = 0;
  let first = 0;
  let text = "";
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
      try {
        const d = JSON.parse(line.slice(5)).choices?.[0]?.delta?.content;
        if (d) {
          chunks++;
          text += d;
          if (!first) first = Date.now() - t0;
        }
      } catch {
        /* ignore */
      }
    }
  }
  const total = Date.now() - t0;
  console.log(`${chunks > 1 ? "OK  " : "WARN"} streaming (${model}): ${chunks} content chunks, first after ${first} ms, complete after ${total} ms, reply "${red(text).slice(0, 60)}"`);
  if (!chunks) continue;

  // 3. Tool calling
  r = await call("/chat/completions", { method: "POST", body: JSON.stringify({ model, max_tokens: 200, tools, tool_choice: "auto", messages: [{ role: "user", content: "Use the get_project tool with id proj-lighthouse." }] }) });
  if (!r.ok && r.status === 400) {
    console.log(`WARN tool calling (${model}): HTTP 400 ${red(JSON.stringify((await r.json()).error ?? {}))}; trying next candidate`);
    continue;
  }
  if (await stopOn(r, `tool calling (${model})`)) process.exit(1);
  const tc = (await r.json()).choices?.[0]?.message?.tool_calls;
  if (tc?.length && tc[0].function?.name === "get_project") {
    console.log(`OK   tool calling (${model}): proposed ${tc[0].function.name}(${red(tc[0].function.arguments)})`);
    verified = model;
    break;
  }
  console.log(`WARN tool calling (${model}): no tool call returned; trying next candidate`);
}

if (!verified) {
  console.log("FAIL no model passed streaming + tool calling");
  process.exit(1);
}
console.log(`VERIFIED model: ${verified}`);
if (process.argv.includes("--write")) {
  let out = envFile;
  if (/^GROQ_MODEL=.*$/m.test(out)) out = out.replace(/^GROQ_MODEL=.*$/m, `GROQ_MODEL=${verified}`);
  else out = out.replace(/\s*$/, "\n") + `GROQ_MODEL=${verified}\n`;
  fs.writeFileSync(".env.local", out);
  console.log("saved GROQ_MODEL to .env.local (the key line was not touched)");
}
