export function formatInstitutionLabel(code?: string, name?: string): string {
  const trimmedCode = code?.trim() ?? "";
  const trimmedName = name?.trim() ?? "";
  if (!trimmedCode && !trimmedName) return "未知機構";
  if (!trimmedCode) return trimmedName;
  if (!trimmedName) return trimmedCode;
  if (trimmedName.startsWith(trimmedCode)) return trimmedName;
  return `${trimmedCode}${trimmedName}`;
}
