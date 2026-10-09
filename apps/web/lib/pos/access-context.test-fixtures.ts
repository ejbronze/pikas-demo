import type { PosAccessContext } from "./access-context";

export function posContext(sandbox = true): PosAccessContext {
  return {
    actor: {
      person_id: "33333333-3333-4333-8333-333333333333",
      display_name: sandbox ? "José Ramírez" : "Tenant cashier",
    },
    memberships: [{
      membership_id: "11111111-1111-4111-8111-111111111111",
      role_code: "pos_cashier",
      account_id: "03e71159-69e9-4387-9b3b-65799d49faf0",
      account_name: "Colegio Horizonte",
      tenant_kind: sandbox ? "sandbox" : "customer",
      school_id: "df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488",
      school_location_id: "cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4",
      cafeteria_id: "b9496342-5079-46ae-83b8-05c39bcbd7fe",
      cafeteria_name: "Cafetería Escolar",
    }],
    pov: sandbox ? {
      session_id: "22222222-2222-4222-8222-222222222222",
      pov_code: "cashier",
      expires_at: "2099-01-01T00:00:00+00:00",
    } : null,
  };
}
