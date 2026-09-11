import "server-only";

import { z } from "zod";

import { isLaundrySupervisorRole } from "@/lib/auth/access-role";
import { requireRole, type AccessMembership } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const categorySchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  sort_order: z.number().int().nonnegative(),
  active: z.boolean(),
});

const templateSchema = z.object({
  id: z.uuid(),
  operating_site_id: z.uuid(),
  laundry_category_id: z.uuid(),
  active: z.boolean(),
});

const versionSchema = z.object({
  id: z.uuid(),
  procedure_template_id: z.uuid(),
  version_no: z.number().int().positive(),
  template_name: z.string().min(1),
  status: z.enum(["draft", "published", "retired"]),
  created_at: z.string(),
  published_at: z.string().nullable(),
});

const stageSchema = z.object({
  id: z.uuid(),
  procedure_version_id: z.uuid(),
  stage_order: z.number().int().positive(),
  name: z.string().min(1),
  standard_minutes: z.number().int().positive(),
  equipment_type: z.enum([
    "manual",
    "disinfection_tank",
    "washer",
    "dryer",
    "cart",
  ]),
  compatibility_conditions: z.record(z.string(), z.unknown()),
  transition_mode: z.enum(["manual", "timer"]),
  requires_operator_confirmation: z.boolean(),
});

const categoryChangeResultSchema = z.array(
  z.object({ laundry_category_id: z.uuid(), already_applied: z.boolean() }),
);

const draftChangeResultSchema = z.array(
  z.object({
    procedure_template_id: z.uuid(),
    procedure_version_id: z.uuid(),
    version_no: z.number().int().positive(),
    already_applied: z.boolean(),
  }),
);

const activeChangeResultSchema = z.array(
  z.object({
    procedure_template_id: z.uuid(),
    already_applied: z.boolean(),
  }),
);

export type ProcedureCategory = z.infer<typeof categorySchema>;
export type ProcedureStage = z.infer<typeof stageSchema>;
export type ProcedureVersion = z.infer<typeof versionSchema> & {
  stages: ProcedureStage[];
};
export type ProcedureTemplate = z.infer<typeof templateSchema> & {
  siteCode: string;
  siteName: string;
  categoryCode: string;
  categoryName: string;
  versions: ProcedureVersion[];
};
export type ProcedureWorkspace = {
  sites: AccessMembership[];
  categories: ProcedureCategory[];
  templates: ProcedureTemplate[];
};

const procedureWorkspaceResultSchema = z.object({
  categories: z.array(categorySchema),
  templates: z.array(templateSchema),
  versions: z.array(versionSchema),
  stages: z.array(stageSchema),
});

function parseStagesJson(value: string): unknown | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

function mutationResult<T extends unknown[]>(
  data: unknown,
  error: unknown,
  schema: z.ZodType<T>,
): T | null {
  if (error) return null;
  const parsed = schema.safeParse(data);
  return parsed.success && parsed.data.length === 1 ? parsed.data : null;
}

