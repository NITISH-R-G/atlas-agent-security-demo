import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

// Hermetic provider configuration: a developer's real keys in the shell or .env.local must never leak into unit tests.
// (The live suite reads its configuration once at import time, before this hook runs, so it is unaffected.)
const PROVIDER_ENV = /^(GROQ|OPENROUTER|OPENAI|NVIDIA|NEMOTRON)_|^LLM_PROVIDER$/;
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (PROVIDER_ENV.test(k)) delete process.env[k];
});

// jsdom lacks matchMedia; the app reads prefers-reduced-motion.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null }) as MediaQueryList;
}
