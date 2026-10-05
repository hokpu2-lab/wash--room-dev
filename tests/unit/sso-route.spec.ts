import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearPendingSsoBinding: vi.fn(),
  completeCentralSsoBinding: vi.fn(),
  createTargetSsoSession: vi.fn(),
  parseSsoRequest: vi.fn(),
  resolveCurrentTargetSsoAccount: vi.fn(),
  resolveLocalSsoAccount: vi.fn(),
  savePendingSsoBinding: vi.fn(),
  saveSsoFlashMessage: vi.fn(),
  saveSsoSessionMarker: vi.fn(),
  verifyCentralSsoTicket: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/sso", () => ({
  ...mocks,
  SsoFlowError: class SsoFlowError extends Error {
    readonly code = "sso_verification_failed" as const;
  },
}));

import { GET } from "../../src/app/api/sso-login/route";

const account = {
  profileId: "10000000-0000-4000-8000-000000000001",
  authUserId: "20000000-0000-4000-8000-000000000001",
  authEmail: "worker@auth.wash-room.invalid",
  loginName: "WorkerA",
  localEmail: "worker@example.com",
  localEmployeeNo: null,
  displayName: "Worker A",
};

function locationOf(response: Response) {
  return new URL(response.headers.get("location") ?? "");
}

describe("SSO callback redirect contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("一般登入完成 Session 後直接進入 /app，不回登入頁", async () => {
    mocks.parseSsoRequest.mockResolvedValue({
      ticket: "fresh-login-ticket",
      systemCode: "wash",
      flow: "login",
    });
    mocks.verifyCentralSsoTicket.mockResolvedValue({
      localUserId: account.profileId,
    });
    mocks.resolveLocalSsoAccount.mockResolvedValue(account);

    const response = await GET(
      new Request("https://wash-room.vercel.app/api/sso-login"),
    );

    expect(response.status).toBe(303);
    expect(locationOf(response).pathname).toBe("/app");
    expect(locationOf(response).pathname).not.toBe("/login");
    expect(locationOf(response).searchParams.has("success")).toBe(false);
    expect(mocks.createTargetSsoSession).toHaveBeenCalledWith(account);
    expect(mocks.saveSsoSessionMarker).toHaveBeenCalledWith(account);
    expect(mocks.saveSsoFlashMessage).toHaveBeenCalledWith("login");
  });

  it("account binding 完成後也直接進入 /app", async () => {
    mocks.parseSsoRequest.mockResolvedValue({
      ticket: "fresh-binding-ticket",
      systemCode: "wash",
      flow: "account_binding",
    });
    mocks.resolveCurrentTargetSsoAccount.mockResolvedValue({ account });
    mocks.completeCentralSsoBinding.mockResolvedValue("completed");

    const response = await GET(
      new Request("https://wash-room.vercel.app/api/sso-login"),
    );

    expect(response.status).toBe(303);
    expect(locationOf(response).pathname).toBe("/app");
    expect(mocks.completeCentralSsoBinding).toHaveBeenCalledWith(
      "fresh-binding-ticket",
      account,
    );
    expect(mocks.saveSsoFlashMessage).toHaveBeenCalledWith("account_binding_complete");
    expect(mocks.verifyCentralSsoTicket).not.toHaveBeenCalled();
  });

  it("binding API 接受 pending_review 後仍進入 /app", async () => {
    mocks.parseSsoRequest.mockResolvedValue({
      ticket: "fresh-pending-review-ticket",
      systemCode: "wash",
      flow: "account_binding",
    });
    mocks.resolveCurrentTargetSsoAccount.mockResolvedValue({ account });
    mocks.completeCentralSsoBinding.mockResolvedValue("pending_review");

    const response = await GET(
      new Request("https://wash-room.vercel.app/api/sso-login"),
    );

    expect(response.status).toBe(303);
    expect(locationOf(response).pathname).toBe("/app");
    expect(locationOf(response).pathname).not.toBe("/login");
    expect(mocks.saveSsoFlashMessage).toHaveBeenCalledWith("account_binding_pending_review");
    expect(mocks.verifyCentralSsoTicket).not.toHaveBeenCalled();
  });

  it("未登入的 account binding 仍回到帶有 callback next 的登入頁", async () => {
    mocks.parseSsoRequest.mockResolvedValue({
      ticket: "fresh-binding-ticket",
      systemCode: "wash",
      flow: "account_binding",
    });
    mocks.resolveCurrentTargetSsoAccount.mockResolvedValue(null);

    const response = await GET(
      new Request("https://wash-room.vercel.app/api/sso-login"),
    );
    const location = locationOf(response);

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/api/sso-login");
    expect(mocks.savePendingSsoBinding).toHaveBeenCalledWith(
      "fresh-binding-ticket",
    );
  });
});
