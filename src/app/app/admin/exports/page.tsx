import { redirect } from "next/navigation";

export default function ExportsPage() {
  redirect("/app/admin/bi#tab=exports");
}
