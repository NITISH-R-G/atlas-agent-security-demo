import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

/**
 * The only components an assistant reply may use. They render text props through React (no HTML injection)
 * and define no actions, functions or queries, so generated UI cannot call tools or alter policy.
 * Security decisions and tool results are rendered natively by the app, never by model output.
 */
const clamp = (s: unknown, max = 600) => {
  const t = typeof s === "string" ? s : "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export const Paragraph = defineComponent({
  name: "Paragraph",
  description: "A short paragraph of plain text.",
  props: z.object({ text: z.string() }),
  component: ({ props }) => <p className="oc-p">{clamp(props.text, 1200)}</p>,
});

export const ReportSummary = defineComponent({
  name: "ReportSummary",
  description: "A titled summary with a short list of key points. Use for summaries, status reports and suggestions.",
  props: z.object({ title: z.string(), points: z.array(z.string()) }),
  component: ({ props }) => (
    <section className="oc-report">
      <h4>{clamp(props.title, 120)}</h4>
      <ul>
        {props.points.slice(0, 12).map((p, i) => (
          <li key={i}>{clamp(p)}</li>
        ))}
      </ul>
    </section>
  ),
});

export const Row = defineComponent({
  name: "Row",
  description: "One table row; cells are plain text in column order.",
  props: z.object({ cells: z.array(z.string()) }),
  component: ({ props }) => (
    <tr>
      {props.cells.slice(0, 6).map((c, i) => (
        <td key={i}>{clamp(c, 300)}</td>
      ))}
    </tr>
  ),
});

export const DataTable = defineComponent({
  name: "DataTable",
  description: "A small table of Row entries. Provide column names first.",
  props: z.object({ title: z.string(), columns: z.array(z.string()), rows: z.array(Row.ref) }),
  component: ({ props, renderNode }) => (
    <section className="oc-table">
      <h4>{clamp(props.title, 120)}</h4>
      <div className="oc-scroll">
        <table>
          <thead>
            <tr>
              {props.columns.slice(0, 6).map((c, i) => (
                <th key={i} scope="col">
                  {clamp(c, 60)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{renderNode(props.rows)}</tbody>
        </table>
      </div>
    </section>
  ),
});

export const ChatReply = defineComponent({
  name: "ChatReply",
  description: "Root of every reply: a list of Paragraph, ReportSummary and DataTable blocks.",
  props: z.object({ blocks: z.array(z.union([Paragraph.ref, ReportSummary.ref, DataTable.ref])) }),
  component: ({ props, renderNode }) => <div className="oc-reply">{renderNode(props.blocks)}</div>,
});

export const chatLibrary = createLibrary({
  id: "atlas-assistant",
  root: "ChatReply",
  components: [ChatReply, Paragraph, ReportSummary, DataTable, Row],
});

export const chatPromptOptions = {
  preamble:
    "You are Atlas, a concise, friendly workplace assistant for the fictional company Atlas Labs. Answer in a few short sentences. Use ReportSummary for lists of key points and DataTable for small tables when that helps.",
  additionalRules: [
    "Use only the provided components and start with root = ChatReply([...]).",
    "Never claim you used a tool, sent a message, or accessed a record. You have no tools in this mode.",
    "Do not invent real people, companies, credentials, or figures.",
  ],
  examples: [
    `root = ChatReply([intro, tips])
intro = Paragraph("Here are a few quick tips.")
tips = ReportSummary("Quick tips", ["Keep notes short", "Write down next steps"])`,
  ],
};
