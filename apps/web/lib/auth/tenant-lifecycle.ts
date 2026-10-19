// Customer lifecycle (Platform > Clientes) blocks tenant access centrally in the database. This only
// chooses the message after authentication: the person's organization is suspended or closed.
// It never exposes reasons, operators or other organizations, and grants nothing.
type RpcClient = { rpc: (name: string) => PromiseLike<{ data: unknown; error: unknown }> };
export async function organizationDenial(client: RpcClient): Promise<"organization_suspended" | "organization_closed" | null> {
  try {
    const { data, error } = await client.rpc("tenant_lifecycle_state");
    if (error) return null;
    return data === "suspended" ? "organization_suspended" : data === "closed" ? "organization_closed" : null;
  } catch { return null; }
}
