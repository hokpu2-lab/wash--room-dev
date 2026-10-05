import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  completeCentralSsoBinding,
  hasEligibleSsoMembership,
  parseAcceptedCentralSsoResponse,
  resolveSsoFlow,
  signSsoBindingState,
  signSsoSessionMarker,
  verifyCentralSsoTicket,
  verifySsoBindingState,
  verifySsoSessionMarker,
} from "../../src/lib/auth/sso";

const profileId = "10000000-0000-4000-8000-000000000001";

describe("中央 SSO 合約", () => {
  it("只接受 HTTP 200 且 ok=true 的中央驗證結果", () => {
    expect(
      parseAcceptedCentralSsoResponse(200, {
        ok: true,
        data: { localUserId: profileId, email: "worker@example.com" },
      }),
    ).toEqual({ localUserId: profileId, email: "worker@example.com" });

    expect(parseAcceptedCentralSsoResponse(200, { ok: false, error: "expired" })).toBeNull();
    expect(parseAcceptedCentralSsoResponse(201, { ok: true, localUserId: profileId })).toBeNull();
    expect(parseAcceptedCentralSsoResponse(200, { ok: true })).toBeNull();
  });

  it("省略 flow 預設登入，未知 flow 直接拒絕", () => {
    expect(resolveSsoFlow(undefined, undefined)).toBe("login");
    expect(resolveSsoFlow("account_binding", undefined)).toBe("account_binding");
    expect(resolveSsoFlow(undefined, "account_binding")).toBe("account_binding");
    expect(() => resolveSsoFlow("login", "account_binding")).toThrow("invalid_sso_flow");
    expect(() => resolveSsoFlow("unexpected", undefined)).toThrow("invalid_sso_flow");
  });

  it("送洗機構主管會依機構的母據點判定有效 scope", () => {
    const institutionId = "30000000-0000-4000-8000-000000000001";
    const now = Date.parse("2026-09-16T00:00:00.000Z");
    const membership = {
      role: "institution_supervisor" as const,
      active: true,
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: null,
      operating_site_id: null,
      institution_id: institutionId,
    };

    expect(
      hasEligibleSsoMembership(
        [membership],
        new Set(),
        new Set([institutionId]),
        now,
      ),
    ).toBe(true);
    expect(
      hasEligibleSsoMembership([membership], new Set(), new Set(), now),
    ).toBe(false);
  });

  it("中央驗證只呼叫 verify API，並傳送 systemCode", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBe(
        "https://jyecltijflcplhzjoelh.supabase.co/functions/v1/verify-sso-ticket",
      );
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ ticket: "ticket-1", systemCode: "wash" }));
      return new Response(JSON.stringify({ ok: true, localUserId: profileId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(verifyCentralSsoTicket("ticket-1", "wash", fetchImplementation)).resolves.toEqual({
      localUserId: profileId,
    });
  });

  it("binding 狀態 cookie 可驗證、篡改或逾期即失效", () => {
    const secret = "test-secret";
    const signed = signSsoBindingState(
      {
        ticket: "binding-ticket",
        systemCode: "wash",
        flow: "account_binding",
        expiresAt: 2_000,
        nonce: "1234567890abcdef",
      },
      secret,
    );

    expect(verifySsoBindingState(signed, secret, 1_000)).toMatchObject({
      ticket: "binding-ticket",
      systemCode: "wash",
      flow: "account_binding",
    });
    expect(verifySsoBindingState(`${signed}tampered`, secret, 1_000)).toBeNull();
    expect(verifySsoBindingState(signed, secret, 2_000)).toBeNull();
  });

  it("SSO marker 的簽章會在密鑰輪替或逾期後失效", () => {
    const signed = signSsoSessionMarker(
      {
        profileId,
        authUserId: "20000000-0000-4000-8000-000000000001",
        issuedAt: 1_000,
        expiresAt: 2_000,
        nonce: "1234567890abcdef",
      },
      "service-role-derived-secret",
    );

    expect(verifySsoSessionMarker(signed, "service-role-derived-secret", 1_500)).not.toBeNull();
    expect(verifySsoSessionMarker(signed, "rotated-service-role-secret", 1_500)).toBeNull();
    expect(verifySsoSessionMarker(signed, "service-role-derived-secret", 2_000)).toBeNull();
  });

  it("binding 只呼叫 binding API，拒絕非 200 或 ok=false", async () => {
    const account = {
      profileId,
      authUserId: "20000000-0000-4000-8000-000000000001",
      authEmail: "worker@auth.wash-room.invalid",
      loginName: "WorkerA",
      localEmail: "worker@example.com",
      localEmployeeNo: null,
      displayName: "Worker A",
    };
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBe(
        "https://jyecltijflcplhzjoelh.supabase.co/functions/v1/complete-account-binding",
      );
      expect(init?.body).toBe(
        JSON.stringify({
          ticket: "binding-ticket",
          systemCode: "wash",
          localUserId: profileId,
          localLogin: "WorkerA",
          localEmail: "worker@example.com",
          localEmployeeNo: null,
          displayName: "Worker A",
          localActive: true,
        }),
      );
      return new Response(JSON.stringify({ ok: true, pending_review: true }), { status: 200 });
    });

    await expect(
      completeCentralSsoBinding("binding-ticket", account, fetchImplementation),
    ).resolves.toBe("pending_review");

    await expect(
      completeCentralSsoBinding(
        "binding-ticket",
        account,
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    ).resolves.toBe("completed");

    await expect(
      completeCentralSsoBinding(
        "binding-ticket",
        account,
        async () => new Response(JSON.stringify({ pending_review: true }), { status: 200 }),
      ),
    ).resolves.toBe("pending_review");

    await expect(
      completeCentralSsoBinding(
        "binding-ticket",
        account,
        async () => new Response(JSON.stringify({ ok: true }), { status: 201 }),
      ),
    ).rejects.toThrow("sso_binding_failed");

    await expect(
      completeCentralSsoBinding(
        "binding-ticket",
        account,
        async () => new Response(JSON.stringify({ ok: false }), { status: 200 }),
      ),
    ).rejects.toThrow("sso_binding_failed");
  });
});
