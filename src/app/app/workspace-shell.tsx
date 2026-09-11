import { requirePrincipal } from "@/lib/auth/principal";
import { resolveWorkspaceScope, withWorkspaceScope } from "@/lib/auth/workspace-scope";

import { WorkspaceNavigation } from "./workspace-navigation";

export type WorkspaceLink = {
  href: string;
  label: string;
  description: string;
  group: "workspace" | "management";
  marker: string;
};

const supervisorLinks: WorkspaceLink[] = [
  { href: "/app/admin", label: "營運總覽", description: "今日 KPI 與主管控制", group: "workspace", marker: "總" },
  { href: "/app/dashboard", label: "洗衣單與批次", description: "待收件、處理中與待取件", group: "workspace", marker: "單" },
  { href: "/app/history", label: "已取件洗衣單", description: "查詢歷史取件紀錄", group: "workspace", marker: "歷" },
  { href: "/app/admin/laundry-equipment", label: "設備狀態", description: "設備能力、狀態與固定 QR", group: "workspace", marker: "機" },
  { href: "/app/admin/notifications", label: "異常與通知", description: "通知矩陣與外部目的地", group: "workspace", marker: "訊" },
  { href: "/app/admin/accounts", label: "帳號與權限", description: "帳號、角色、密碼與安全刪除", group: "management", marker: "人" },
  { href: "/app/admin/organizations", label: "送洗機構", description: "作業據點與固定配對", group: "management", marker: "構" },
  { href: "/app/admin/laundry-carts", label: "洗衣車與固定 QR", description: "資產建檔、啟停與重發", group: "management", marker: "車" },
  { href: "/app/admin/laundry-equipment", label: "洗衣設備與固定 QR", description: "消毒鍋、洗衣機與烘衣機", group: "management", marker: "備" },
  { href: "/app/admin/procedures", label: "程序範本", description: "分類、階段與版本發布", group: "management", marker: "程" },
  { href: "/app/admin/bi", label: "分析與 BI", description: "模型、報表、匯出與舊單匯入", group: "management", marker: "析" },
  { href: "/app/admin/system-guide", label: "系統說明", description: "使用手冊、管理設定與交接指南", group: "management", marker: "導" },
];

const workerLinks: WorkspaceLink[] = [
  { href: "/app/operations", label: "營運總覽", description: "授權據點與工作入口", group: "workspace", marker: "總" },
  { href: "/app/operations/receive", label: "收單與分類", description: "掃描洗衣車並建立批次", group: "workspace", marker: "收" },
  { href: "/app/operations/control-center", label: "洗衣單與批次", description: "批次控制、異常與重排", group: "workspace", marker: "單" },
  { href: "/app/history", label: "已取件洗衣單", description: "查詢歷史取件紀錄", group: "workspace", marker: "歷" },
  { href: "/app/operations/washing", label: "開始清洗", description: "掃描相容洗衣機", group: "management", marker: "洗" },
  { href: "/app/operations/disinfection", label: "消毒浸泡", description: "消毒分類必要控制點", group: "management", marker: "消" },
  { href: "/app/operations/drying", label: "清洗完成與烘乾", description: "完成清洗並啟動烘衣機", group: "management", marker: "烘" },
  { href: "/app/operations/split", label: "拆分必要批次", description: "依分類與程序拆分", group: "management", marker: "拆" },
];

const institutionLinks: WorkspaceLink[] = [
  { href: "/app/institution", label: "營運總覽", description: "本機構洗衣單與通知", group: "workspace", marker: "總" },
  { href: "/app/dashboard", label: "洗衣單與批次", description: "本機構進度與待取件", group: "workspace", marker: "單" },
  { href: "/app/history", label: "已取件洗衣單", description: "查詢本機構歷史取件", group: "workspace", marker: "歷" },
];

export async function WorkspaceShellNavigation() {
  const [principal, scope] = await Promise.all([requirePrincipal(), resolveWorkspaceScope()]);
  const activeScope = { siteId: scope.siteId, institutionId: scope.institutionId };
  const sites = Array.from(
    new Map(
      principal.memberships
        .filter((membership) => membership.operating_site_id)
        .map((membership) => [
          membership.operating_site_id!,
          {
            id: membership.operating_site_id!,
            name: membership.scope_name,
            code: membership.scope_code,
          },
        ]),
    ).values(),
  );
  const roles = new Set(principal.memberships.map((membership) => membership.role));
  const linkPool = [
    ...(roles.has("system_administrator") || roles.has("laundry_supervisor") ? supervisorLinks : []),
    ...(roles.has("laundry_worker") ? workerLinks : []),
    ...(roles.has("institution_supervisor") ? institutionLinks : []),
  ];
  const links = Array.from(
    new Map(
      linkPool.map((link) => [
        `${link.href}:${link.label}`,
        { ...link, href: withWorkspaceScope(link.href, activeScope) },
      ]),
    ).values(),
  );
  const scopes = principal.memberships.map((membership) => ({
    code: membership.scope_code,
    name: membership.scope_name,
    role: membership.role,
  }));

  return <WorkspaceNavigation links={links} scopes={scopes} sites={sites} />;
}
