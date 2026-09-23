import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = 54390;
const userId = "10000000-0000-4000-8000-000000000099";
const userEmail = "admin@auth.wash-room.invalid";
const serviceRoleKey = "sb_service_role_test_key";
let userPassword = "Temporary-Admin-42!";
let mode = "boundary";
let lastAuthRequest = null;
let lastAccessChange = null;
let lastInstitutionChange = null;
let lastLaundryCartChange = null;
let lastLaundryEquipmentChange = null;
let lastOperationReversal = null;
let organizationChangeRequests = new Map();
let laundryCartChangeRequests = new Map();
let procedureChangeRequests = new Map();
let applicationRequestCounts = new Map();
let lastManagedAccountChange = null;

const authorizedModes = new Set([
  "allowed",
  "supervisor",
  "supervisor-pickup",
  "supervisor-history",
  "organization-supervisor",
  "institution",
  "multi",
  "password-change-required",
]);

const organizationSites = [
  {
    id: "20000000-0000-4000-8000-000000000099",
    code: "MAIN",
    name: "本館",
    active: true,
  },
  {
    id: "20000000-0000-4000-8000-000000000098",
    code: "CORP",
    name: "法人",
    active: true,
  },
];

const defaultManagedAccounts = [
  {
    profile_id: "42000000-0000-4000-8000-000000000099",
    login_name: "admin",
    display_name: "系統管理者",
    notification_email: "admin@example.test",
    account_active: true,
    must_change_password: false,
    deleted_at: null,
    auth_identity_configured: true,
    is_current_account: true,
    memberships: [
      {
        membership_id: "52000000-0000-4000-8000-000000000099",
        role: "laundry_supervisor",
        site_code: "MAIN",
        site_name: "本館",
        institution_code: null,
        institution_name: null,
        active: true,
      },
    ],
  },
  {
    profile_id: "42000000-0000-4000-8000-000000000098",
    login_name: "existing.worker",
    display_name: "既有洗衣員",
    notification_email: "worker@example.test",
    account_active: true,
    must_change_password: false,
    deleted_at: null,
    auth_identity_configured: true,
    is_current_account: false,
    memberships: [
      {
        membership_id: "52000000-0000-4000-8000-000000000098",
        role: "laundry_worker",
        site_code: "MAIN",
        site_name: "本館",
        institution_code: null,
        institution_name: null,
        active: true,
      },
    ],
  },
];
let managedAccounts = structuredClone(defaultManagedAccounts);
let managedAuthUsers = new Map([
  [userId, { id: userId, email: userEmail, password: userPassword }],
  [
    "11000000-0000-4000-8000-000000000098",
    {
      id: "11000000-0000-4000-8000-000000000098",
      email: "existing.worker@auth.wash-room.invalid",
      password: "Temporary-Worker-42!",
    },
  ],
]);
let managedProfileAuthIds = new Map([
  ["42000000-0000-4000-8000-000000000099", userId],
  [
    "42000000-0000-4000-8000-000000000098",
    "11000000-0000-4000-8000-000000000098",
  ],
]);

const defaultOrganizationInstitutions = [
  {
    id: "30000000-0000-4000-8000-000000000099",
    code: "CARE-A",
    name: "照護機構 A",
    active: true,
    operating_site_id: "20000000-0000-4000-8000-000000000099",
    operating_sites: { code: "MAIN", name: "本館" },
  },
  {
    id: "30000000-0000-4000-8000-000000000098",
    code: "CARE-CORP",
    name: "法人機構",
    active: true,
    operating_site_id: "20000000-0000-4000-8000-000000000098",
    operating_sites: { code: "CORP", name: "法人" },
  },
];
let organizationInstitutions = structuredClone(defaultOrganizationInstitutions);

const defaultLaundryCategories = [
  {
    id: "70000000-0000-4000-8000-000000000001",
    code: "DISINFECT",
    name: "消毒品",
    sort_order: 10,
    active: true,
  },
  {
    id: "70000000-0000-4000-8000-000000000002",
    code: "BIB",
    name: "圍兜",
    sort_order: 20,
    active: true,
  },
  {
    id: "70000000-0000-4000-8000-000000000003",
    code: "SOILED",
    name: "汙衣",
    sort_order: 30,
    active: true,
  },
  {
    id: "70000000-0000-4000-8000-000000000004",
    code: "CURTAIN",
    name: "床簾",
    sort_order: 40,
    active: true,
  },
  {
    id: "70000000-0000-4000-8000-000000000005",
    code: "OTHER",
    name: "其他",
    sort_order: 50,
    active: true,
  },
];
let laundryCategories = structuredClone(defaultLaundryCategories);
let procedureTemplates = [];
let procedureVersions = [];
let procedureStages = [];

const defaultLaundryCarts = [
  {
    id: "40000000-0000-4000-8000-000000000099",
    cart_number: "CART-MAIN-01",
    institution_id: "30000000-0000-4000-8000-000000000099",
    active: true,
    current_qr_version: 1,
    institutions: {
      code: "CARE-A",
      name: "照護機構 A",
      operating_sites: { code: "MAIN", name: "本館" },
    },
  },
  {
    id: "40000000-0000-4000-8000-000000000098",
    cart_number: "CART-CORP-01",
    institution_id: "30000000-0000-4000-8000-000000000098",
    active: true,
    current_qr_version: 1,
    institutions: {
      code: "CARE-CORP",
      name: "法人機構",
      operating_sites: { code: "CORP", name: "法人" },
    },
  },
];
let laundryCarts = structuredClone(defaultLaundryCarts);

function fakeLaundryCartQrToken(seed) {
  return `wrq_v1.${Buffer.alloc(32, seed).toString("base64url")}.${Buffer.alloc(32, seed + 1).toString("base64url")}`;
}

const defaultLaundryCartCredentials = new Map([
  [
    "40000000-0000-4000-8000-000000000099",
    { version: 1, token: fakeLaundryCartQrToken(11) },
  ],
  [
    "40000000-0000-4000-8000-000000000098",
    { version: 1, token: fakeLaundryCartQrToken(21) },
  ],
]);
let laundryCartCredentials = structuredClone(defaultLaundryCartCredentials);

const defaultLaundryEquipment = [
  {
    id: "41000000-0000-4000-8000-000000000099",
    name: "WASHER MAIN 01",
    equipment_type: "washer",
    capacity_kg: 1,
    status: "normal",
    occupied: false,
    current_qr_version: 1,
    operating_site_id: organizationSites[0].id,
    operating_sites: { code: "MAIN", name: "本館" },
  },
  {
    id: "41000000-0000-4000-8000-000000000098",
    name: "DRYER CORP 01",
    equipment_type: "dryer",
    capacity_kg: 1,
    status: "normal",
    occupied: false,
    current_qr_version: 1,
    operating_site_id: organizationSites[1].id,
    operating_sites: { code: "CORP", name: "法人" },
  },
];
let laundryEquipment = structuredClone(defaultLaundryEquipment);
let laundryEquipmentCredentials = new Map([
  [defaultLaundryEquipment[0].id, { version: 1, token: fakeLaundryCartQrToken(71) }],
  [defaultLaundryEquipment[1].id, { version: 1, token: fakeLaundryCartQrToken(81) }],
]);
let laundryEquipmentChangeRequests = new Map();
let laundryOrders = [];
let laundryOrderChangeRequests = new Map();
let laundryReceiptChangeRequests = new Map();
let laundryBatches = [];
let laundryStageChangeRequests = new Map();

function organizationSupervisorSiteCodes() {
  if (mode === "organization-supervisor") return new Set(["MAIN", "CORP"]);
  if (mode === "supervisor" || mode === "supervisor-pickup" || mode === "supervisor-history") return new Set(["MAIN"]);
  return new Set();
}

function accessContext() {
  if (mode === "supervisor" || mode === "supervisor-pickup" || mode === "supervisor-history") {
    return {
      role: "laundry_supervisor",
      operating_site_id: "20000000-0000-4000-8000-000000000099",
      institution_id: null,
      scope_code: "MAIN",
      scope_name: "本館",
    };
  }

  if (mode === "institution") {
    return {
      role: "institution_supervisor",
      operating_site_id: "20000000-0000-4000-8000-000000000099",
      institution_id: "30000000-0000-4000-8000-000000000099",
      scope_code: "CARE-A",
      scope_name: "照護機構 A",
    };
  }

  return {
    role: "laundry_worker",
    operating_site_id: "20000000-0000-4000-8000-000000000099",
    institution_id: null,
    scope_code: "MAIN",
    scope_name: "本館",
  };
}

function accessContexts() {
  if (mode === "organization-supervisor") {
    return organizationSites.map((site, index) => ({
      membership_id: `50000000-0000-4000-8000-00000000009${index.toString()}`,
      role: "laundry_supervisor",
      operating_site_id: site.id,
      institution_id: null,
      scope_code: site.code,
      scope_name: site.name,
    }));
  }

  if (mode === "multi") {
    return [
      {
        membership_id: "50000000-0000-4000-8000-000000000097",
        role: "laundry_worker",
        operating_site_id: "20000000-0000-4000-8000-000000000099",
        institution_id: null,
        scope_code: "MAIN",
        scope_name: "本館",
      },
      {
        membership_id: "50000000-0000-4000-8000-000000000096",
        role: "laundry_supervisor",
        operating_site_id: "20000000-0000-4000-8000-000000000099",
        institution_id: null,
        scope_code: "MAIN",
        scope_name: "本館",
      },
    ];
  }

  return [
    {
      membership_id: "50000000-0000-4000-8000-000000000099",
      ...accessContext(),
    },
  ];
}

function json(response, status, body) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function accessToken() {
  return [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({
      aud: "authenticated",
      email: userEmail,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      role: "authenticated",
      sub: userId,
    }),
    "fake-signature",
  ].join(".");
}

const fakeAccessToken = accessToken();

function hasSessionBearer(request) {
  return request.headers.authorization === `Bearer ${fakeAccessToken}`;
}

function requireSessionBearer(request, response) {
  if (hasSessionBearer(request)) return true;

  json(response, 401, { message: "missing or invalid session bearer" });
  return false;
}

function requireServiceBearer(request, response) {
  if (request.headers.authorization === `Bearer ${serviceRoleKey}`) return true;

  json(response, 401, { message: "missing or invalid service role bearer" });
  return false;
}