export async function getProcedureWorkspace(): Promise<ProcedureWorkspace> {
  const principal = await requireRole("laundry_supervisor");
  const sites = principal.memberships.filter(
    (membership) =>
      isLaundrySupervisorRole(membership.role) &&
      membership.operating_site_id !== null,
  );
  const supabase = await createServerSupabaseClient();
  const [categoriesResult, templatesResult, versionsResult, stagesResult] =
    await Promise.all([
      supabase
        .from("laundry_categories")
        .select("id, code, name, sort_order, active")
        .order("sort_order", { ascending: true }),
      supabase
        .from("procedure_templates")
        .select("id, operating_site_id, laundry_category_id, active"),
      supabase
        .from("procedure_template_versions")
        .select(
          "id, procedure_template_id, version_no, template_name, status, created_at, published_at",
        )
        .order("version_no", { ascending: true }),
      supabase
        .from("procedure_template_stages")
        .select(
          "id, procedure_version_id, stage_order, name, standard_minutes, equipment_type, compatibility_conditions, transition_mode, requires_operator_confirmation",
        )
        .order("stage_order", { ascending: true }),
    ]);
  const parsed = procedureWorkspaceResultSchema.safeParse({
    categories: categoriesResult.data,
    templates: templatesResult.data,
    versions: versionsResult.data,
    stages: stagesResult.data,
  });
  if (
    categoriesResult.error ||
    templatesResult.error ||
    versionsResult.error ||
    stagesResult.error ||
    !parsed.success
  ) {
    throw new Error("procedure workspace unavailable");
  }

  const sitesById = new Map(sites.map((site) => [site.operating_site_id, site]));
  const categoriesById = new Map(
    parsed.data.categories.map((category) => [category.id, category]),
  );
  const stagesByVersion = new Map<string, ProcedureStage[]>();
  for (const stage of parsed.data.stages) {
    const stagesForVersion = stagesByVersion.get(stage.procedure_version_id) ?? [];
    stagesForVersion.push(stage);
    stagesByVersion.set(stage.procedure_version_id, stagesForVersion);
  }
  const versionsByTemplate = new Map<string, ProcedureVersion[]>();
  for (const version of parsed.data.versions) {
    const versionsForTemplate = versionsByTemplate.get(version.procedure_template_id) ?? [];
    versionsForTemplate.push({
      ...version,
      stages: stagesByVersion.get(version.id) ?? [],
    });
    versionsByTemplate.set(version.procedure_template_id, versionsForTemplate);
  }

  const templates = parsed.data.templates.flatMap((template) => {
    const site = sitesById.get(template.operating_site_id);
    const category = categoriesById.get(template.laundry_category_id);
    if (!site || !category) return [];
    return [
      {
        ...template,
        siteCode: site.scope_code,
        siteName: site.scope_name,
        categoryCode: category.code,
        categoryName: category.name,
        versions: versionsByTemplate.get(template.id) ?? [],
      },
    ];
  });

  return { sites, categories: parsed.data.categories, templates };
}

export type CategoryMutationResult =
  | { kind: "applied" | "already-applied"; categoryId: string }
  | { kind: "invalid" | "failed" };

const categoryCreateInputSchema = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().nonnegative(),
  requestId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

export async function createLaundryCategory(
  input: unknown,
): Promise<CategoryMutationResult> {
  await requireRole("laundry_supervisor");
  const parsed = categoryCreateInputSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("create_laundry_category", {
    category_code: parsed.data.code.toUpperCase(),
    category_name: parsed.data.name,
    category_sort_order: parsed.data.sortOrder,
    change_request_id: parsed.data.requestId,
    change_reason: parsed.data.reason,
  });
  const result = mutationResult(data, error, categoryChangeResultSchema);
  if (!result) return { kind: "failed" };
  return {
    kind: result[0].already_applied ? "already-applied" : "applied",
    categoryId: result[0].laundry_category_id,
  };
}

const categoryUpdateInputSchema = categoryCreateInputSchema.extend({
  categoryId: z.uuid(),
  active: z.boolean(),
});

export async function updateLaundryCategory(
  input: unknown,
): Promise<CategoryMutationResult> {
  await requireRole("laundry_supervisor");
  const parsed = categoryUpdateInputSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("update_laundry_category", {
    target_laundry_category_id: parsed.data.categoryId,
    category_name: parsed.data.name,
    category_sort_order: parsed.data.sortOrder,
    category_active: parsed.data.active,
    change_request_id: parsed.data.requestId,
    change_reason: parsed.data.reason,
  });
  const result = mutationResult(data, error, categoryChangeResultSchema);
  if (!result) return { kind: "failed" };
  return {
    kind: result[0].already_applied ? "already-applied" : "applied",
    categoryId: result[0].laundry_category_id,
  };
}

export type ProcedureMutationResult =
  | {
      kind: "applied" | "already-applied";
      templateId: string;
      versionId: string;
      versionNo: number;
    }
  | { kind: "invalid" | "failed" };

