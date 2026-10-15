import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let mockPrincipalState: any = { kind: "anonymous" };

vi.mock("@/lib/auth/principal", () => ({
  getPrincipalState: vi.fn(async () => mockPrincipalState),
}));

import { WorkspaceUserBadge } from "../../src/app/app/workspace-user-badge";

describe("WorkspaceUserBadge 登入者帳號名稱與顯示名稱元件", () => {
  it("未授權或訪客狀態時不顯示帳號徽章 (回傳 null)", async () => {
    mockPrincipalState = { kind: "anonymous" };
    const result = await WorkspaceUserBadge();
    expect(result).toBeNull();

    mockPrincipalState = { kind: "denied" };
    const deniedResult = await WorkspaceUserBadge();
    expect(deniedResult).toBeNull();
  });

  it("已授權且具有 loginName 與 displayName 時正確渲染帳號與顯示名稱", async () => {
    mockPrincipalState = {
      kind: "authorized",
      principal: {
        loginName: "supervisor",
        displayName: "王小明",
        memberships: [
          {
            membership_id: "00000000-0000-0000-0000-000000000001",
            role: "laundry_supervisor",
            scope_code: "HQ",
            scope_name: "總部洗衣房",
            operating_site_id: "10000000-0000-0000-0000-000000000001",
            institution_id: null,
          },
        ],
      },
    };

    const element = await WorkspaceUserBadge();
    expect(element).not.toBeNull();
    expect(element?.props["data-testid"]).toBe("workspace-user-badge");
    expect(element?.props.title).toBe("目前登入帳號：supervisor (王小明)");
    expect(element?.props["aria-label"]).toBe("目前登入帳號：supervisor，顯示名稱：王小明");

    // Children: icon, userName span, userDisplayName span
    const [icon, nameSpan, displayNameSpan] = element?.props.children;
    expect(icon.props.children).toBe("👤");
    expect(nameSpan.props.children).toBe("supervisor");
    expect(displayNameSpan.props.children).toBe("(王小明)");
  });

  it("若 displayName 與 loginName 相同時不重複顯示顯示名稱括號", async () => {
    mockPrincipalState = {
      kind: "authorized",
      principal: {
        loginName: "admin",
        displayName: "admin",
        memberships: [],
      },
    };

    const element = await WorkspaceUserBadge();
    expect(element).not.toBeNull();
    expect(element?.props.title).toBe("目前登入帳號：admin");
    const [icon, nameSpan, displayNameSpan] = element?.props.children;
    expect(icon.props.children).toBe("👤");
    expect(nameSpan.props.children).toBe("admin");
    expect(displayNameSpan).toBeNull();
  });

  it("若 displayName 缺失時只呈現 loginName", async () => {
    mockPrincipalState = {
      kind: "authorized",
      principal: {
        loginName: "operator",
        displayName: null,
        memberships: [],
      },
    };

    const element = await WorkspaceUserBadge();
    expect(element).not.toBeNull();
    expect(element?.props.title).toBe("目前登入帳號：operator");
    const [, nameSpan, displayNameSpan] = element?.props.children;
    expect(nameSpan.props.children).toBe("operator");
    expect(displayNameSpan).toBeNull();
  });

  it("若 loginName 與 displayName 含有首尾空白字元應自動修剪 (trim)", async () => {
    mockPrincipalState = {
      kind: "authorized",
      principal: {
        loginName: "  admin_user  ",
        displayName: "  系統管理者  ",
        memberships: [],
      },
    };

    const element = await WorkspaceUserBadge();
    expect(element).not.toBeNull();
    const [, nameSpan, displayNameSpan] = element?.props.children;
    expect(nameSpan.props.children).toBe("admin_user");
    expect(displayNameSpan.props.children).toBe("(系統管理者)");
  });

  it("若 loginName 缺失時容錯回退至 membership 範圍名稱", async () => {
    mockPrincipalState = {
      kind: "authorized",
      principal: {
        loginName: undefined,
        displayName: "組長",
        memberships: [
          {
            membership_id: "00000000-0000-0000-0000-000000000002",
            role: "laundry_worker",
            scope_code: "BRANCH_1",
            scope_name: "一廠洗滌組",
            operating_site_id: "10000000-0000-0000-0000-000000000002",
            institution_id: null,
          },
        ],
      },
    };

    const element = await WorkspaceUserBadge();
    expect(element).not.toBeNull();
    const [, nameSpan, displayNameSpan] = element?.props.children;
    expect(nameSpan.props.children).toBe("一廠洗滌組");
    expect(displayNameSpan.props.children).toBe("(組長)");
  });

  it("若 loginName 與 membership 範圍皆為空時回傳 null", async () => {
    mockPrincipalState = {
      kind: "authorized",
      principal: {
        loginName: "   ",
        displayName: "孤立名稱",
        memberships: [],
      },
    };

    const element = await WorkspaceUserBadge();
    expect(element).toBeNull();
  });
});
