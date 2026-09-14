import type { ReactNode } from "react";

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${keyPrefix}-code-${index}`}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function heading(level: number, content: ReactNode, key: string) {
  switch (level) {
    case 1:
      return <h1 key={key}>{content}</h1>;
    case 2:
      return <h2 key={key}>{content}</h2>;
    case 3:
      return <h3 key={key}>{content}</h3>;
    case 4:
      return <h4 key={key}>{content}</h4>;
    case 5:
      return <h5 key={key}>{content}</h5>;
    default:
      return <h6 key={key}>{content}</h6>;
  }
}

function isGeneratedMarker(line: string) {
  return /^<!--\s*SYSTEM-GUIDE:/.test(line.trim());
}

export function MarkdownDocument({ source, headingOffset = 1 }: { source: string; headingOffset?: number }) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trimEnd();

    if (!line.trim() || isGeneratedMarker(line)) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={`code-${index}`}>
          <code data-language={language || undefined}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length + headingOffset);
      blocks.push(heading(level, renderInline(headingMatch[2], `heading-${index}`), `heading-${index}`));
      index += 1;
      continue;
    }

    if (line.trim().startsWith("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} className="markdown-table-scroll">
          <table>
            <thead>
              <tr>{header.map((cell, cellIndex) => <th key={`h-${cellIndex}`}>{renderInline(cell, `th-${cellIndex}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => <td key={`c-${cellIndex}`}>{renderInline(cell, `td-${rowIndex}-${cellIndex}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `ul-${index}-${itemIndex}`)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `ol-${index}-${itemIndex}`)}</li>)}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (
        !next ||
        isGeneratedMarker(next) ||
        next.startsWith("#") ||
        next.startsWith("```") ||
        next.startsWith("|") ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next)
      ) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(" "), `p-${index}`)}</p>);
  }

  return blocks;
}
