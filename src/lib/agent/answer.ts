/** Builds OpenUI Lang programs (for chatLibrary) from facts the execution layer confirmed. */

export function lit(s: string): string {
  return `"${s.replace(/\\/g, " ").replace(/"/g, "'").replace(/[\r\n]+/g, " ").trim()}"`;
}

export type Block =
  | { kind: "p"; text: string }
  | { kind: "report"; title: string; points: string[] }
  | { kind: "table"; title: string; columns: string[]; rows: string[][] };

export interface Answer {
  program: string;
  plain: string;
}

export function buildAnswer(blocks: Block[]): Answer {
  const lines: string[] = [];
  const names: string[] = [];
  let n = 0;
  const plain: string[] = [];
  for (const b of blocks) {
    const name = `b${++n}`;
    names.push(name);
    if (b.kind === "p") {
      lines.push(`${name} = Paragraph(${lit(b.text)})`);
      plain.push(b.text);
    } else if (b.kind === "report") {
      lines.push(`${name} = ReportSummary(${lit(b.title)}, [${b.points.map(lit).join(", ")}])`);
      plain.push(`${b.title}: ${b.points.join("; ")}`);
    } else {
      const rows = b.rows.map((r, i) => {
        const rn = `${name}r${i + 1}`;
        lines.push(`${rn} = Row([${r.map(lit).join(", ")}])`);
        return rn;
      });
      lines.push(`${name} = DataTable(${lit(b.title)}, [${b.columns.map(lit).join(", ")}], [${rows.join(", ")}])`);
      plain.push(`${b.title}: ${b.rows.map((r) => r.join(" | ")).join("; ")}`);
    }
  }
  return { program: [`root = ChatReply([${names.join(", ")}])`, ...lines].join("\n"), plain: plain.join("\n") };
}
