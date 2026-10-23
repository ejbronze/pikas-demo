import { redirect } from "next/navigation";
import { z } from "zod";
import { workspaceHref } from "../../../../../lib/platform/workspace";

// UX 15: the separate "gestión" landing is no longer a destination. Operación lives in the customer
// workspace; the route stays for older links and sends them there. Per-cafetería management keeps
// its own routes beneath this one.
export default async function CustomerManagementPage({ params }: { params: Promise<{ accountId: string }> }) {
  const id = z.guid().safeParse((await params).accountId);
  redirect(id.success ? workspaceHref(id.data, "operacion") : "/platform/clientes");
}
