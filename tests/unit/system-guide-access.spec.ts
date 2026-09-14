import { expect, test } from "vitest";

import { isSystemGuideAdministrator } from "../../src/lib/auth/system-guide-access";

test("系統說明只允許 admin 且具洗衣主管 membership", () => {
  expect(isSystemGuideAdministrator({
    loginName: "admin",
    memberships: [{ role: "laundry_supervisor" }],
  })).toBe(true);

  expect(isSystemGuideAdministrator({
    loginName: "admin",
    memberships: [{ role: "laundry_worker" }],
  })).toBe(false);

  expect(isSystemGuideAdministrator({
    loginName: "Admin",
    memberships: [{ role: "laundry_supervisor" }],
  })).toBe(false);
});
