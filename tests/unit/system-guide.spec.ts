import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractSections,
  GUIDE_DOCUMENTS,
} from "../../src/app/app/admin/system-guide/system-guide-data";

describe("系統說明 (System Guide) 規格與資料完整性驗證", () => {
  it("三份核心手冊與索引 Markdown 文件皆已存在於 docs/system-guide/ 且格式合規", () => {
    const root = process.cwd();
    const files = [
      "docs/system-guide/README.md",
      "docs/system-guide/user-guide.md",
      "docs/system-guide/admin-guide.md",
      "docs/system-guide/agent-guide.md",
    ];

    for (const file of files) {
      const fullPath = resolve(root, file);
      expect(existsSync(fullPath), `檔案應存在: ${file}`).toBe(true);
      const content = readFileSync(fullPath, "utf-8");
      expect(content).toContain("<!-- SYSTEM-GUIDE:GENERATED:START -->");
      expect(content).toContain("<!-- SYSTEM-GUIDE:GENERATED:END -->");
    }
  });

  it("GUIDE_DOCUMENTS 正確定義三份指南並解析出章節標題清單", () => {
    expect(GUIDE_DOCUMENTS).toHaveLength(3);

    const [userDoc, adminDoc, agentDoc] = GUIDE_DOCUMENTS;

    expect(userDoc.id).toBe("user");
    expect(userDoc.title).toBe("使用者操作說明");
    expect(userDoc.sections.length).toBeGreaterThan(0);

    expect(adminDoc.id).toBe("admin");
    expect(adminDoc.title).toBe("管理者設定說明");
    expect(adminDoc.sections.length).toBeGreaterThan(0);

    expect(agentDoc.id).toBe("agent");
    expect(agentDoc.title).toBe("AI Agent 技術交接說明");
    expect(agentDoc.sections.length).toBeGreaterThan(0);
  });

  it("extractSections 能正確擷取 Markdown 中的二級與三級標題", () => {
    const sampleMd = `
# 一級標題
## 1. 核心流程
### 1.1 掃碼收單
## 2. 機台操作
    `;
    const sections = extractSections(sampleMd);
    expect(sections).toHaveLength(3);
    expect(sections[0].title).toBe("1. 核心流程");
    expect(sections[0].level).toBe(2);
    expect(sections[1].title).toBe("1.1 掃碼收單");
    expect(sections[1].level).toBe(3);
    expect(sections[2].title).toBe("2. 機台操作");
    expect(sections[2].level).toBe(2);
  });
});

