import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

export type SystemGuideDocument = {
  id: "user" | "admin" | "agent";
  label: string;
  description: string;
  source: string;
};

const documentDefinitions = [
  {
    id: "user",
    label: "使用者操作",
    description: "登入、掃碼、作業流程與常見問題",
    fileName: "user-guide.md",
  },
  {
    id: "admin",
    label: "管理者設定",
    description: "帳號、主檔、程序、設備、通知與 BI",
    fileName: "admin-guide.md",
  },
  {
    id: "agent",
    label: "AI Agent 交接",
    description: "架構、安全邊界、測試、部署與風險",
    fileName: "agent-guide.md",
  },
] as const;

let productionDocuments: Promise<SystemGuideDocument[]> | undefined;

async function readDocuments(): Promise<SystemGuideDocument[]> {
  const guideRoot = path.join(process.cwd(), "docs", "system-guide");
  return Promise.all(
    documentDefinitions.map(async (definition) => ({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      source: await readFile(path.join(guideRoot, definition.fileName), "utf8"),
    })),
  );
}

export function loadSystemGuideDocuments() {
  if (process.env.NODE_ENV === "development") {
    return readDocuments();
  }
  productionDocuments ??= readDocuments();
  return productionDocuments;
}
