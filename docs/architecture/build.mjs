// Generates the editable SVG sources in this folder. Each element carries data-step (reveal order) and data-id.
// The SVGs render fully when opened on their own; video/diagram-scene.mjs reveals them step by step.
//   node docs/architecture/build.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 1600;
const H = 900;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const COLORS = {
  neutral: { fill: "#f3f5fa", stroke: "#8b95ad", ink: "#1b2338" },
  model: { fill: "#e7f6fc", stroke: "#1b9ccf", ink: "#0c4a66" },
  tool: { fill: "#e7f6fc", stroke: "#1b9ccf", ink: "#0c4a66" },
  allow: { fill: "#e6f6ec", stroke: "#1f9d57", ink: "#0d5a31" },
  deny: { fill: "#fdeceb", stroke: "#d93a35", ink: "#7d1b18" },
  pending: { fill: "#fff4dc", stroke: "#d98a00", ink: "#6d4600" },
  server: { fill: "#eef1ff", stroke: "#4a5be0", ink: "#1e2a8c" },
  muted: { fill: "#f6f7f9", stroke: "#c3c9d6", ink: "#6b7385" },
};

class Diagram {
  constructor(id, title, subtitle) {
    this.id = id;
    this.title = title;
    this.subtitle = subtitle;
    this.nodes = new Map();
    this.parts = [];
  }
  boundary(id, x, y, w, h, label, step) {
    this.parts.push(`<g data-id="${id}" data-step="${step}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="26" class="boundary"/><text x="${x + 24}" y="${y + 34}" class="blabel">${esc(label)}</text></g>`);
  }
  node(id, x, y, w, h, title, lines, kind, step, badge, lg) {
    this.nodes.set(id, { x, y, w, h });
    const c = COLORS[kind];
    const sub = (lines ?? []).map((l, i) => `<text x="${x + 18}" y="${lg ? y + 84 + i * 34 : y + 62 + i * 25}" class="sub" fill="${c.ink}"${lg ? ' font-size="27"' : ""}>${esc(l)}</text>`).join("");
    const b = badge ? `<text x="${x + 6}" y="${y - 12}" class="badge" fill="${c.stroke}">${esc(badge)}</text>` : "";
    this.parts.push(`<g data-id="${id}" data-step="${step}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2.5"/><text x="${x + 18}" y="${lines && lines.length ? (lg ? y + 46 : y + 34) : y + h / 2 + 9}" class="ttl" fill="${c.ink}"${lg ? ' font-size="38"' : ""}>${esc(title)}</text>${sub}${b}</g>`);
  }
  point(id, side) {
    const n = this.nodes.get(id);
    return { l: [n.x, n.y + n.h / 2], r: [n.x + n.w, n.y + n.h / 2], t: [n.x + n.w / 2, n.y], b: [n.x + n.w / 2, n.y + n.h] }[side];
  }
  edge(id, a, as, b, bs, step, opts = {}) {
    const [x1, y1] = this.point(a, as);
    const [x2, y2] = this.point(b, bs);
    const c = COLORS[opts.kind ?? "neutral"];
    let d;
    if (opts.elbow === "h") {
      const mx = opts.mid ?? (x1 + x2) / 2;
      d = `M${x1} ${y1} L${mx} ${y1} L${mx} ${y2} L${x2} ${y2}`;
    } else if (opts.elbow === "v") {
      const my = opts.mid ?? (y1 + y2) / 2;
      d = `M${x1} ${y1} L${x1} ${my} L${x2} ${my} L${x2} ${y2}`;
    } else d = `M${x1} ${y1} L${x2} ${y2}`;
    const label = opts.label
      ? (() => {
          const lx = opts.lx ?? (x1 + x2) / 2;
          const ly = opts.ly ?? (y1 + y2) / 2 - 14;
          const wd = opts.label.length * 10.5 + 24;
          return `<rect x="${lx - wd / 2}" y="${ly - 22}" width="${wd}" height="32" rx="16" class="lbg"/><text x="${lx}" y="${ly}" class="elabel" text-anchor="middle" fill="${c.ink}">${esc(opts.label)}</text>`;
        })()
      : "";
    this.parts.push(`<g data-id="${id}" data-step="${step}"><path d="${d}" pathLength="1" class="edge${opts.dashed ? " dashed" : ""}" stroke="${c.stroke}" marker-end="url(#arrow-${opts.kind ?? "neutral"})"/>${label}</g>`);
  }
  note(id, x, y, text, step, kind = "neutral", anchor = "start", size = 24) {
    const c = COLORS[kind];
    const lines = Array.isArray(text) ? text : [text];
    this.parts.push(
      `<g data-id="${id}" data-step="${step}">${lines.map((l, i) => `<text x="${x}" y="${y + i * (size + 8)}" class="note" font-size="${size}" text-anchor="${anchor}" fill="${c.ink}">${esc(l)}</text>`).join("")}</g>`,
    );
  }
  svg() {
    const markers = Object.entries(COLORS)
      .map(([k, c]) => `<marker id="arrow-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${c.stroke}"/></marker>`)
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(this.title)}. ${esc(this.subtitle)}">
<title>${esc(this.title)}</title>
<desc>${esc(this.subtitle)}</desc>
<defs>${markers}<style>
  text{font-family:Inter,"Segoe UI",system-ui,sans-serif}
  .bg{fill:#fbfcfe}
  .h1{font-size:44px;font-weight:700;fill:#121a30;letter-spacing:-0.5px}
  .h2{font-size:24px;fill:#5b6579}
  .ttl{font-size:25px;font-weight:700}
  .sub{font-size:19px}
  .badge{font-size:15px;font-weight:700;letter-spacing:.8px}
  .note{font-weight:600}
  .boundary{fill:rgba(74,91,224,.045);stroke:#4a5be0;stroke-width:3;stroke-dasharray:14 10}
  .blabel{font-size:17px;font-weight:700;letter-spacing:2px;fill:#3a49c8}
  .edge{fill:none;stroke-width:3.5;stroke-linejoin:round}
  .edge.dashed{stroke-dasharray:10 8}
  .lbg{fill:#fbfcfe;stroke:#dfe3ec}
  .elabel{font-size:17px;font-weight:600}
</style></defs>
<rect class="bg" width="${W}" height="${H}"/>
<text x="60" y="78" class="h1">${esc(this.title)}</text>
<text x="60" y="118" class="h2">${esc(this.subtitle)}</text>
${this.parts.join("\n")}
</svg>
`;
  }
}

const out = {};

/* ---------------- A: system architecture ---------------- */
{
  const d = new Diagram("architecture-overview", "Atlas system architecture", "The model proposes. Server-side code decides, executes and records.");
  d.node("user", 50, 380, 190, 120, "You", ["Chat, Explore", "Security, evidence"], "neutral", 1);
  d.node("groq", 680, 140, 240, 70, "Groq API", ["external model"], "model", 3);
  d.boundary("boundary", 320, 235, 1240, 510, "SERVER · TRUST BOUNDARY", 2);
  d.node("route", 350, 370, 230, 140, "Route handlers", ["/api/chat, /api/approve", "session cookie, limits"], "server", 2);
  d.node("adapter", 680, 275, 240, 80, "Model adapter", ["live replies"], "model", 3);
  d.node("scripted", 680, 385, 240, 80, "Scripted planner", ["no model"], "neutral", 3);
  d.node("builtin", 680, 495, 240, 80, "Built-in assistant", ["no model"], "neutral", 3);
  d.node("pipeline", 1010, 300, 270, 270, "Policy pipeline", ["executeTool", "validate arguments", "trust, allowlist, identity", "credentials, resource", "approval gate, filter"], "server", 4);
  d.node("tools", 1340, 280, 190, 110, "Tools", ["7, synthetic data"], "tool", 5);
  d.node("data", 1340, 420, 190, 90, "Resources", ["fictional, in memory"], "neutral", 5);
  d.node("audit", 1340, 560, 190, 120, "Audit log", ["one record per", "decision, in memory"], "allow", 6);
  d.node("approvals", 1010, 625, 270, 90, "Approval store", ["parked calls, sealed tickets"], "pending", 5);
  d.edge("e1", "user", "r", "route", "l", 2, { label: "request", lx: 295, ly: 420 });
  d.edge("e2", "route", "r", "adapter", "l", 3, { elbow: "h", mid: 630 });
  d.edge("e3", "route", "r", "scripted", "l", 3, { elbow: "h", mid: 630 });
  d.edge("e4", "route", "r", "builtin", "l", 3, { elbow: "h", mid: 630 });
  d.edge("e5", "adapter", "t", "groq", "b", 3, { kind: "model", dashed: true });
  d.edge("e6", "adapter", "r", "pipeline", "l", 4, { elbow: "h", mid: 965, kind: "server" });
  d.edge("e7", "scripted", "r", "pipeline", "l", 4, { elbow: "h", mid: 965, kind: "server" });
  d.edge("e8", "builtin", "r", "pipeline", "l", 4, { elbow: "h", mid: 965, kind: "server" });
  d.edge("e9", "pipeline", "r", "tools", "l", 5, { kind: "allow", elbow: "h", mid: 1310 });
  d.edge("e10", "tools", "b", "data", "t", 5, { kind: "tool" });
  d.edge("e11", "pipeline", "b", "approvals", "t", 5, { kind: "pending" });
  d.edge("e12", "pipeline", "r", "audit", "l", 6, { kind: "allow", elbow: "h", mid: 1310, dashed: true });
  d.note("cap", 50, 600, ["Inside the dashed line:", "trusted server code.", "Only the Groq API is", "outside our code."], 4, "server", "start", 20);
  out.A = d;
}

/* ---------------- B: request and policy lifecycle ---------------- */
{
  const d = new Diagram("request-lifecycle", "Request and policy lifecycle", "One tool call, from your request to a recorded outcome.");
  d.node("user", 50, 330, 190, 110, "You", ["send a request"], "neutral", 1);
  d.node("model", 360, 330, 220, 110, "Model", ["proposes a tool call"], "model", 2);
  d.boundary("boundary", 710, 190, 840, 500, "SERVER · TRUST BOUNDARY", 4);
  d.node("policy", 740, 300, 270, 190, "Policy checks", ["arguments, trust,", "allowlist, identity,", "credentials, resource"], "server", 4);
  d.node("allow", 1090, 235, 170, 90, "Allow", ["run the tool"], "allow", 6);
  d.node("deny", 1090, 455, 170, 90, "Deny", ["nothing runs"], "deny", 6);
  d.node("tool", 1330, 235, 190, 90, "Tool runs", ["synthetic data"], "tool", 7);
  d.node("audit", 1330, 430, 190, 150, "Audit event", ["tool, target,", "decision, layer,", "source"], "allow", 8);
  d.edge("e1", "user", "r", "model", "l", 2, { label: "request", lx: 300, ly: 372 });
  d.edge("e2", "model", "r", "policy", "l", 3, { kind: "model", label: "proposal", lx: 645, ly: 372 });
  d.edge("e3", "policy", "r", "allow", "l", 6, { kind: "allow", elbow: "h", mid: 1050 });
  d.edge("e4", "policy", "r", "deny", "l", 6, { kind: "deny", elbow: "h", mid: 1050 });
  d.edge("e5", "allow", "r", "tool", "l", 7, { kind: "allow" });
  d.edge("e6", "tool", "b", "audit", "t", 8, { kind: "allow", dashed: true });
  d.edge("e7", "deny", "r", "audit", "l", 8, { kind: "deny", dashed: true, elbow: "h", mid: 1295 });
  d.note("n1", 360, 500, ["A proposal is not", "permission: the", "model can only ask."], 3, "model", "start", 22);
  d.note("n2", 740, 748, "The server decides. The decision is recorded either way.", 8, "server", "start", 26);
  out.B = d;
}

/* ---------------- C: approval lifecycle ---------------- */
{
  const d = new Diagram("approval-lifecycle", "Approval lifecycle", "A sensitive action waits for a person. The server still does the checking.");
  d.node("proposed", 50, 280, 190, 120, "Proposed", ["send_message", "to the team"], "model", 1);
  d.node("checks", 310, 280, 190, 120, "Earlier checks", ["trust, allowlist,", "identity, resource"], "server", 2, "SERVER");
  d.node("pending", 570, 280, 190, 120, "Parked", ["call, arguments,", "policy, session"], "pending", 3, "PENDING");
  d.node("human", 830, 280, 190, 120, "You decide", ["Approve or Deny", "on the card"], "neutral", 5, "BROWSER");
  d.node("validate", 1090, 280, 190, 120, "Validate", ["session, call id,", "ticket, expiry"], "server", 6, "SERVER");
  d.node("denied", 1350, 215, 190, 90, "Denied", ["not run"], "deny", 7);
  d.node("run", 1350, 345, 190, 110, "Re-checked", ["then runs once"], "allow", 7);
  d.node("ticket", 570, 520, 190, 130, "Sealed ticket", ["to the browser,", "unreadable, expires"], "pending", 4);
  d.node("audit", 1090, 520, 450, 110, "Audit event", ["both decisions are recorded"], "allow", 8);
  d.edge("e1", "proposed", "r", "checks", "l", 2, { kind: "model" });
  d.edge("e2", "checks", "r", "pending", "l", 3, { kind: "pending" });
  d.edge("e3", "pending", "b", "ticket", "t", 4, { kind: "pending", dashed: true });
  d.edge("e4", "pending", "r", "human", "l", 5, { kind: "pending" });
  d.edge("e5", "human", "r", "validate", "l", 6);
  d.edge("e6", "validate", "r", "denied", "l", 7, { kind: "deny", elbow: "h", mid: 1315 });
  d.edge("e7", "validate", "r", "run", "l", 7, { kind: "allow", elbow: "h", mid: 1315 });
  d.edge("e8", "run", "b", "audit", "t", 8, { kind: "allow", dashed: true, elbow: "v", mid: 490 });
  d.note("n1", 50, 748, "In this demo a send only appends to a simulated outbox. Nothing is delivered.", 7, "pending", "start", 24);
  out.C = d;
}

/* ---------------- D: Security OFF vs ON ---------------- */
{
  const d = new Diagram("security-mode-comparison", "Security OFF versus Security ON", "The same scripted request, two outcomes. Scripted scenarios, not the live model.");
  d.node("offh", 60, 160, 640, 80, "Security OFF · controlled demo weakness", [], "deny", 1);
  d.node("onh", 900, 160, 640, 80, "Security ON · server enforcement", [], "allow", 1);
  const rows = [
    ["Untrusted plugin", "runs; its hidden instruction is followed", "blocked: unsigned, unpinned"],
    ["Restricted memo", "read by the scripted agent", "never touched"],
    ["Outside address", "message queued (simulated)", "no send; verified record used"],
    ["Evidence", "no audit records", "an audit record per decision"],
  ];
  rows.forEach(([k, off, on], i) => {
    const y = 280 + i * 110;
    d.node(`off${i}`, 60, y, 640, 78, off, [], "deny", 2 + i);
    d.node(`on${i}`, 900, y, 640, 78, on, [], "allow", 2 + i);
    d.note(`k${i}`, 800, y + 46, k, 2 + i, "neutral", "middle", 19);
  });
  d.note("n1", 60, 748, "Same request, same data. OFF is a demonstration mode, not a recommended configuration.", 6, "server", "start", 24);
  out.D = d;
}

/* ---------------- E: fail closed ---------------- */
{
  const d = new Diagram("fail-closed-flow", "Fail closed", "If a required check cannot complete, the action does not run.");
  d.node("proposal", 50, 300, 210, 120, "Proposal", ["send_message", "to the team"], "model", 1);
  d.boundary("boundary", 330, 190, 1220, 500, "SERVER · TRUST BOUNDARY", 2);
  d.node("engine", 360, 300, 220, 120, "Policy engine", ["needs an authorization", "result to continue"], "server", 2);
  d.node("authz", 690, 300, 230, 120, "Authz check", ["simulated outage"], "deny", 3);
  d.node("fc", 1030, 300, 210, 120, "Fail closed", ["cannot complete,", "so deny"], "deny", 4);
  d.node("stop", 1340, 300, 190, 120, "Not executed", ["nothing sent"], "deny", 5);
  d.node("tool", 1030, 540, 210, 100, "Tool", ["never reached"], "muted", 5);
  d.node("audit", 360, 540, 560, 110, "Audit event", ["decision: denied, layer: fail closed"], "allow", 6);
  d.edge("e1", "proposal", "r", "engine", "l", 2, { kind: "model" });
  d.edge("e2", "engine", "r", "authz", "l", 3, { label: "asks", kind: "server", lx: 635, ly: 342 });
  d.edge("e3", "authz", "r", "fc", "l", 4, { kind: "deny", label: "no answer", lx: 975, ly: 342 });
  d.edge("e4", "fc", "r", "stop", "l", 5, { kind: "deny" });
  d.edge("e5", "fc", "b", "tool", "t", 5, { kind: "muted", dashed: true });
  d.edge("e6", "fc", "b", "audit", "t", 6, { kind: "allow", dashed: true, elbow: "v", mid: 480 });
  d.note("n1", 50, 748, "A controlled, simulated failure. With Security OFF the same outage fails open: that is the defined weakness.", 6, "server", "start", 24);
  out.E = d;
}

/* ---------------- F: the simple flow (beginner) ---------------- */
{
  const d = new Diagram("simple-flow", "The AI suggests. Atlas checks.", "If the action is allowed, it happens. If it is blocked, it stops.");
  d.node("you", 60, 330, 300, 170, "You", ["ask for something"], "neutral", 1, undefined, true);
  d.note("ask", 60, 270, ["“Read the project update and send a summary to the team.”"], 2, "neutral", "start", 22);
  d.node("ai", 520, 330, 300, 170, "AI", ["suggests what to do"], "model", 3, undefined, true);
  d.node("atlas", 980, 330, 300, 170, "Atlas checks", ["before anything runs"], "server", 5, undefined, true);
  d.node("allowed", 1360, 190, 200, 130, "Allowed", ["action happens"], "allow", 6, undefined, true);
  d.node("blocked", 1360, 510, 200, 130, "Blocked", ["action stops"], "deny", 7, undefined, true);
  d.node("record", 980, 600, 300, 110, "Activity record", ["every decision saved"], "muted", 9, undefined, false);
  d.edge("e1", "you", "r", "ai", "l", 3, { kind: "neutral" });
  d.edge("e2", "ai", "r", "atlas", "l", 5, { kind: "model", label: "suggestion", lx: 900, ly: 400 });
  d.edge("e3", "atlas", "r", "allowed", "l", 6, { kind: "allow", elbow: "h", mid: 1320 });
  d.edge("e4", "atlas", "r", "blocked", "l", 7, { kind: "deny", elbow: "h", mid: 1320 });
  d.edge("e5", "atlas", "b", "record", "t", 9, { kind: "muted", dashed: true });
  d.note("term", 980, 308, ["a security check on the server"], 8, "server", "start", 20);
  out.F = d;
}

/* ---------------- G: stop safely when a check fails ---------------- */
{
  const d = new Diagram("safe-stop", "If a check cannot run, Atlas stops safely", "A simulated failure in the demo, not a real outage.");
  d.node("you", 60, 330, 300, 170, "You", ["ask for something"], "neutral", 1, undefined, true);
  d.node("ai", 520, 330, 300, 170, "AI", ["suggests what to do"], "model", 2, undefined, true);
  d.node("atlas", 980, 330, 300, 170, "Atlas checks", ["needs an answer"], "server", 3, undefined, true);
  d.node("down", 980, 600, 300, 110, "Check unavailable", ["simulated failure"], "deny", 4, undefined, false);
  d.node("stop", 1360, 330, 200, 170, "Stops", ["nothing happens"], "deny", 5, undefined, true);
  d.edge("e1", "you", "r", "ai", "l", 2, { kind: "neutral" });
  d.edge("e2", "ai", "r", "atlas", "l", 3, { kind: "model", label: "suggestion", lx: 900, ly: 400 });
  d.edge("e3", "atlas", "b", "down", "t", 4, { kind: "deny" });
  d.edge("e4", "atlas", "r", "stop", "l", 5, { kind: "deny" });
  d.note("n1", 60, 748, "Safe default: if Atlas cannot check, the action does not run.", 5, "server", "start", 26);
  out.G = d;
}

for (const d of Object.values(out)) writeFileSync(join(HERE, `${d.id}.svg`), d.svg());
writeFileSync(join(HERE, "steps.json"), JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, d]) => [d.id, { key: k, title: d.title, subtitle: d.subtitle }])), null, 2));
console.log("wrote", Object.values(out).map((d) => `${d.id}.svg`).join(", "));