function managedAuthUser(user) {
  const timestamp = new Date().toISOString();
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: timestamp,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: user.user_metadata ?? {},
    identities: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function authUser() {
  return {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: userEmail,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (requestUrl.pathname === "/__test/health") {
    response.writeHead(200).end("ok");
    return;
  }

  if (request.method === "POST" && requestUrl.pathname.startsWith("/__test/mode/")) {
    mode = requestUrl.pathname.split("/").at(-1) ?? "boundary";
    userPassword = "Temporary-Admin-42!";
    lastAuthRequest = null;
    lastAccessChange = null;
    lastInstitutionChange = null;
    lastLaundryCartChange = null;
    lastLaundryEquipmentChange = null;
    lastOperationReversal = null;
    organizationChangeRequests = new Map();
    laundryCartChangeRequests = new Map();
    procedureChangeRequests = new Map();
    applicationRequestCounts = new Map();
    lastManagedAccountChange = null;
    managedAccounts = structuredClone(defaultManagedAccounts);
    managedAuthUsers = new Map([
      [userId, { id: userId, email: userEmail, password: userPassword }],
      [
        "11000000-0000-4000-8000-000000000098",
        {
          id: "11000000-0000-4000-8000-000000000098",
          email: "existing.worker@auth.wash-room.invalid",
          password: "Temporary-Worker-42!",
        },
      ],
    ]);
    managedProfileAuthIds = new Map([
      ["42000000-0000-4000-8000-000000000099", userId],
      [
        "42000000-0000-4000-8000-000000000098",
        "11000000-0000-4000-8000-000000000098",
      ],
    ]);
    organizationInstitutions = structuredClone(defaultOrganizationInstitutions);
    laundryCategories = structuredClone(defaultLaundryCategories);
    procedureTemplates = [];
    procedureVersions = [];
    procedureStages = [];
    laundryCarts = structuredClone(defaultLaundryCarts);
    laundryCartCredentials = structuredClone(defaultLaundryCartCredentials);
    laundryEquipment = structuredClone(defaultLaundryEquipment);
    laundryEquipmentCredentials = new Map([
      [defaultLaundryEquipment[0].id, { version: 1, token: fakeLaundryCartQrToken(71) }],
      [defaultLaundryEquipment[1].id, { version: 1, token: fakeLaundryCartQrToken(81) }],
    ]);
    laundryEquipmentChangeRequests = new Map();
    laundryOrders = [];
    if (mode === "allowed") {
      laundryOrders = [
        {
          id: "60000000-0000-4000-8000-000000000099",
          order_number: "MAIN-20260808-0001",
          laundry_cart_id: "40000000-0000-4000-8000-000000000099",
          status: "awaiting_receipt",
        },
      ];
      laundryBatches = [
        {
          id: "61000000-0000-4000-8000-000000000099",
          laundry_order_id: "60000000-0000-4000-8000-000000000099",
          status: "not_started",
          current_stage_order: 1,
          operating_site_id: "20000000-0000-4000-8000-000000000099",
          active_stage_run_id: null,
        },
      ];
    } else if (mode === "supervisor-pickup") {
      laundryOrders = [
        {
          id: "60000000-0000-4000-8000-000000000099",
          order_number: "MAIN-20260808-0001",
          laundry_cart_id: "40000000-0000-4000-8000-000000000099",
          status: "ready_for_pickup",
        },
      ];
      laundryBatches = [
        {
          id: "61000000-0000-4000-8000-000000000099",
          laundry_order_id: "60000000-0000-4000-8000-000000000099",
          status: "completed",
          current_stage_order: 1,
          operating_site_id: "20000000-0000-4000-8000-000000000099",
          active_stage_run_id: null,
        },
      ];
    } else if (mode === "supervisor-history") {
      laundryOrders = [
        {
          id: "60000000-0000-4000-8000-000000000097",
          order_number: "MAIN-20260818-0007",
          laundry_cart_id: "40000000-0000-4000-8000-000000000099",
          status: "picked_up",
          created_at: "2026-08-18T05:00:00.000Z",
          closed_at: "2026-08-18T08:00:00.000Z",
        },
      ];
      laundryBatches = [
        {
          id: "61000000-0000-4000-8000-000000000097",
          laundry_order_id: "60000000-0000-4000-8000-000000000097",
          status: "loaded",
          current_stage_order: 2,
          operating_site_id: "20000000-0000-4000-8000-000000000099",
          active_stage_run_id: null,
          batch_sequence: 1,
        },
      ];
    } else if (mode === "organization-supervisor") {
      laundryOrders = [
        {
          id: "60000000-0000-4000-8000-000000000099",
          order_number: "MAIN-20260808-0001",
          laundry_cart_id: "40000000-0000-4000-8000-000000000099",
          status: "awaiting_cleaning",
        },
        {
          id: "60000000-0000-4000-8000-000000000098",
          order_number: "CORP-20260808-0001",
          laundry_cart_id: "40000000-0000-4000-8000-000000000098",
          status: "awaiting_cleaning",
        },
      ];
      laundryBatches = [
        {
          id: "61000000-0000-4000-8000-000000000099",
          laundry_order_id: "60000000-0000-4000-8000-000000000099",
          status: "not_started",
          current_stage_order: 1,
          operating_site_id: "20000000-0000-4000-8000-000000000099",
          active_stage_run_id: null,
        },
        {
          id: "61000000-0000-4000-8000-000000000098",
          laundry_order_id: "60000000-0000-4000-8000-000000000098",
          status: "not_started",
          current_stage_order: 1,
          operating_site_id: "20000000-0000-4000-8000-000000000098",
          active_stage_run_id: null,
        },
      ];
    } else {
      laundryBatches = [];
    }
    laundryOrderChangeRequests = new Map();
    laundryReceiptChangeRequests = new Map();
    laundryStageChangeRequests = new Map();
    response.writeHead(204).end();
    return;
  }

  if (!requestUrl.pathname.startsWith("/__test/")) {
    const requestKey = `${request.method ?? "GET"} ${requestUrl.pathname}`;
    applicationRequestCounts.set(
      requestKey,
      (applicationRequestCounts.get(requestKey) ?? 0) + 1,
    );
  }

  if (request.method === "GET" && requestUrl.pathname === "/__test/request-counts") {
    json(response, 200, Object.fromEntries(applicationRequestCounts));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/__test/last-access-change") {
    json(response, lastAccessChange ? 200 : 404, lastAccessChange ?? {});
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/__test/last-auth-request") {
    json(response, lastAuthRequest ? 200 : 404, lastAuthRequest ?? {});
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/__test/managed-accounts") {
    json(response, 200, {
      accounts: managedAccounts,
      auth_users: [...managedAuthUsers.values()].map((user) => ({
        id: user.id,
        email: user.email,
        password: user.password,
      })),
      last_change: lastManagedAccountChange,
    });
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/__test/last-institution-change"
  ) {
    json(response, lastInstitutionChange ? 200 : 404, lastInstitutionChange ?? {});
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/__test/last-laundry-cart-change"
  ) {
    json(response, lastLaundryCartChange ? 200 : 404, lastLaundryCartChange ?? {});
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/__test/last-laundry-equipment-change"
  ) {
    json(response, lastLaundryEquipmentChange ? 200 : 404, lastLaundryEquipmentChange ?? {});
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/__test/last-operation-reversal"
  ) {
    json(response, lastOperationReversal ? 200 : 404, lastOperationReversal ?? {});
    return;
  }

  if (request.method === "GET" && requestUrl.pathname.startsWith("/__test/laundry-cart-token/")) {
    const cartId = requestUrl.pathname.split("/").at(-1);
    const credential = laundryCartCredentials.get(cartId);
    json(response, credential ? 200 : 404, credential ? { token: credential.token } : { message: "not found" });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname.startsWith("/__test/laundry-equipment-token/")) {
    const equipmentId = requestUrl.pathname.split("/").at(-1);
    const credential = laundryEquipmentCredentials.get(equipmentId);
    json(response, credential ? 200 : 404, credential ? { token: credential.token } : { message: "not found" });
    return;
  }

  if (requestUrl.pathname === "/auth/v1/authorize") {
    if (mode === "boundary") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<h1>Supabase OAuth boundary</h1>");
      return;
    }

    const callbackUrl = new URL(requestUrl.searchParams.get("redirect_to"));
    callbackUrl.searchParams.set("code", "fake-authorization-code");
    response.writeHead(302, { location: callbackUrl.toString() }).end();
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/auth/v1/token") {
    let tokenRequest;
    try {
      tokenRequest = await readJsonBody(request);
    } catch {
      json(response, 400, { message: "invalid token request" });
      return;
    }

    const grantType = requestUrl.searchParams.get("grant_type");
    const validPkceExchange =
      grantType === "pkce" &&
      tokenRequest.auth_code === "fake-authorization-code" &&
      typeof tokenRequest.code_verifier === "string" &&
      tokenRequest.code_verifier.length >= 43;
    const validRefresh =
      grantType === "refresh_token" &&
      tokenRequest.refresh_token === "fake-refresh-token";
    const validPassword =
      grantType === "password" &&
      tokenRequest.email === userEmail &&
      tokenRequest.password === userPassword;
    lastAuthRequest = {
      grant_type: grantType,
      email: typeof tokenRequest.email === "string" ? tokenRequest.email : null,
      password_accepted: validPassword,
    };

    if (!validPkceExchange && !validRefresh && !validPassword) {
      json(response, 400, { message: "invalid token grant" });
      return;
    }

    json(response, 200, {
      access_token: fakeAccessToken,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "fake-refresh-token",
      user: authUser(),
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/auth/v1/user") {
    if (!requireSessionBearer(request, response)) return;
    json(response, 200, authUser());
    return;
  }

  if (request.method === "PUT" && requestUrl.pathname === "/auth/v1/user") {
    if (!requireSessionBearer(request, response)) return;
    const update = await readJsonBody(request);
    if (
      typeof update.password !== "string" ||
      update.current_password !== userPassword
    ) {
      json(response, 400, { message: "invalid current password" });
      return;
    }
    userPassword = update.password;
    json(response, 200, authUser());
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/authorize_current_user"
  ) {
    if (!requireSessionBearer(request, response)) return;
    json(response, 200, [
      {
        authorized: authorizedModes.has(mode),
        denial_code: authorizedModes.has(mode) ? null : "not_authorized",
      },
    ]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/current_access_context"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!authorizedModes.has(mode)) {
      json(response, 200, []);
      return;
    }

    json(response, 200, accessContexts());
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/current_account_security_state"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!authorizedModes.has(mode)) {
      json(response, 200, []);
      return;
    }

    json(response, 200, [
      {
        login_name: "admin",
        password_change_required: mode === "password-change-required",
      },
    ]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/current_workspace_principal"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!authorizedModes.has(mode)) {
      json(response, 200, { kind: "denied" });
      return;
    }
    if (mode === "password-change-required") {
      json(response, 200, { kind: "password_change_required", login_name: "admin" });
      return;
    }
    json(response, 200, {
      kind: "authorized",
      login_name: "admin",
      memberships: accessContexts(),
    });
    return;
  }

  if (
    request.method === "POST" &&
    (requestUrl.pathname === "/rest/v1/rpc/get_workspace_snapshot_with_details" ||
      requestUrl.pathname === "/rest/v1/rpc/get_workspace_snapshot")
  ) {
    if (!requireSessionBearer(request, response)) return;
    const snapshotInput = await readJsonBody(request).catch(() => ({}));
    const targetSiteId =
      typeof snapshotInput.target_site_id === "string" ? snapshotInput.target_site_id : null;
    const siteOrders = laundryOrders.filter((order) => {
      if (order.status === "picked_up") return false;
      if (!targetSiteId) return true;
      const cart = laundryCarts.find((candidate) => candidate.id === order.laundry_cart_id);
      const siteCode = cart?.institutions?.operating_sites?.code;
      const site = organizationSites.find((candidate) => candidate.code === siteCode);
      return site?.id === targetSiteId;
    });
    const siteBatches = laundryBatches.filter((batch) => !targetSiteId || batch.operating_site_id === targetSiteId);
    const items = siteOrders
      .map((order) => {
        const cart = laundryCarts.find((candidate) => candidate.id === order.laundry_cart_id);
        return {
          id: order.id,
          order_number: order.order_number,
          status: order.status,
          updated_at: order.updated_at ?? "2026-08-18T00:00:00.000Z",
          institution_name: cart?.institutions?.name ?? "照護機構 A",
          cart_number: cart?.cart_number ?? "—",
        };
      });
    const orderDetails = siteOrders.map((order) => ({
      order_id: order.id,
      order_created_at: order.created_at ?? "2026-08-18T05:00:00.000Z",
      order_received_at: order.status === "awaiting_receipt" ? null : "2026-08-18T05:30:00.000Z",
      order_ready_at: order.status === "ready_for_pickup" || order.status === "picked_up"
        ? "2026-08-18T07:30:00.000Z"
        : null,
      order_closed_at: order.closed_at ?? null,
      batches: siteBatches
        .filter((batch) => batch.laundry_order_id === order.id)
        .map((batch) => {
          const complete = batch.status === "completed" || batch.status === "loaded";
          const active = Boolean(batch.active_stage_run_id);
          const equipment = laundryEquipment.find((item) => item.id === batch.active_equipment_id);
          return {
            id: batch.id,
            batch_sequence: batch.batch_sequence ?? 1,
            category_code: "SOILED",
            category_name: "汙衣",
            procedure_name: "加強洗烘",
            procedure_version: 2,
            status: batch.status,
            current_stage_order: batch.current_stage_order,
            active_equipment_name: equipment?.name ?? null,
            active_equipment_type: equipment?.equipment_type ?? null,
            progress: {
              stage_run_id: batch.active_stage_run_id ?? null,
              stage_status: batch.status === "paused" ? "paused" : active ? "in_progress" : complete ? "completed" : null,
              stage_progress_percent: complete ? 100 : active ? 48 : 0,
              overall_progress_percent: complete ? 100 : active ? 48 : 0,
              estimated_stage_completed_at: null,
              overdue_minutes: 0,
              total_standard_minutes: 45,
              is_estimate: true,
            },
            stages: [{
              stage_order: 1,
              name: "清洗",
              standard_minutes: 45,
              equipment_type: "washer",
              state: complete ? "completed" : active ? "active" : "pending",
              started_at: null,
              completed_at: null,
            }],
          };
        }),
    }));
    json(response, 200, {
      outcome: "ok",
      site_id: targetSiteId ?? "20000000-0000-4000-8000-000000000099",
      period: {
        start: "2026-08-18T00:00:00.000Z",
        end: "2026-08-18T23:59:59.000Z",
      },
      orders: {
        awaiting_receipt: siteOrders.filter((order) => order.status === "awaiting_receipt").length,
        in_process: siteOrders.filter((order) => order.status === "in_process" || order.status === "awaiting_cleaning").length,
        ready_for_pickup: siteOrders.filter((order) => order.status === "ready_for_pickup").length,
        picked_up: laundryOrders.filter((order) => order.status === "picked_up").length,
      },
      batches: {
        not_started: siteBatches.filter((batch) => batch.status === "not_started").length,
        in_progress: siteBatches.filter((batch) => batch.status === "in_progress").length,
        paused: siteBatches.filter((batch) => batch.status === "paused").length,
        completed: siteBatches.filter((batch) => batch.status === "completed").length,
      },
      queue: {
        total: items.length,
        limit: 20,
        offset: 0,
        items,
      },
      open_batches: siteBatches.map((batch) => {
        const order = laundryOrders.find((candidate) => candidate.id === batch.laundry_order_id);
        return {
          id: batch.id,
          status: batch.status,
          stage_order: batch.current_stage_order,
          order_number: order?.order_number ?? batch.id.slice(0, 8),
          category_name: "汙衣",
        };
      }),
      order_details: orderDetails,
      equipment: laundryEquipment
        .filter((item) => !targetSiteId || item.operating_site_id === targetSiteId)
        .map((item) => ({
        id: item.id,
        name: item.name,
        equipment_type: item.equipment_type,
        status: item.status,
        occupied: item.occupied,
      })),
      incidents: [],
      generated_at: "2026-08-18T00:00:00.000Z",
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/search_laundry_order_history") {
    if (!requireSessionBearer(request, response)) return;
    const historyInput = await readJsonBody(request).catch(() => ({}));
    const targetSiteId = typeof historyInput.target_site_id === "string"
      ? historyInput.target_site_id
      : "20000000-0000-4000-8000-000000000099";
    const periodStart = typeof historyInput.period_start === "string"
      ? new Date(historyInput.period_start)
      : new Date("1970-01-01T00:00:00.000Z");
    const periodEnd = typeof historyInput.period_end === "string"
      ? new Date(historyInput.period_end)
      : new Date("9999-12-31T00:00:00.000Z");
    const needle = typeof historyInput.order_query === "string"
      ? historyInput.order_query.trim().toLowerCase()
      : "";
    const limit = Math.min(Math.max(Number(historyInput.order_limit) || 20, 1), 40);
    const offset = Math.min(Math.max(Number(historyInput.order_offset) || 0, 0), 1000000);
    const matches = laundryOrders
      .filter((order) => order.status === "picked_up")
      .filter((order) => {
        const cart = laundryCarts.find((candidate) => candidate.id === order.laundry_cart_id);
        const siteCode = cart?.institutions?.operating_sites?.code;
        const site = organizationSites.find((candidate) => candidate.code === siteCode);
        if (site?.id !== targetSiteId) return false;
        const closedAt = new Date(order.closed_at ?? order.updated_at ?? "1970-01-01T00:00:00.000Z");
        if (!(closedAt >= periodStart && closedAt < periodEnd)) return false;
        if (!needle) return true;
        return [order.order_number, cart?.institutions?.code, cart?.institutions?.name, cart?.cart_number]
          .some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
      })
      .sort((left, right) => new Date(right.closed_at).valueOf() - new Date(left.closed_at).valueOf());
    const items = matches.slice(offset, offset + limit).map((order) => {
      const cart = laundryCarts.find((candidate) => candidate.id === order.laundry_cart_id);
      const site = organizationSites.find((candidate) => candidate.code === cart?.institutions?.operating_sites?.code);
      return {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        created_at: order.created_at ?? "2026-08-18T05:00:00.000Z",
        closed_at: order.closed_at ?? order.updated_at ?? "2026-08-18T08:00:00.000Z",
        institution_code: cart?.institutions?.code ?? "CARE-A",
        institution_name: cart?.institutions?.name ?? "照護機構 A",
        cart_number: cart?.cart_number ?? "—",
        site_code: site?.code ?? "MAIN",
        site_name: site?.name ?? "本館",
      };
    });
    json(response, 200, {
      outcome: "ok",
      site_id: targetSiteId,
      period: {
        start: periodStart.toISOString(),
        end: periodEnd.toISOString(),
      },
      queue: { total: matches.length, limit, offset, items },
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/get_laundry_order_history_detail") {
    if (!requireSessionBearer(request, response)) return;
    const detailInput = await readJsonBody(request).catch(() => ({}));
    const order = laundryOrders.find((candidate) => candidate.id === detailInput.target_laundry_order_id);
    if (!order || order.status !== "picked_up") {
      json(response, 200, { outcome: "not_found", order_id: detailInput.target_laundry_order_id ?? null });
      return;
    }

    const cart = laundryCarts.find((candidate) => candidate.id === order.laundry_cart_id);
    const institution = cart?.institutions;
    const site = organizationSites.find((candidate) => candidate.code === institution?.operating_sites?.code);
    const orderBatch = laundryBatches.find((batch) => batch.laundry_order_id === order.id);
    json(response, 200, {
      outcome: "ok",
      order: {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        created_at: order.created_at,
        closed_at: order.closed_at,
        institution_code: institution?.code ?? "CARE-A",
        institution_name: institution?.name ?? "照護機構 A",
        cart_number: cart?.cart_number ?? "CART-MAIN-01",
        site_code: site?.code ?? "MAIN",
        site_name: site?.name ?? "本館",
      },
      batches: orderBatch ? [{
        id: orderBatch.id,
        batch_sequence: orderBatch.batch_sequence ?? 1,
        category_code: "SOILED",
        category_name: "汙衣",
        procedure_name: "加強洗烘",
        procedure_version: 2,
        status: orderBatch.status,
        current_stage_order: orderBatch.current_stage_order,
        active_equipment_name: null,
        active_equipment_type: null,
        progress: {
          stage_run_id: null,
          stage_status: "completed",
          stage_progress_percent: 100,
          overall_progress_percent: 100,
          estimated_stage_completed_at: null,
          overdue_minutes: 0,
          total_standard_minutes: 90,
          is_estimate: true,
        },
        stages: [
          {
            stage_order: 1,
            name: "清洗",
            standard_minutes: 45,
            equipment_type: "washer",
            state: "completed",
            started_at: "2026-08-18T05:30:00.000Z",
            completed_at: "2026-08-18T06:15:00.000Z",
          },
          {
            stage_order: 2,
            name: "烘乾",
            standard_minutes: 45,
            equipment_type: "dryer",
            state: "completed",
            started_at: "2026-08-18T06:15:00.000Z",
            completed_at: "2026-08-18T07:15:00.000Z",
          },
        ],
      }] : [],
      events: [
        {
          id: "71000000-0000-4000-8000-000000000091",
          occurred_at: "2026-08-18T05:00:00.000Z",
          action: "laundry_order_created_from_cart_qr",
          outcome: "succeeded",
          reason: "匿名固定 QR 送單",
          batch_id: null,
          equipment_name: null,
        },
        {
          id: "71000000-0000-4000-8000-000000000092",
          occurred_at: "2026-08-18T05:15:00.000Z",
          action: "laundry_order_received",
          outcome: "succeeded",
          reason: "洗衣員掃車收單並完成分類",
          batch_id: null,
          equipment_name: null,
        },
        {
          id: "71000000-0000-4000-8000-000000000093",
          occurred_at: "2026-08-18T05:30:00.000Z",
          action: "laundry_batch_washing_started",
          outcome: "succeeded",
          reason: "掃描洗衣機開始清洗",
          batch_id: orderBatch?.id ?? null,
          equipment_name: "WASH-MAIN-01",
        },
        {
          id: "71000000-0000-4000-8000-000000000094",
          occurred_at: "2026-08-18T06:15:00.000Z",
          action: "laundry_batch_washing_completed_drying_started",
          outcome: "succeeded",
          reason: "掃描同一台洗衣機完成清洗",
          batch_id: orderBatch?.id ?? null,
          equipment_name: "WASH-MAIN-01",
        },
        {
          id: "71000000-0000-4000-8000-000000000095",
          occurred_at: "2026-08-18T07:15:00.000Z",
          action: "laundry_batch_drying_completed",
          outcome: "succeeded",
          reason: "掃描烘衣機完成烘乾",
          batch_id: orderBatch?.id ?? null,
          equipment_name: "DRYER-MAIN-01",
        },
        {
          id: "71000000-0000-4000-8000-000000000096",
          occurred_at: "2026-08-18T07:30:00.000Z",
          action: "laundry_batch_loaded_to_source_cart",
          outcome: "succeeded",
          reason: "洗衣員裝回來源車",
          batch_id: orderBatch?.id ?? null,
          equipment_name: null,
        },
        {
          id: "71000000-0000-4000-8000-000000000097",
          occurred_at: "2026-08-18T08:00:00.000Z",
          action: "laundry_order_picked_up",
          outcome: "succeeded",
          reason: "送洗人員掃車取件",
          batch_id: null,
          equipment_name: null,
        },
      ],
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/auth/v1/admin/users") {
    if (!requireServiceBearer(request, response)) return;
    const create = await readJsonBody(request);
    if (
      typeof create.email !== "string" ||
      typeof create.password !== "string" ||
      [...managedAuthUsers.values()].some(
        (candidate) => candidate.email.toLowerCase() === create.email.toLowerCase(),
      )
    ) {
      json(response, 422, { message: "user already exists or input is invalid" });
      return;
    }
    const newUser = {
      id: randomUUID(),
      email: create.email,
      password: create.password,
      user_metadata: create.user_metadata ?? {},
    };
    managedAuthUsers.set(newUser.id, newUser);
    json(response, 200, managedAuthUser(newUser));
    return;
  }

  if (
    request.method === "PUT" &&
    requestUrl.pathname.startsWith("/auth/v1/admin/users/")
  ) {
    if (!requireServiceBearer(request, response)) return;
    const authUserId = requestUrl.pathname.split("/").at(-1);
    const existing = managedAuthUsers.get(authUserId);
    if (!existing) {
      json(response, 404, { message: "auth user not found" });
      return;
    }
    const update = await readJsonBody(request);
    if (typeof update.email === "string") existing.email = update.email;
    if (typeof update.password === "string") existing.password = update.password;
    if (update.user_metadata && typeof update.user_metadata === "object") {
      existing.user_metadata = update.user_metadata;
    }
    managedAuthUsers.set(existing.id, existing);
    json(response, 200, managedAuthUser(existing));
    return;
  }

  if (
    request.method === "DELETE" &&
    requestUrl.pathname.startsWith("/auth/v1/admin/users/")
  ) {
    if (!requireServiceBearer(request, response)) return;
    const authUserId = requestUrl.pathname.split("/").at(-1);
    const existing = managedAuthUsers.get(authUserId);
    if (!existing) {
      json(response, 404, { message: "auth user not found" });
      return;
    }
    managedAuthUsers.delete(authUserId);
    for (const [profileId, mappedAuthUserId] of managedProfileAuthIds) {
      if (mappedAuthUserId !== authUserId) continue;
      managedProfileAuthIds.delete(profileId);
      const account = managedAccounts.find((candidate) => candidate.profile_id === profileId);
      if (account) account.auth_identity_configured = false;
    }
    json(response, 200, managedAuthUser(existing));
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/reverse_last_laundry_batch_operation"
  ) {
    if (!requireSessionBearer(request, response)) return;
    lastOperationReversal = await readJsonBody(request).catch(() => ({}));
    json(response, 200, [{
      laundry_batch_id: lastOperationReversal.target_laundry_batch_id,
      reversed_operation: "stage_started",
      restored_batch_status: "not_started",
      restored_order_status: "awaiting_cleaning",
      stage_order: 1,
      already_applied: false,
      outcome: "applied",
      reason_code: "stage_start_reversed",
    }]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/dispatch_laundry_equipment_qr"
  ) {
    if (!hasSessionBearer(request)) {
      json(response, 200, {
        outcome: "denied",
        reason_code: "authentication_required",
      });
      return;
    }
    const body = await readJsonBody(request).catch(() => ({}));
    const token = typeof body.qr_token === "string" ? body.qr_token : "";
    const equipmentId = [...laundryEquipmentCredentials.entries()].find(
      ([, credential]) => credential.token === token,
    )?.[0];
    const equipment = laundryEquipment.find((item) => item.id === equipmentId) ?? laundryEquipment[0];
    json(response, 200, {
      outcome: "ok",
      equipment_type: equipment?.equipment_type ?? "washer",
      laundry_equipment_id: equipment?.id,
      operating_site_id: equipment?.operating_site_id,
      occupied: Boolean(equipment?.occupied),
      next_path: "/app/operations/washing",
    });
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/dispatch_laundry_equipment_by_id"
  ) {
    if (!hasSessionBearer(request)) {
      json(response, 200, { outcome: "denied", reason_code: "authentication_required" });
      return;
    }
    const body = await readJsonBody(request).catch(() => ({}));
    const equipment = laundryEquipment.find((item) => item.id === body.target_laundry_equipment_id);
    if (!equipment) {
      json(response, 200, { outcome: "denied", reason_code: "invalid_qr" });
      return;
    }
    json(response, 200, {
      outcome: "ok",
      equipment_type: equipment.equipment_type,
      laundry_equipment_id: equipment.id,
      operating_site_id: equipment.operating_site_id,
      occupied: Boolean(equipment.occupied),
      next_path: "/app/operations/washing",
    });
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/get_operable_laundry_equipment_qr"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const body = await readJsonBody(request).catch(() => ({}));
    const equipment = laundryEquipment.find((item) => item.id === body.target_laundry_equipment_id);
    const credential = equipment ? laundryEquipmentCredentials.get(equipment.id) : null;
    json(
      response,
      200,
      equipment && credential
        ? [
            {
              laundry_equipment_id: equipment.id,
              qr_token: credential.token,
              operating_site_id: equipment.operating_site_id,
              occupied: Boolean(equipment.occupied),
              equipment_type: equipment.equipment_type,
            },
          ]
        : [],
    );
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/resolve_laundry_equipment_qr"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const body = await readJsonBody(request).catch(() => ({}));
    const token = typeof body.qr_token === "string" ? body.qr_token : "";
    const equipmentId = [...laundryEquipmentCredentials.entries()].find(
      ([, credential]) => credential.token === token,
    )?.[0];
    const equipment = laundryEquipment.find((item) => item.id === equipmentId);
    json(
      response,
      200,
      equipment
        ? [
            {
              laundry_equipment_id: equipment.id,
              equipment_name: equipment.name,
              equipment_type: equipment.equipment_type,
              operating_site_id: equipment.operating_site_id,
              status: equipment.status,
              occupied: equipment.occupied,
              qr_version: equipment.current_qr_version,
            },
          ]
        : [],
    );
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/dispatch_laundry_cart_qr"
  ) {
    const pickupOrder = laundryOrders.find((order) => order.status === "ready_for_pickup");
    if (!hasSessionBearer(request)) {
      if (pickupOrder) {
        json(response, 200, {
          outcome: "ok",
          next_path: "/scan/pickup",
          mode: "pickup",
        });
        return;
      }
      json(response, 200, {
        outcome: "ok",
        next_path: "/scan/cart",
        mode: "anonymous_dropoff",
      });
      return;
    }
    const openOrder = laundryOrders.find((order) => order.status === "awaiting_receipt");
    json(response, 200, {
      outcome: "ok",
      next_path: openOrder ? "/app/operations/receive" : "/scan/cart",
      mode: openOrder ? "receive" : "anonymous_dropoff",
    });
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/complete_required_password_change"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (
      mode !== "password-change-required" ||
      userPassword === "Temporary-Admin-42!"
    ) {
      json(response, 400, { message: "password has not changed" });
      return;
    }
    mode = "allowed";
    json(response, 200, true);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/list_manageable_user_accounts"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!["supervisor", "organization-supervisor"].includes(mode)) {
      json(response, 403, { message: "laundry supervisor access required" });
      return;
    }
    json(response, 200, managedAccounts);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/manage_user_account"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!["supervisor", "organization-supervisor"].includes(mode)) {
      json(response, 403, { message: "laundry supervisor access required" });
      return;
    }
    const change = await readJsonBody(request);
    const requestedLogin = String(change.requested_login_name ?? "").trim();
    let account = change.target_profile_id
      ? managedAccounts.find((candidate) => candidate.profile_id === change.target_profile_id)
      : null;
    if (!account && change.target_profile_id) {
      json(response, 404, { message: "managed account not found" });
      return;
    }
    if (
      managedAccounts.some(
        (candidate) =>
          candidate.profile_id !== account?.profile_id &&
          candidate.login_name.toLowerCase() === requestedLogin.toLowerCase(),
      )
    ) {
      json(response, 409, { message: "login name already exists" });
      return;
    }
    const memberships = Array.isArray(change.requested_memberships)
      ? change.requested_memberships.map((membership) => {
          const site = organizationSites.find(
            (candidate) => candidate.code === membership.site_code,
          );
          const institution = organizationInstitutions.find(
            (candidate) => candidate.code === membership.institution_code,
          );
          return {
            membership_id: randomUUID(),
            role: membership.role,
            site_code: site?.code ?? null,
            site_name: site?.name ?? null,
            institution_code: institution?.code ?? null,
            institution_name: institution?.name ?? null,
            active: true,
          };
        })
      : [];
    if (memberships.length === 0) {
      json(response, 400, { message: "at least one permission is required" });
      return;
    }
    const created = !account;
    if (!account) {
      account = {
        profile_id: randomUUID(),
        login_name: requestedLogin,
        display_name: change.requested_display_name ?? null,
        notification_email: change.requested_notification_email ?? null,
        account_active: true,
        must_change_password: true,
        deleted_at: null,
        auth_identity_configured: false,
        is_current_account: false,
        memberships,
      };
      managedAccounts.push(account);
    } else {
      account.login_name = requestedLogin;
      account.display_name = change.requested_display_name ?? null;
      account.notification_email = change.requested_notification_email ?? null;
      account.account_active = Boolean(change.requested_account_active);
      account.memberships = memberships;
    }
    lastManagedAccountChange = { operation: "manage", ...change };
    json(response, 200, [
      {
        user_access_profile_id: account.profile_id,
        internal_auth_email: `${requestedLogin.toLowerCase()}@auth.wash-room.invalid`,
        created_account: created,
        already_applied: false,
      },
    ]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/internal_bind_managed_auth_identity"
  ) {
    if (!requireServiceBearer(request, response)) return;
    const change = await readJsonBody(request);
    const account = managedAccounts.find(
      (candidate) => candidate.profile_id === change.target_profile_id,
    );
    if (!account || !managedAuthUsers.has(change.target_auth_user_id)) {
      json(response, 404, { message: "managed profile or auth user not found" });
      return;
    }
    managedProfileAuthIds.set(account.profile_id, change.target_auth_user_id);
    account.auth_identity_configured = true;
    json(response, 200, true);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/internal_get_managed_auth_identity"
  ) {
    if (!requireServiceBearer(request, response)) return;
    const change = await readJsonBody(request);
    const authUserId = managedProfileAuthIds.get(change.target_profile_id);
    const targetAuthUser = authUserId ? managedAuthUsers.get(authUserId) : null;
    json(
      response,
      200,
      targetAuthUser
        ? [{ auth_user_id: targetAuthUser.id, auth_email: targetAuthUser.email }]
        : [],
    );
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/mark_managed_account_password_reset"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    const account = managedAccounts.find(
      (candidate) => candidate.profile_id === change.target_profile_id,
    );
    if (!account || account.is_current_account || account.deleted_at) {
      json(response, 403, { message: "account cannot be reset" });
      return;
    }
    account.must_change_password = true;
    lastManagedAccountChange = { operation: "password_reset", ...change };
    json(response, 200, true);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/retire_managed_user_account"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    const account = managedAccounts.find(
      (candidate) => candidate.profile_id === change.target_profile_id,
    );
    if (!account || account.is_current_account || account.deleted_at) {
      json(response, 403, { message: "account cannot be deleted" });
      return;
    }
    account.account_active = false;
    account.deleted_at = new Date().toISOString();
    account.memberships = account.memberships.map((membership) => ({
      ...membership,
      active: false,
    }));
    lastManagedAccountChange = { operation: "retire", ...change };
    json(response, 200, true);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/apply_managed_account_permission_changes"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    const rows = Array.isArray(change.change_rows) ? change.change_rows : [];
    const unmanaged = rows.find((row) => {
      const account = managedAccounts.find(
        (candidate) => candidate.login_name.toLowerCase() === String(row.login_name).toLowerCase(),
      );
      return !account || account.deleted_at || !account.auth_identity_configured || account.is_current_account;
    });
    if (unmanaged) {
      json(response, 403, { message: "account must be managed by account lifecycle" });
      return;
    }
    if (lastAccessChange?.change_request_id === change.change_request_id) {
      json(response, 200, [{ applied_count: 0, already_applied: true }]);
      return;
    }
    for (const row of rows) {
      const account = managedAccounts.find(
        (candidate) => candidate.login_name.toLowerCase() === String(row.login_name).toLowerCase(),
      );
      if (!account) continue;
      account.account_active = row.account_active;
      const membership = account.memberships.find(
        (candidate) =>
          candidate.role === row.role &&
          (candidate.site_code ?? "") === (row.site_code ?? "") &&
          (candidate.institution_code ?? "") === (row.institution_code ?? ""),
      );
      if (membership) {
        membership.active = row.membership_active;
      } else {
        account.memberships.push({
          membership_id: randomUUID(),
          role: row.role,
          site_code: row.site_code,
          site_name: row.site_code ? organizationSites.find((site) => site.code === row.site_code)?.name ?? null : null,
          institution_code: row.institution_code,
          institution_name: row.institution_code
            ? organizationInstitutions.find((institution) => institution.code === row.institution_code)?.name ?? null
            : null,
          active: row.membership_active,
        });
      }
    }
    lastAccessChange = change;
    json(response, 200, [{ applied_count: rows.length, already_applied: false }]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/apply_access_changes"
  ) {
    if (!requireSessionBearer(request, response)) return;
    lastAccessChange = await readJsonBody(request);
    json(response, 200, [
      {
        applied_count: lastAccessChange.change_rows.length,
        already_applied: false,
      },
    ]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/apply_institution_change"
  ) {
    if (!requireSessionBearer(request, response)) return;
    lastInstitutionChange = await readJsonBody(request);
    const allowedSiteCodes = organizationSupervisorSiteCodes();
    const site = organizationSites.find(
      (candidate) => candidate.code === lastInstitutionChange.target_site_code,
    );
    if (!site) {
      json(response, 400, { message: "active operating site not found" });
      return;
    }
    if (!allowedSiteCodes.has(site.code)) {
      json(response, 403, { message: "site supervisor access required" });
      return;
    }

    const existing = organizationInstitutions.find(
      (institution) => institution.code === lastInstitutionChange.institution_code,
    );
    if (existing && !allowedSiteCodes.has(existing.operating_sites.code)) {
      json(response, 403, {
        message: "source site supervisor access required",
      });
      return;
    }

    const requestPayload = JSON.stringify(lastInstitutionChange);
    const priorRequest = organizationChangeRequests.get(
      lastInstitutionChange.change_request_id,
    );
    if (priorRequest) {
      if (priorRequest.payload !== requestPayload) {
        json(response, 400, {
          message: "request id already used with different change",
        });
        return;
      }
      json(response, 200, [
        { institution_id: priorRequest.institutionId, already_applied: true },
      ]);
      return;
    }

    const institutionId = existing?.id ?? randomUUID();
    const nextInstitution = {
      id: institutionId,
      code: lastInstitutionChange.institution_code,
      name: lastInstitutionChange.institution_name,
      active: lastInstitutionChange.institution_active,
      operating_site_id: site.id,
      operating_sites: { code: site.code, name: site.name },
    };

    organizationInstitutions = existing
      ? organizationInstitutions.map((institution) =>
          institution.id === institutionId ? nextInstitution : institution,
        )
      : [...organizationInstitutions, nextInstitution];
    organizationChangeRequests.set(lastInstitutionChange.change_request_id, {
      payload: requestPayload,
      institutionId,
    });
    json(response, 200, [
      { institution_id: institutionId, already_applied: false },
    ]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/create_laundry_category"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!["supervisor", "organization-supervisor"].includes(mode)) {
      json(response, 403, { message: "laundry supervisor access required" });
      return;
    }
    const change = await readJsonBody(request);
    const payload = JSON.stringify(change);
    const priorRequest = procedureChangeRequests.get(change.change_request_id);
    if (priorRequest) {
      if (priorRequest.payload !== payload) {
        json(response, 400, { message: "request id already used" });
        return;
      }
      json(response, 200, [
        { laundry_category_id: priorRequest.categoryId, already_applied: true },
      ]);
      return;
    }
    const code = String(change.category_code).toUpperCase();
    if (laundryCategories.some((category) => category.code === code)) {
      json(response, 409, { message: "category code already exists" });
      return;
    }
    const categoryId = randomUUID();
    laundryCategories.push({
      id: categoryId,
      code,
      name: change.category_name,
      sort_order: change.category_sort_order,
      active: true,
    });
    procedureChangeRequests.set(change.change_request_id, {
      payload,
      categoryId,
    });
    json(response, 200, [
      { laundry_category_id: categoryId, already_applied: false },
    ]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/update_laundry_category"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!["supervisor", "organization-supervisor"].includes(mode)) {
      json(response, 403, { message: "laundry supervisor access required" });
      return;
    }
    const change = await readJsonBody(request);
    const payload = JSON.stringify(change);
    const priorRequest = procedureChangeRequests.get(change.change_request_id);
    if (priorRequest) {
      if (priorRequest.payload !== payload) {
        json(response, 400, { message: "request id already used" });
        return;
      }
      json(response, 200, [
        { laundry_category_id: priorRequest.categoryId, already_applied: true },
      ]);
      return;
    }
    const category = laundryCategories.find(
      (candidate) => candidate.id === change.target_laundry_category_id,
    );
    if (!category) {
      json(response, 400, { message: "category not found" });
      return;
    }
    category.name = change.category_name;
    category.sort_order = change.category_sort_order;
    category.active = change.category_active;
    procedureChangeRequests.set(change.change_request_id, {
      payload,
      categoryId: category.id,
    });
    json(response, 200, [
      { laundry_category_id: category.id, already_applied: false },
    ]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/create_procedure_template_draft"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!["supervisor", "organization-supervisor"].includes(mode)) {
      json(response, 403, { message: "procedure supervisor access required" });
      return;
    }
    const change = await readJsonBody(request);
    const payload = JSON.stringify(change);
    const priorRequest = procedureChangeRequests.get(change.change_request_id);
    if (priorRequest) {
      if (priorRequest.payload !== payload) {
        json(response, 400, { message: "request id already used" });
        return;
      }
      json(response, 200, [priorRequest.result]);
      return;
    }
    let template = change.target_template_id
      ? procedureTemplates.find(
          (candidate) => candidate.id === change.target_template_id,
        )
      : null;
    const allowedSiteCodes = organizationSupervisorSiteCodes();
    if (!template) {
      const site = organizationSites.find(
        (candidate) => candidate.code === change.target_site_code,
      );
      const category = laundryCategories.find(
        (candidate) => candidate.code === change.target_category_code,
      );
      if (!site || !allowedSiteCodes.has(site.code) || !category?.active) {
        json(response, 403, { message: "invalid procedure scope" });
        return;
      }
      template = {
        id: randomUUID(),
        operating_site_id: site.id,
        laundry_category_id: category.id,
        active: true,
      };
      procedureTemplates.push(template);
    }
    if (!allowedSiteCodes.has(
      organizationSites.find((site) => site.id === template.operating_site_id)?.code,
    )) {
      json(response, 403, { message: "procedure supervisor access required" });
      return;
    }
    if (procedureVersions.some(
      (version) =>
        version.procedure_template_id === template.id && version.status === "draft",
    )) {
      json(response, 409, { message: "procedure draft already exists" });
      return;
    }
    const versionNo =
      Math.max(
        0,
        ...procedureVersions
          .filter((version) => version.procedure_template_id === template.id)
          .map((version) => version.version_no),
      ) + 1;
    const version = {
      id: randomUUID(),
      procedure_template_id: template.id,
      version_no: versionNo,
      template_name: change.template_name,
      status: "draft",
      created_at: new Date().toISOString(),
      published_at: null,
    };
    procedureVersions.push(version);
    for (const stage of change.stages) {
      procedureStages.push({
        id: randomUUID(),
        procedure_version_id: version.id,
        ...stage,
      });
    }
    const result = {
      procedure_template_id: template.id,
      procedure_version_id: version.id,
      version_no: versionNo,
      already_applied: false,
    };
    procedureChangeRequests.set(change.change_request_id, {
      payload,
      result,
    });
    json(response, 200, [result]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/update_procedure_template_draft"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!["supervisor", "organization-supervisor"].includes(mode)) {
      json(response, 403, { message: "procedure supervisor access required" });
      return;
    }
    const change = await readJsonBody(request);
    const payload = JSON.stringify(change);
    const priorRequest = procedureChangeRequests.get(change.change_request_id);
    if (priorRequest) {
      if (priorRequest.payload !== payload) {
        json(response, 400, { message: "request id already used" });
        return;
      }
      json(response, 200, [priorRequest.result]);
      return;
    }
    const version = procedureVersions.find(
      (candidate) => candidate.id === change.target_procedure_version_id,
    );
    if (!version || version.status !== "draft") {
      json(response, 409, { message: "procedure version is immutable" });
      return;
    }
    version.template_name = change.template_name;
    procedureStages = procedureStages.filter(
      (stage) => stage.procedure_version_id !== version.id,
    );
    for (const stage of change.stages) {
      procedureStages.push({ id: randomUUID(), procedure_version_id: version.id, ...stage });
    }
    const result = {
      procedure_template_id: version.procedure_template_id,
      procedure_version_id: version.id,
      version_no: version.version_no,
      already_applied: false,
    };
    procedureChangeRequests.set(change.change_request_id, { payload, result });
    json(response, 200, [result]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/publish_procedure_template_version"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!["supervisor", "organization-supervisor"].includes(mode)) {
      json(response, 403, { message: "procedure supervisor access required" });
      return;
    }
    const change = await readJsonBody(request);
    const payload = JSON.stringify(change);
    const priorRequest = procedureChangeRequests.get(change.change_request_id);
    if (priorRequest) {
      if (priorRequest.payload !== payload) {
        json(response, 400, { message: "request id already used" });
        return;
      }
      json(response, 200, [priorRequest.result]);
      return;
    }
    const version = procedureVersions.find(
      (candidate) => candidate.id === change.target_procedure_version_id,
    );
    if (!version || version.status !== "draft") {
      json(response, 409, { message: "only drafts can be published" });
      return;
    }
    for (const candidate of procedureVersions) {
      if (
        candidate.procedure_template_id === version.procedure_template_id &&
        candidate.status === "published"
      ) {
        candidate.status = "retired";
      }
    }
    version.status = "published";
    version.published_at = new Date().toISOString();
    const result = {
      procedure_template_id: version.procedure_template_id,
      procedure_version_id: version.id,
      version_no: version.version_no,
      already_applied: false,
    };
    procedureChangeRequests.set(change.change_request_id, { payload, result });
    json(response, 200, [result]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/set_procedure_template_active"
  ) {
    if (!requireSessionBearer(request, response)) return;
    if (!["supervisor", "organization-supervisor"].includes(mode)) {
      json(response, 403, { message: "procedure supervisor access required" });
      return;
    }
    const change = await readJsonBody(request);
    const template = procedureTemplates.find(
      (candidate) => candidate.id === change.target_procedure_template_id,
    );
    if (!template) {
      json(response, 404, { message: "procedure template not found" });
      return;
    }
    template.active = change.template_active;
    json(response, 200, [
      {
        procedure_template_id: template.id,
        already_applied: false,
      },
    ]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/register_laundry_cart"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    const institution = organizationInstitutions.find(
      (candidate) => candidate.code === change.target_institution_code,
    );
    const allowedSiteCodes = organizationSupervisorSiteCodes();
    lastLaundryCartChange = { operation: "register", ...change };

    if (
      !institution ||
      !institution.active ||
      !allowedSiteCodes.has(institution.operating_sites.code)
    ) {
      json(response, 200, [
        {
          laundry_cart_id: null,
          qr_version: null,
          already_applied: false,
          outcome: "denied",
        },
      ]);
      return;
    }

    const payload = JSON.stringify(change);
    const priorRequest = laundryCartChangeRequests.get(change.change_request_id);
    if (priorRequest) {
      if (priorRequest.payload !== payload) {
        json(response, 400, { message: "request id already used" });
        return;
      }
      json(response, 200, [
        {
          laundry_cart_id: priorRequest.cartId,
          qr_version: priorRequest.qrVersion,
          already_applied: true,
          outcome: "applied",
        },
      ]);
      return;
    }

    if (laundryCarts.some((cart) => cart.cart_number === change.requested_cart_number)) {
      json(response, 409, { message: "laundry cart number already exists" });
      return;
    }

    const cartId = randomUUID();
    laundryCarts.push({
      id: cartId,
      cart_number: change.requested_cart_number,
      institution_id: institution.id,
      active: true,
      current_qr_version: 1,
      institutions: {
        code: institution.code,
        name: institution.name,
        operating_sites: structuredClone(institution.operating_sites),
      },
    });
    laundryCartCredentials.set(cartId, {
      version: 1,
      token: fakeLaundryCartQrToken(laundryCarts.length + 30),
    });
    laundryCartChangeRequests.set(change.change_request_id, {
      payload,
      cartId,
      qrVersion: 1,
    });
    json(response, 200, [
      {
        laundry_cart_id: cartId,
        qr_version: 1,
        already_applied: false,
        outcome: "applied",
      },
    ]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/register_laundry_equipment") {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    lastLaundryEquipmentChange = { operation: "register", ...change };
    const allowed = organizationSupervisorSiteCodes().has(change.target_site_code);
    if (!allowed) {
      json(response, 200, [{ laundry_equipment_id: null, qr_version: null, already_applied: false, outcome: "denied" }]);
      return;
    }
    const payload = JSON.stringify(change);
    const prior = laundryEquipmentChangeRequests.get(change.change_request_id);
    if (prior) {
      if (prior.payload !== payload) { json(response, 400, { message: "request id already used" }); return; }
      json(response, 200, [{ laundry_equipment_id: prior.equipmentId, qr_version: prior.qrVersion, already_applied: true, outcome: "applied" }]);
      return;
    }
    const site = organizationSites.find((candidate) => candidate.code === change.target_site_code);
    const equipment = { id: randomUUID(), name: change.requested_name, equipment_type: change.target_equipment_type, capacity_kg: change.target_capacity_kg, status: "normal", occupied: false, current_qr_version: 1, operating_site_id: site.id, operating_sites: { code: site.code, name: site.name } };
    laundryEquipment.push(equipment);
    laundryEquipmentCredentials.set(equipment.id, { version: 1, token: fakeLaundryCartQrToken(laundryEquipment.length + 90) });
    laundryEquipmentChangeRequests.set(change.change_request_id, { payload, equipmentId: equipment.id, qrVersion: 1 });
    json(response, 200, [{ laundry_equipment_id: equipment.id, qr_version: 1, already_applied: false, outcome: "applied" }]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/create_laundry_order_from_cart_qr") {
    const change = await readJsonBody(request);
    const prior = laundryOrderChangeRequests.get(change.change_request_id);
    if (prior) {
      if (prior.token !== change.qr_token) { json(response, 200, [{ laundry_order_id: null, order_number: null, status: null, already_applied: false, outcome: "denied", reason_code: "request_replay" }]); return; }
      json(response, 200, [{ ...prior.result, already_applied: true }]); return;
    }
    const cartEntry = [...laundryCartCredentials.entries()].find(([, credential]) => credential.token === change.qr_token);
    const cart = cartEntry ? laundryCarts.find((candidate) => candidate.id === cartEntry[0]) : null;
    if (!cart || !cart.active) { json(response, 200, [{ laundry_order_id: null, order_number: null, status: null, already_applied: false, outcome: "denied", reason_code: "invalid_qr" }]); return; }
    const open = laundryOrders.find((order) => order.laundry_cart_id === cart.id && order.status !== "picked_up");
    if (open) { json(response, 200, [{ laundry_order_id: null, order_number: null, status: null, already_applied: false, outcome: "denied", reason_code: "existing_open_order" }]); return; }
    const order = { id: randomUUID(), order_number: `MAIN-20260808-${String(laundryOrders.length + 1).padStart(4, "0")}`, laundry_cart_id: cart.id, status: "awaiting_receipt" };
    laundryOrders.push(order);
    const result = { laundry_order_id: order.id, order_number: order.order_number, status: order.status, already_applied: false, outcome: "applied", reason_code: "created" };
    laundryOrderChangeRequests.set(change.change_request_id, { token: change.qr_token, result });
    json(response, 200, [result]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/pickup_laundry_order_from_cart_qr") {
    const change = await readJsonBody(request);
    const prior = laundryOrderChangeRequests.get(`pickup:${change.change_request_id}`);
    if (prior) { json(response, 200, [{ ...prior, already_applied: true }]); return; }
    const cartEntry = [...laundryCartCredentials.entries()].find(([, credential]) => credential.token === change.qr_token);
    const cart = cartEntry ? laundryCarts.find((candidate) => candidate.id === cartEntry[0]) : null;
    const order = cart ? laundryOrders.find((candidate) => candidate.laundry_cart_id === cart.id && candidate.status === "ready_for_pickup") : null;
    if (!order) { json(response, 200, [{ laundry_order_id: null, order_number: null, already_applied: false, outcome: "denied", status: null, reason_code: cart ? "not_pickup_ready" : "invalid_qr" }]); return; }
    order.status = "picked_up";
    const result = { laundry_order_id: order.id, order_number: order.order_number, already_applied: false, outcome: "applied", status: "picked_up", reason_code: "picked_up" };
    laundryOrderChangeRequests.set(`pickup:${change.change_request_id}`, result);
    json(response, 200, [result]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/receive_laundry_order_from_cart_qr") {
    if (!requireSessionBearer(request, response)) return;
    if (mode !== "allowed" && mode !== "multi") { json(response, 403, { message: "laundry worker access required" }); return; }
    const change = await readJsonBody(request);
    const categories = Array.isArray(change.selected_category_codes) ? change.selected_category_codes : [];
    const prior = laundryReceiptChangeRequests.get(change.change_request_id);
    if (prior) { json(response, 200, [{ ...prior, already_applied: true }]); return; }
    if (categories.length === 0) { json(response, 200, [{ laundry_order_id: null, batch_count: 0, already_applied: false, outcome: "denied", status: null, reason_code: "invalid_categories" }]); return; }
    const cartEntry = [...laundryCartCredentials.entries()].find(([, credential]) => credential.token === change.qr_token);
    const cart = cartEntry ? laundryCarts.find((candidate) => candidate.id === cartEntry[0]) : null;
    if (!cart) { json(response, 200, [{ laundry_order_id: null, batch_count: 0, already_applied: false, outcome: "denied", status: null, reason_code: "invalid_qr" }]); return; }
    const order = laundryOrders.find((candidate) => candidate.laundry_cart_id === cart.id && candidate.status === "awaiting_receipt");
    if (!order) { json(response, 200, [{ laundry_order_id: null, batch_count: 0, already_applied: false, outcome: "denied", status: null, reason_code: "order_not_receivable" }]); return; }
    order.status = "awaiting_cleaning";
    const result = { laundry_order_id: order.id, batch_count: categories.length, already_applied: false, outcome: "applied", status: order.status, reason_code: "received" };
    laundryReceiptChangeRequests.set(change.change_request_id, result);
    json(response, 200, [result]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/start_laundry_batch_washing_from_equipment_qr") {
    if (!requireSessionBearer(request, response)) return;
    if (mode !== "allowed" && mode !== "multi") { json(response, 403, { message: "laundry worker access required" }); return; }
    const change = await readJsonBody(request);
    const prior = laundryStageChangeRequests.get(change.change_request_id);
    if (prior) { json(response, 200, [{ ...prior, already_applied: true }]); return; }
    const batch = laundryBatches.find((candidate) => candidate.id === change.target_laundry_batch_id);
    const equipmentEntry = [...laundryEquipmentCredentials.entries()].find(([, credential]) => credential.token === change.qr_token);
    const equipment = equipmentEntry ? laundryEquipment.find((candidate) => candidate.id === equipmentEntry[0]) : null;
    if (!batch) { json(response, 200, [{ laundry_batch_id: change.target_laundry_batch_id, stage_run_id: null, laundry_equipment_id: null, stage_order: null, already_applied: false, outcome: "denied", status: null, reason_code: "batch_not_ready" }]); return; }
    if (!equipment) { json(response, 200, [{ laundry_batch_id: batch.id, stage_run_id: null, laundry_equipment_id: null, stage_order: null, already_applied: false, outcome: "denied", status: null, reason_code: "invalid_qr" }]); return; }
    if (equipment.occupied) { json(response, 200, [{ laundry_batch_id: batch.id, stage_run_id: null, laundry_equipment_id: equipment.id, stage_order: batch.current_stage_order, already_applied: false, outcome: "denied", status: null, reason_code: "equipment_occupied" }]); return; }
    equipment.occupied = true;
    batch.status = "in_progress";
    const result = { laundry_batch_id: batch.id, stage_run_id: randomUUID(), laundry_equipment_id: equipment.id, stage_order: batch.current_stage_order, already_applied: false, outcome: "applied", status: "in_progress", reason_code: "washing_started" };
    batch.active_stage_run_id = result.stage_run_id;
    batch.active_equipment_id = equipment.id;
    laundryStageChangeRequests.set(change.change_request_id, result);
    json(response, 200, [result]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/start_laundry_batch_drying_from_equipment_qr") {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    const prior = laundryStageChangeRequests.get(change.change_request_id);
    if (prior) { json(response, 200, [{ ...prior, already_applied: true }]); return; }
    const batch = laundryBatches.find((candidate) => candidate.id === change.target_laundry_batch_id);
    const equipmentEntry = [...laundryEquipmentCredentials.entries()].find(([, credential]) => credential.token === change.qr_token);
    const equipment = equipmentEntry ? laundryEquipment.find((candidate) => candidate.id === equipmentEntry[0]) : null;
    if (!batch || !equipment) {
      json(response, 200, [{ laundry_batch_id: change.target_laundry_batch_id, stage_run_id: null, laundry_equipment_id: null, stage_order: null, already_applied: false, outcome: "denied", status: null, reason_code: "batch_not_ready" }]);
      return;
    }
    equipment.occupied = true;
    batch.status = "in_progress";
    const result = { laundry_batch_id: batch.id, stage_run_id: randomUUID(), laundry_equipment_id: equipment.id, stage_order: batch.current_stage_order, already_applied: false, outcome: "applied", status: "in_progress", reason_code: "drying_started" };
    batch.active_stage_run_id = result.stage_run_id;
    laundryStageChangeRequests.set(change.change_request_id, result);
    json(response, 200, [result]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/complete_laundry_batch_stage_from_equipment_qr") {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    const prior = laundryStageChangeRequests.get(`complete:${change.change_request_id}`);
    if (prior) { json(response, 200, [{ ...prior, already_applied: true }]); return; }
    const batch = laundryBatches.find((candidate) => candidate.id === change.target_laundry_batch_id);
    const equipmentEntry = [...laundryEquipmentCredentials.entries()].find(([, credential]) => credential.token === change.qr_token);
    const equipment = equipmentEntry ? laundryEquipment.find((candidate) => candidate.id === equipmentEntry[0]) : null;
    if (!batch || !equipment) {
      json(response, 200, [{ laundry_batch_id: change.target_laundry_batch_id, completed_stage_run_id: null, laundry_equipment_id: null, stage_order: null, already_applied: false, outcome: "denied", status: null, reason_code: "batch_not_ready" }]);
      return;
    }
    equipment.occupied = false;
    batch.status = "not_started";
    batch.current_stage_order = (batch.current_stage_order ?? 1) + 1;
    batch.active_stage_run_id = null;
    const result = { laundry_batch_id: batch.id, completed_stage_run_id: randomUUID(), laundry_equipment_id: equipment.id, stage_order: batch.current_stage_order, already_applied: false, outcome: "applied", status: "not_started", reason_code: "stage_completed" };
    laundryStageChangeRequests.set(`complete:${change.change_request_id}`, result);
    json(response, 200, [result]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/update_laundry_equipment") {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    lastLaundryEquipmentChange = { operation: "update", ...change };
    const equipment = laundryEquipment.find((candidate) => candidate.id === change.target_laundry_equipment_id);
    if (!equipment || !organizationSupervisorSiteCodes().has(equipment.operating_sites.code)) {
      json(response, 200, [{ laundry_equipment_id: null, qr_version: null, already_applied: false, outcome: "denied" }]);
      return;
    }
    const payload = JSON.stringify(change); const prior = laundryEquipmentChangeRequests.get(change.change_request_id);
    if (prior) { if (prior.payload !== payload) { json(response, 400, { message: "request id already used" }); return; } json(response, 200, [{ laundry_equipment_id: prior.equipmentId, qr_version: prior.qrVersion, already_applied: true, outcome: "applied" }]); return; }
    equipment.name = change.requested_name; equipment.capacity_kg = change.target_capacity_kg; equipment.status = change.target_status;
    laundryEquipmentChangeRequests.set(change.change_request_id, { payload, equipmentId: equipment.id, qrVersion: equipment.current_qr_version });
    json(response, 200, [{ laundry_equipment_id: equipment.id, qr_version: equipment.current_qr_version, already_applied: false, outcome: "applied" }]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/delete_unused_laundry_equipment") {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    lastLaundryEquipmentChange = { operation: "delete", ...change };
    const payload = JSON.stringify(change);
    const prior = laundryEquipmentChangeRequests.get(change.change_request_id);
    if (prior) {
      if (prior.payload !== payload) { json(response, 400, { message: "request id already used" }); return; }
      json(response, 200, [{ laundry_equipment_id: prior.equipmentId, already_applied: true, outcome: "applied", reason_code: "deleted" }]);
      return;
    }
    const equipmentIndex = laundryEquipment.findIndex((candidate) => candidate.id === change.target_laundry_equipment_id);
    const equipment = equipmentIndex >= 0 ? laundryEquipment[equipmentIndex] : null;
    if (!equipment || !organizationSupervisorSiteCodes().has(equipment.operating_sites.code)) {
      json(response, 200, [{ laundry_equipment_id: null, already_applied: false, outcome: "denied", reason_code: "scope_denied" }]);
      return;
    }
    if (equipment.name !== change.expected_equipment_name.trim().toUpperCase()) {
      json(response, 200, [{ laundry_equipment_id: equipment.id, already_applied: false, outcome: "denied", reason_code: "name_mismatch" }]);
      return;
    }
    const used = equipment.occupied || [...laundryStageChangeRequests.values()].some((entry) => entry.laundry_equipment_id === equipment.id);
    if (used) {
      json(response, 200, [{ laundry_equipment_id: equipment.id, already_applied: false, outcome: "denied", reason_code: "in_use" }]);
      return;
    }
    laundryEquipment.splice(equipmentIndex, 1);
    laundryEquipmentCredentials.delete(equipment.id);
    laundryEquipmentChangeRequests.set(change.change_request_id, { payload, equipmentId: equipment.id, qrVersion: null });
    json(response, 200, [{ laundry_equipment_id: equipment.id, already_applied: false, outcome: "applied", reason_code: "deleted" }]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/get_current_laundry_equipment_qr") {
    if (!requireSessionBearer(request, response)) return;
    const { target_laundry_equipment_id: equipmentId } = await readJsonBody(request);
    const equipment = laundryEquipment.find((candidate) => candidate.id === equipmentId);
    const credential = laundryEquipmentCredentials.get(equipmentId);
    if (!equipment || !credential || !organizationSupervisorSiteCodes().has(equipment.operating_sites.code)) { json(response, 200, []); return; }
    json(response, 200, [{ laundry_equipment_id: equipment.id, equipment_name: equipment.name, equipment_type: equipment.equipment_type, qr_version: credential.version, qr_token: credential.token }]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/reissue_laundry_equipment_qr") {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request); lastLaundryEquipmentChange = { operation: "reissue", ...change };
    const equipment = laundryEquipment.find((candidate) => candidate.id === change.target_laundry_equipment_id);
    if (!equipment || !organizationSupervisorSiteCodes().has(equipment.operating_sites.code)) { json(response, 200, [{ laundry_equipment_id: null, qr_version: null, already_applied: false, outcome: "denied" }]); return; }
    const payload = JSON.stringify(change); const prior = laundryEquipmentChangeRequests.get(change.change_request_id);
    if (prior) { if (prior.payload !== payload) { json(response, 400, { message: "request id already used" }); return; } json(response, 200, [{ laundry_equipment_id: prior.equipmentId, qr_version: prior.qrVersion, already_applied: true, outcome: "applied" }]); return; }
    const version = equipment.current_qr_version + 1; equipment.current_qr_version = version; laundryEquipmentCredentials.set(equipment.id, { version, token: fakeLaundryCartQrToken(120 + version) }); laundryEquipmentChangeRequests.set(change.change_request_id, { payload, equipmentId: equipment.id, qrVersion: version });
    json(response, 200, [{ laundry_equipment_id: equipment.id, qr_version: version, already_applied: false, outcome: "applied" }]); return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/set_laundry_cart_active"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    const cart = laundryCarts.find(
      (candidate) => candidate.id === change.target_laundry_cart_id,
    );
    const allowedSiteCodes = organizationSupervisorSiteCodes();
    lastLaundryCartChange = { operation: "set-active", ...change };

    if (
      !cart ||
      !allowedSiteCodes.has(cart.institutions.operating_sites.code)
    ) {
      json(response, 200, [
        {
          laundry_cart_id: null,
          qr_version: null,
          already_applied: false,
          outcome: "denied",
        },
      ]);
      return;
    }

    const payload = JSON.stringify(change);
    const priorRequest = laundryCartChangeRequests.get(change.change_request_id);
    if (priorRequest) {
      if (priorRequest.payload !== payload) {
        json(response, 400, { message: "request id already used" });
        return;
      }
      json(response, 200, [
        {
          laundry_cart_id: priorRequest.cartId,
          qr_version: priorRequest.qrVersion,
          already_applied: true,
          outcome: "applied",
        },
      ]);
      return;
    }

    cart.active = change.target_active;
    laundryCartChangeRequests.set(change.change_request_id, {
      payload,
      cartId: cart.id,
      qrVersion: cart.current_qr_version,
    });
    json(response, 200, [
      {
        laundry_cart_id: cart.id,
        qr_version: cart.current_qr_version,
        already_applied: false,
        outcome: "applied",
      },
    ]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/get_current_laundry_cart_qr"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const { target_laundry_cart_id: cartId } = await readJsonBody(request);
    const cart = laundryCarts.find((candidate) => candidate.id === cartId);
    const credential = laundryCartCredentials.get(cartId);
    const allowedSiteCodes = organizationSupervisorSiteCodes();

    if (
      !cart ||
      !credential ||
      !allowedSiteCodes.has(cart.institutions.operating_sites.code)
    ) {
      json(response, 200, []);
      return;
    }

    json(response, 200, [
      {
        laundry_cart_id: cart.id,
        cart_number: cart.cart_number,
        qr_version: credential.version,
        qr_token: credential.token,
      },
    ]);
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/rest/v1/rpc/reissue_laundry_cart_qr"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const change = await readJsonBody(request);
    const cart = laundryCarts.find(
      (candidate) => candidate.id === change.target_laundry_cart_id,
    );
    const allowedSiteCodes = organizationSupervisorSiteCodes();
    lastLaundryCartChange = { operation: "reissue", ...change };

    if (
      !cart ||
      !allowedSiteCodes.has(cart.institutions.operating_sites.code)
    ) {
      json(response, 200, [
        {
          laundry_cart_id: null,
          qr_version: null,
          already_applied: false,
          outcome: "denied",
        },
      ]);
      return;
    }

    const payload = JSON.stringify(change);
    const priorRequest = laundryCartChangeRequests.get(change.change_request_id);
    if (priorRequest) {
      if (priorRequest.payload !== payload) {
        json(response, 400, { message: "request id already used" });
        return;
      }
      json(response, 200, [
        {
          laundry_cart_id: priorRequest.cartId,
          qr_version: priorRequest.qrVersion,
          already_applied: true,
          outcome: "applied",
        },
      ]);
      return;
    }

    const nextVersion = cart.current_qr_version + 1;
    cart.current_qr_version = nextVersion;
    laundryCartCredentials.set(cart.id, {
      version: nextVersion,
      token: fakeLaundryCartQrToken(60 + nextVersion),
    });
    laundryCartChangeRequests.set(change.change_request_id, {
      payload,
      cartId: cart.id,
      qrVersion: nextVersion,
    });
    json(response, 200, [
      {
        laundry_cart_id: cart.id,
        qr_version: nextVersion,
        already_applied: false,
        outcome: "applied",
      },
    ]);
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/rest/v1/operating_sites"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const allowedSiteCodes = organizationSupervisorSiteCodes();
    json(
      response,
      200,
      organizationSites.filter((site) => allowedSiteCodes.has(site.code)),
    );
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/rest/v1/institutions"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const allowedSiteCodes = organizationSupervisorSiteCodes();
    json(
      response,
      200,
      organizationInstitutions.filter((institution) =>
        allowedSiteCodes.has(institution.operating_sites.code),
      ),
    );
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/rest/v1/laundry_categories"
  ) {
    if (!requireSessionBearer(request, response)) return;
    json(response, 200, laundryCategories);
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/rest/v1/procedure_templates"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const allowedSiteCodes = organizationSupervisorSiteCodes();
    json(
      response,
      200,
      procedureTemplates.filter((template) =>
        allowedSiteCodes.has(
          organizationSites.find((site) => site.id === template.operating_site_id)?.code,
        ),
      ),
    );
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/rest/v1/procedure_template_versions"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const allowedTemplateIds = new Set(
      procedureTemplates
        .filter((template) =>
          organizationSupervisorSiteCodes().has(
            organizationSites.find((site) => site.id === template.operating_site_id)?.code,
          ),
        )
        .map((template) => template.id),
    );
    json(
      response,
      200,
      procedureVersions.filter((version) =>
        allowedTemplateIds.has(version.procedure_template_id),
      ),
    );
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/rest/v1/procedure_template_stages"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const allowedVersionIds = new Set(
      procedureVersions
        .filter((version) =>
          procedureTemplates
            .filter((template) => template.id === version.procedure_template_id)
            .some((template) =>
              organizationSupervisorSiteCodes().has(
                organizationSites.find((site) => site.id === template.operating_site_id)?.code,
              ),
            ),
        )
        .map((version) => version.id),
    );
    json(
      response,
      200,
      procedureStages.filter((stage) => allowedVersionIds.has(stage.procedure_version_id)),
    );
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/rest/v1/laundry_carts"
  ) {
    if (!requireSessionBearer(request, response)) return;
    const allowedSiteCodes = organizationSupervisorSiteCodes();
    json(
      response,
      200,
      laundryCarts.filter((cart) =>
        allowedSiteCodes.has(cart.institutions.operating_sites.code),
      ),
    );
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/rest/v1/laundry_orders") {
    if (!requireSessionBearer(request, response)) return;
    json(response, 200, laundryOrders.map((order) => {
      const cart = laundryCarts.find((candidate) => candidate.id === order.laundry_cart_id);
      return {
        ...order,
        updated_at: order.updated_at ?? "2026-08-18T00:00:00.000Z",
        institutions: cart?.institutions ?? { code: "CARE-A", name: "照護機構 A" },
        laundry_carts: { cart_number: cart?.cart_number ?? "—" },
      };
    }));
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/rest/v1/rpc/get_laundry_dashboard") {
    if (!requireSessionBearer(request, response)) return;
    json(response, 200, {
      site_id: "20000000-0000-4000-8000-000000000099",
      orders: {
        awaiting_receipt: laundryOrders.filter((order) => order.status === "awaiting_receipt").length,
        in_process: laundryOrders.filter((order) => order.status === "in_process" || order.status === "awaiting_cleaning").length,
        ready_for_pickup: laundryOrders.filter((order) => order.status === "ready_for_pickup").length,
        picked_up: laundryOrders.filter((order) => order.status === "picked_up").length,
      },
      batches: {
        not_started: laundryBatches.filter((batch) => batch.status === "not_started").length,
        in_progress: laundryBatches.filter((batch) => batch.status === "in_progress").length,
        paused: laundryBatches.filter((batch) => batch.status === "paused").length,
        completed: laundryBatches.filter((batch) => batch.status === "completed").length,
      },
      generated_at: "2026-08-18T00:00:00.000Z",
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/rest/v1/laundry_batch_stage_runs") {
    if (!requireSessionBearer(request, response)) return;
    const equipmentFilter = requestUrl.searchParams.get("laundry_equipment_id")?.replace(/^eq\./, "") ?? null;
    json(
      response,
      200,
      laundryBatches
        .filter((batch) => batch.active_stage_run_id && (!equipmentFilter || batch.active_equipment_id === equipmentFilter))
        .map((batch) => ({
          laundry_batch_id: batch.id,
          laundry_equipment_id: batch.active_equipment_id,
          status: "in_progress",
        })),
    );
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/rest/v1/laundry_batches") {
    if (!requireSessionBearer(request, response)) return;
    const siteFilter = requestUrl.searchParams.get("operating_site_id")?.replace(/^eq\./, "") ?? null;
    json(response, 200, laundryBatches.filter((batch) => !siteFilter || batch.operating_site_id === siteFilter).map((batch) => {
      const order = laundryOrders.find((candidate) => candidate.id === batch.laundry_order_id);
      const cart = laundryCarts.find((candidate) => candidate.id === order?.laundry_cart_id);
      return {
        ...batch,
        updated_at: batch.updated_at ?? "2026-08-18T00:00:00.000Z",
        laundry_orders: order
          ? {
              order_number: order.order_number,
              status: order.status,
              laundry_carts: cart
                ? { cart_number: cart.cart_number }
                : { cart_number: "CART-MAIN-01" },
              institutions: cart?.institutions
                ? { name: cart.institutions.name }
                : { name: "照護機構 A" },
            }
          : null,
        laundry_categories: { code: "SOILED", name: "汙衣" },
      };
    }));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/rest/v1/laundry_equipment_categories") {
    if (!requireSessionBearer(request, response)) return;
    json(response, 200, []);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/rest/v1/laundry_equipment_procedures") {
    if (!requireSessionBearer(request, response)) return;
    json(response, 200, []);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/rest/v1/laundry_equipment") {
    if (!requireSessionBearer(request, response)) return;
    const allowedSiteCodes = organizationSupervisorSiteCodes();
    json(response, 200, laundryEquipment.filter((equipment) => allowedSiteCodes.has(equipment.operating_sites.code)));
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname === "/rest/v1/access_memberships"
  ) {
    if (!requireSessionBearer(request, response)) return;
    json(response, 200, [
      {
        id: "50000000-0000-4000-8000-000000000098",
        role: "laundry_worker",
        active: true,
        user_access_profiles: {
          login_name: "existing.worker",
          active: true,
        },
        operating_sites: { code: "MAIN", name: "本館" },
        institutions: null,
      },
    ]);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/auth/v1/logout") {
    response.writeHead(204).end();
    return;
  }

  json(response, 404, { message: `Unhandled fake Supabase route: ${requestUrl.pathname}` });
});

server.listen(port, "127.0.0.1");

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
