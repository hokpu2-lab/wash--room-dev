"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import {
  GUIDE_DOCUMENTS,
  type GuideSection,
} from "./system-guide-data";
import styles from "./system-guide.module.css";

export function SystemGuideViewer() {
  const instanceId = useId().replaceAll(":", "");
  const [activeTab, setActiveTab] = useState<"user" | "admin" | "agent">("user");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedNotice, setCopiedNotice] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // 讀取 URL Hash 與 localStorage
  useEffect(() => {
    const validTabs: Array<"user" | "admin" | "agent"> = ["user", "admin", "agent"];
    const hash = window.location.hash.slice(1);
    const requested = new URLSearchParams(hash).get("tab") as "user" | "admin" | "agent" | null;
    const stored = window.localStorage.getItem("wash-room:system-guide:tab") as "user" | "admin" | "agent" | null;

    const initial = requested && validTabs.includes(requested) ? requested : stored && validTabs.includes(stored) ? stored : null;
    const timer = window.setTimeout(() => {
      if (initial) setActiveTab(initial);
    }, 0);

    const syncHash = () => {
      const next = new URLSearchParams(window.location.hash.slice(1)).get("tab") as "user" | "admin" | "agent" | null;
      if (next && validTabs.includes(next)) {
        setActiveTab(next);
      }
    };

    window.addEventListener("hashchange", syncHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", syncHash);
    };
  }, []);

  const switchTab = (tabId: "user" | "admin" | "agent") => {
    setActiveTab(tabId);
    window.localStorage.setItem("wash-room:system-guide:tab", tabId);
    const url = new URL(window.location.href);
    url.hash = new URLSearchParams({ tab: tabId }).toString();
    window.history.replaceState(window.history.state, "", url);
  };

  const currentDoc = useMemo(
    () => GUIDE_DOCUMENTS.find((d) => d.id === activeTab) || GUIDE_DOCUMENTS[0],
    [activeTab]
  );

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(currentDoc.rawMarkdown);
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 2500);
    } catch {
      // fallback
    }
  };

  return (
    <div className={styles.guideContainer}>
      {/* 頂部控制與導引區 */}
      <header className={styles.guideHeader}>
        <div className={styles.headerTop}>
          <div className={styles.headerTitleGroup}>
            <span className={styles.badge}>SYSTEM GUIDE</span>
            <h1>系統說明手冊</h1>
            <p>跨作業據點洗衣營運管理系統之操作手冊、管理設定與技術交接指南</p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={copyMarkdown}
              title="複製當前文件的 Markdown 原始內容"
            >
              <span aria-hidden="true">📋</span> 複製 Markdown
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => window.print()}
              title="列印當前手冊"
            >
              <span aria-hidden="true">🖨️</span> 列印手冊
            </button>
          </div>
        </div>

        {/* 秒開頁籤清單 */}
        <div
          role="tablist"
          aria-label="系統說明類別"
          style={{
            display: "flex",
            gap: "8px",
            borderBottom: "1px solid var(--line, #e2e8f0)",
            paddingBottom: "12px",
            overflowX: "auto",
          }}
        >
          {GUIDE_DOCUMENTS.map((doc) => {
            const isSelected = activeTab === doc.id;
            return (
              <button
                key={doc.id}
                ref={(el) => {
                  tabRefs.current[doc.id] = el;
                }}
                id={`${instanceId}-tab-${doc.id}`}
                role="tab"
                type="button"
                aria-selected={isSelected}
                aria-controls={`${instanceId}-panel-${doc.id}`}
                onClick={() => switchTab(doc.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 18px",
                  borderRadius: "12px",
                  border: isSelected
                    ? "1px solid var(--teal, #0f766e)"
                    : "1px solid var(--line, #e2e8f0)",
                  background: isSelected ? "var(--teal, #0f766e)" : "white",
                  color: isSelected ? "white" : "var(--ink, #1e293b)",
                  fontWeight: isSelected ? 700 : 600,
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: isSelected ? "0 4px 12px rgba(15, 118, 110, 0.2)" : "none",
                }}
              >
                <span>{doc.badge}</span>
                <small style={{ opacity: isSelected ? 0.9 : 0.65 }}>({doc.audience})</small>
              </button>
            );
          })}
        </div>

        {/* 搜尋列 */}
        <div className={styles.searchBar}>
          <span className={styles.searchIcon} aria-hidden="true">
            🔍
          </span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={`在 ${currentDoc.title} 中即時搜尋關鍵字...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* 文檔元資訊卡片 */}
        <div className={styles.docMetaCard}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>目標對象</span>
            <span className={styles.metaValue}>{currentDoc.audience}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>手冊版本</span>
            <span className={styles.metaValue}>{currentDoc.version}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>最後更新</span>
            <span className={styles.metaValue}>{currentDoc.updateDate}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>章節數量</span>
            <span className={styles.metaValue}>{currentDoc.sections.length} 個重點章節</span>
          </div>
        </div>

        {/* 目錄快速導航 (ToC) */}
        {currentDoc.sections.length > 0 && !searchQuery && (
          <nav className={styles.tocSection} aria-label="本頁章節導航">
            <span className={styles.tocTitle}>快速跳轉章節 (TABLE OF CONTENTS)</span>
            <div className={styles.tocPills}>
              {currentDoc.sections.map((sec) => (
                <a key={sec.id} href={`#${sec.id}`} className={styles.tocPill}>
                  {sec.title}
                </a>
              ))}
            </div>
          </nav>
        )}
      </header>

      {/* 主要內容卡片 */}
      <main
        id={`${instanceId}-panel-${currentDoc.id}`}
        role="tabpanel"
        aria-labelledby={`${instanceId}-tab-${currentDoc.id}`}
        className={styles.contentCard}
      >
        <MarkdownRenderer
          markdown={currentDoc.rawMarkdown}
          sections={currentDoc.sections}
          searchQuery={searchQuery}
        />
      </main>

      {/* 複製成功提示 Toast */}
      {copiedNotice && (
        <div className={styles.copySuccessNotice} role="status">
          ✓ 已複製「{currentDoc.title}」之 Markdown 內容至剪貼簿！
        </div>
      )}
    </div>
  );
}