const procedureDraftInputSchema = z.object({
  templateId: z.uuid().nullable(),
  siteCode: z.string().trim().max(40),
  categoryCode: z.string().trim().max(40),
  name: z.string().trim().min(1).max(120),
  stagesJson: z.string().trim().min(2),
  requestId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

export async function createProcedureTemplateDraft(
  input: unknown,
): Promise<ProcedureMutationResult> {
  await requireRole("laundry_supervisor");
  const parsed = procedureDraftInputSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const stages = parseStagesJson(parsed.data.stagesJson);
  if (!stages) return { kind: "invalid" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("create_procedure_template_draft", {
    target_template_id: parsed.data.templateId,
    target_site_code: parsed.data.siteCode.toUpperCase() || null,
    target_category_code: parsed.data.categoryCode.toUpperCase() || null,
    template_name: parsed.data.name,
    stages,
    change_request_id: parsed.data.requestId,
    change_reason: parsed.data.reason,
  });
  const result = mutationResult(data, error, draftChangeResultSchema);
  if (!result) return { kind: "failed" };
  return {
    kind: result[0].already_applied ? "already-applied" : "applied",
    templateId: result[0].procedure_template_id,
    versionId: result[0].procedure_version_id,
    versionNo: result[0].version_no,
  };
}

const procedureUpdateInputSchema = z.object({
  versionId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  stagesJson: z.string().trim().min(2),
  requestId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

export async function updateProcedureTemplateDraft(
  input: unknown,
): Promise<ProcedureMutationResult> {
  await requireRole("laundry_supervisor");
  const parsed = procedureUpdateInputSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const stages = parseStagesJson(parsed.data.stagesJson);
  if (!stages) return { kind: "invalid" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("update_procedure_template_draft", {
    target_procedure_version_id: parsed.data.versionId,
    template_name: parsed.data.name,
    stages,
    change_request_id: parsed.data.requestId,
    change_reason: parsed.data.reason,
  });
  const result = mutationResult(data, error, draftChangeResultSchema);
  if (!result) return { kind: "failed" };
  return {
    kind: result[0].already_applied ? "already-applied" : "applied",
    templateId: result[0].procedure_template_id,
    versionId: result[0].procedure_version_id,
    versionNo: result[0].version_no,
  };
}

export async function publishProcedureTemplateVersion(
  input: unknown,
): Promise<ProcedureMutationResult> {
  await requireRole("laundry_supervisor");
  const parsed = z
    .object({ versionId: z.uuid(), requestId: z.uuid(), reason: z.string().trim().min(1).max(500) })
    .safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("publish_procedure_template_version", {
    target_procedure_version_id: parsed.data.versionId,
    change_request_id: parsed.data.requestId,
    change_reason: parsed.data.reason,
  });
  const result = mutationResult(data, error, draftChangeResultSchema);
  if (!result) return { kind: "failed" };
  return {
    kind: result[0].already_applied ? "already-applied" : "applied",
    templateId: result[0].procedure_template_id,
    versionId: result[0].procedure_version_id,
    versionNo: result[0].version_no,
  };
}

export async function setProcedureTemplateActive(
  input: unknown,
): Promise<CategoryMutationResult> {
  await requireRole("laundry_supervisor");
  const parsed = z
    .object({
      templateId: z.uuid(),
      active: z.boolean(),
      requestId: z.uuid(),
      reason: z.string().trim().min(1).max(500),
    })
    .safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("set_procedure_template_active", {
    target_procedure_template_id: parsed.data.templateId,
    template_active: parsed.data.active,
    change_request_id: parsed.data.requestId,
    change_reason: parsed.data.reason,
  });
  const result = mutationResult(data, error, activeChangeResultSchema);
  if (!result) return { kind: "failed" };
  return {
    kind: result[0].already_applied ? "already-applied" : "applied",
    categoryId: result[0].procedure_template_id,
  };
}
