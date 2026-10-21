import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const src = (dir: string, re = /\.(ts|tsx)$/) => walk(path.join(ROOT, dir)).filter((f) => re.test(f) && !/\.test\./.test(f));

describe("repository hygiene", () => {
  it("the agent core imports no filesystem, process, network or shell modules", () => {
    for (const f of src("src/lib/agent").filter((x) => !/client\.ts$/.test(x))) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/from "(node:)?(fs|child_process|net|http|https|dgram|dns|os|vm|worker_threads)"/);
      expect(s, f).not.toMatch(/\bfetch\(|XMLHttpRequest|\beval\(|new Function|process\.env|dangerouslySetInnerHTML/);
    }
  });

  it("browser code never references server secrets or environment", () => {
    for (const f of [...src("src/components"), ...src("src/lib/agent").filter((x) => /client\.ts$|library\.tsx$/.test(x))]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/THESYS|NVIDIA_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|GROQ_API_KEY|process\.env|NEXT_PUBLIC/);
    }
  });

  it("only server routes read the key, and no source holds a key-like literal", () => {
    for (const f of src("src", /\.(ts|tsx|json)$/)) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/(sk|thesys|fct)[-_][A-Za-z0-9]{24,}/);
    }
  });

  it("no component uses dangerouslySetInnerHTML", () => {
    for (const f of src("src", /\.tsx$/)) expect(readFileSync(f, "utf8"), f).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("ships .env.example with a blank key and ignores real env files", () => {
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");
    expect(example).toMatch(/^NVIDIA_API_KEY=\s*$/m);
    expect(example).toMatch(/^NEMOTRON_MODEL=\s*$/m);
    expect(example).toMatch(/^OPENAI_API_KEY=\s*$/m);
    expect(example).toMatch(/^GROQ_API_KEY=\s*$/m);
    expect(example).toMatch(/^GROQ_MODEL=\s*$/m);
    expect(example).toMatch(/^OPENROUTER_API_KEY=\s*$/m);
    expect(example).toMatch(/^OPENROUTER_MODEL=\s*$/m);
    expect(example).not.toMatch(/sk-or-|gsk_/);
    expect(example).toMatch(/^OPENAI_MODEL=\s*$/m);
    expect(example).not.toMatch(/nvapi-|sk-[A-Za-z0-9]{10,}|THESYS/);
    // .env.local must be ignored by Git (pattern .env* with only .env.example re-included)
    const ignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^!\.env\.example$/m);
    expect(ignore).not.toMatch(/^!\.env\.local/m);
    expect(readFileSync(path.join(ROOT, ".gitignore"), "utf8")).toMatch(/^\.env\*/m);
    expect(existsSync(path.join(ROOT, ".env.example"))).toBe(true);
  });

  it("the chat library defines no actions or functions a generated reply could use to call out", async () => {
    const { chatLibrary } = await import("./library");
    const lib = chatLibrary as unknown as { actions?: object; functions?: object };
    expect(Object.keys(lib.actions ?? {})).toEqual([]);
    expect(Object.keys(lib.functions ?? {})).toEqual([]);
  });
});
