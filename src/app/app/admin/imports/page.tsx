import { redirect } from "next/navigation";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ImportsPage({ searchParams }: Props) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.set(key, value);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  redirect(`/app/admin/bi${suffix}#tab=imports`);
}
