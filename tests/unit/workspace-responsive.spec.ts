import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("主工作區介面大小與畫面比例自適應響應式設計 (Workspace Responsive Layout)", () => {
  const root = process.cwd();

  it("workspace-shell.module.css 中的 .content > main 不應寫死固定 1340px，應支援 100% 隨畫面比例擴展", () => {
    const cssPath = resolve(root, "src/app/app/workspace-shell.module.css");
    const content = readFileSync(cssPath, "utf-8");

    // 不應存在寫死 1340px 限制主工作區
    expect(content).not.toContain("max-width: 1340px;");

    // .content > main 應設定為 100% 寬度自適應
    expect(content).toMatch(/\.content\s*>\s*main\s*\{[^}]*width:\s*100%;/);
    expect(content).toMatch(/\.content\s*>\s*main\s*\{[^}]*max-width:\s*100%;/);
  });

  it("workspace-shell.module.css 中的 .content 應採用流體 clamp 內距，確保不同螢幕比例下的舒適邊界", () => {
    const cssPath = resolve(root, "src/app/app/workspace-shell.module.css");
    const content = readFileSync(cssPath, "utf-8");

    expect(content).toMatch(/\.content\s*\{[^}]*padding:\s*clamp\(/);
    expect(content).toMatch(/\.content\s*\{[^}]*width:\s*100%;/);
  });

  it("ssoFlashNotice 應隨主工作區寬度自適應 100%", () => {
    const cssPath = resolve(root, "src/app/app/workspace-shell.module.css");
    const content = readFileSync(cssPath, "utf-8");

    expect(content).toMatch(/\.ssoFlashNotice\s*\{[^}]*width:\s*100%;/);
    expect(content).toMatch(/\.ssoFlashNotice\s*\{[^}]*max-width:\s*100%;/);
  });

  it("system-guide 說明文件頁面容器應隨畫面比例支援 100% 自適應展開", () => {
    const adminGuideCss = resolve(root, "src/app/app/admin/system-guide/system-guide.module.css");
    const adminGuideContent = readFileSync(adminGuideCss, "utf-8");
    expect(adminGuideContent).not.toContain("max-width: 1280px;");
    expect(adminGuideContent).toContain("max-width: 100%;");

    const guideCss = resolve(root, "src/app/app/system-guide/system-guide.module.css");
    const guideContent = readFileSync(guideCss, "utf-8");
    expect(guideContent).not.toContain("width: min(100%, 1180px);");
    expect(guideContent).toContain("width: 100%; max-width: 100%;");
  });
});