// 輕量、高效、安全的 Markdown 解析渲染器
function MarkdownRenderer({
  markdown,
  sections,
  searchQuery,
}: {
  markdown: string;
  sections: GuideSection[];
  searchQuery: string;
}) {
  const renderedContent = useMemo(() => {
    const lines = markdown.split("\n");
    const elements: ReactNode[] = [];
    let lineIdx = 0;
    let sectionIdx = 0;

    const normalizedQuery = searchQuery.trim().toLowerCase();

    // 關鍵字高亮輔助
    const highlightText = (text: string): ReactNode => {
      if (!normalizedQuery) return text;
      const parts = text.split(new RegExp(`(${escapeRegExp(normalizedQuery)})`, "gi"));
      return parts.map((part, i) =>
        part.toLowerCase() === normalizedQuery.toLowerCase() ? (
          <mark key={i} className={styles.searchHighlight}>
            {part}
          </mark>
        ) : (
          part
        )
      );
    };

    // 行內元素解析 (代碼、粗體、連結)
    const parseInline = (text: string): ReactNode => {
      const segments: ReactNode[] = [];
      let lastIndex = 0;
      // 處理粗體與代碼
      const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
      let match: RegExpExecArray | null;

      while ((match = tokenRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          segments.push(highlightText(text.slice(lastIndex, match.index)));
        }
        const token = match[0];
        if (token.startsWith("`")) {
          segments.push(
            <code key={`code-${match.index}`} className={styles.inlineCode}>
              {highlightText(token.slice(1, -1))}
            </code>
          );
        } else if (token.startsWith("**")) {
          segments.push(
            <strong key={`bold-${match.index}`}>
              {highlightText(token.slice(2, -2))}
            </strong>
          );
        } else if (token.startsWith("[")) {
          const lMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
          if (lMatch) {
            segments.push(
              <a
                key={`link-${match.index}`}
                href={lMatch[2]}
                style={{ color: "var(--teal, #0f766e)", textDecoration: "underline" }}
              >
                {highlightText(lMatch[1])}
              </a>
            );
          }
        }
        lastIndex = match.index + token.length;
      }

      if (lastIndex < text.length) {
        segments.push(highlightText(text.slice(lastIndex)));
      }

      return segments.length > 0 ? segments : highlightText(text);
    };

    while (lineIdx < lines.length) {
      const line = lines[lineIdx];

      // 略過空行
      if (!line.trim()) {
        lineIdx++;
        continue;
      }

      // 略過自動產生標籤
      if (line.includes("<!-- SYSTEM-GUIDE")) {
        lineIdx++;
        continue;
      }

      // 標題 1
      if (line.startsWith("# ")) {
        elements.push(
          <h1 key={`h1-${lineIdx}`}>
            {parseInline(line.replace(/^#\s+/, ""))}
          </h1>
        );
        lineIdx++;
        continue;
      }

      // 標題 2
      if (line.startsWith("## ")) {
        const sec = sections[sectionIdx++];
        const id = sec ? sec.id : `heading-${lineIdx}`;
        elements.push(
          <h2 key={`h2-${lineIdx}`} id={id}>
            <a href={`#${id}`} style={{ color: "inherit", textDecoration: "none" }}>
              {parseInline(line.replace(/^##\s+/, ""))}
            </a>
          </h2>
        );
        lineIdx++;
        continue;
      }

      // 標題 3
      if (line.startsWith("### ")) {
        elements.push(
          <h3 key={`h3-${lineIdx}`}>
            {parseInline(line.replace(/^###\s+/, ""))}
          </h3>
        );
        lineIdx++;
        continue;
      }

      // 標題 4
      if (line.startsWith("#### ")) {
        elements.push(
          <h4 key={`h4-${lineIdx}`}>
            {parseInline(line.replace(/^####\s+/, ""))}
          </h4>
        );
        lineIdx++;
        continue;
      }

      // 分隔線
      if (line.trim() === "---") {
        elements.push(<hr key={`hr-${lineIdx}`} />);
        lineIdx++;
        continue;
      }

      // GitHub Alert (引用方塊)
      if (line.startsWith("> [!")) {
        const alertTypeMatch = line.match(/^>\s*\[!(NOTE|IMPORTANT|TIP|WARNING)\]/);
        const alertType = alertTypeMatch ? alertTypeMatch[1] : "NOTE";
        const alertLines: string[] = [];
        lineIdx++;

        while (lineIdx < lines.length && lines[lineIdx].startsWith(">")) {
          alertLines.push(lines[lineIdx].replace(/^>\s*/, ""));
          lineIdx++;
        }

        const alertStyle =
          alertType === "IMPORTANT"
            ? styles.alertImportant
            : alertType === "TIP"
            ? styles.alertTip
            : alertType === "WARNING"
            ? styles.alertWarning
            : styles.alertNote;

        const alertIcon =
          alertType === "IMPORTANT"
            ? "⚠️"
            : alertType === "TIP"
            ? "💡"
            : alertType === "WARNING"
            ? "⚡"
            : "ℹ️";

        elements.push(
          <div key={`alert-${lineIdx}`} className={`${styles.alertBox} ${alertStyle}`}>
            <span className={styles.alertIcon} aria-hidden="true">
              {alertIcon}
            </span>
            <div>
              <strong style={{ display: "block", marginBottom: "4px" }}>
                {alertType}
              </strong>
              {alertLines.map((aLine, aIdx) => (
                <p key={aIdx} style={{ margin: "2px 0" }}>
                  {parseInline(aLine)}
                </p>
              ))}
            </div>
          </div>
        );
        continue;
      }

      // 代碼區塊
      if (line.startsWith("```")) {
        const lang = line.slice(3).trim();
        const codeLines: string[] = [];
        lineIdx++;

        while (lineIdx < lines.length && !lines[lineIdx].startsWith("```")) {
          codeLines.push(lines[lineIdx]);
          lineIdx++;
        }
        lineIdx++; // 跳過結尾 ```

        elements.push(
          <div key={`codeblock-${lineIdx}`} className={styles.codeBlock}>
            <div className={styles.codeBlockHeader}>
              <span>{lang || "CODE"}</span>
              <span>READONLY</span>
            </div>
            <pre style={{ margin: 0 }}>
              <code>{codeLines.join("\n")}</code>
            </pre>
          </div>
        );
        continue;
      }

      // 表格
      if (line.startsWith("|")) {
        const tableLines: string[] = [];
        while (lineIdx < lines.length && lines[lineIdx].startsWith("|")) {
          tableLines.push(lines[lineIdx]);
          lineIdx++;
        }

        if (tableLines.length >= 2) {
          const headerCells = tableLines[0]
            .split("|")
            .map((c) => c.trim())
            .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
          // tableLines[1] 為分隔線 | :--- | :--- |
          const bodyRows = tableLines.slice(2).map((row) =>
            row
              .split("|")
              .map((c) => c.trim())
              .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
          );

          elements.push(
            <div key={`table-${lineIdx}`} style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    {headerCells.map((th, thIdx) => (
                      <th key={thIdx}>{parseInline(th)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((td, tdIdx) => (
                        <td key={tdIdx}>{parseInline(td)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          continue;
        }
      }

      // 清單
      if (line.startsWith("- ") || line.startsWith("* ")) {
        const listItems: string[] = [];
        while (
          lineIdx < lines.length &&
          (lines[lineIdx].startsWith("- ") || lines[lineIdx].startsWith("* "))
        ) {
          listItems.push(lines[lineIdx].replace(/^[-*]\s+/, ""));
          lineIdx++;
        }

        elements.push(
          <ul key={`ul-${lineIdx}`}>
            {listItems.map((item, iIdx) => (
              <li key={iIdx}>{parseInline(item)}</li>
            ))}
          </ul>
        );
        continue;
      }

      // 有序清單
      if (/^\d+\.\s+/.test(line)) {
        const listItems: string[] = [];
        while (lineIdx < lines.length && /^\d+\.\s+/.test(lines[lineIdx])) {
          listItems.push(lines[lineIdx].replace(/^\d+\.\s+/, ""));
          lineIdx++;
        }

        elements.push(
          <ol key={`ol-${lineIdx}`}>
            {listItems.map((item, iIdx) => (
              <li key={iIdx}>{parseInline(item)}</li>
            ))}
          </ol>
        );
        continue;
      }

      // 一般段落
      elements.push(
        <p key={`p-${lineIdx}`}>
          {parseInline(line)}
        </p>
      );
      lineIdx++;
    }

    return elements;
  }, [markdown, sections, searchQuery]);

  return <div className={styles.markdownBody}>{renderedContent}</div>;
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
