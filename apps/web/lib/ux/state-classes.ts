// UX 14: one small classification layer between what actually happened (a Postgres/PostgREST error,
// an HTTP status, a business code) and what the person is told. Seven kinds, each with a different
// next step; copy stays with the surface, this file only decides the kind and the default wording.
//
//   temporary       something failed unexpectedly; retrying may help
//   permission      the person has no authority for this view or action; retrying cannot help
//   not_found       the resource does not exist or is no longer available
//   not_configured  the resource exists but setup is incomplete (someone must configure it)
//   lifecycle       the customer/resource is suspended, closed, inactive or revoked
//   validation      the request itself is invalid (filters, a stale URL, bad input); reset or correct it
//   empty           nothing is wrong, there are simply no records yet (EmptyState, never ErrorState)
//
// Business codes keep their meaning: a 42501 is a permission problem by default, but the database
// names specific refusals (expired temporary credential, demo mode, suspended customer…) that are
// not "no permission" to the person; `messageKinds` carries those. Nothing here infers reasons the
// person is not authorized to know: unknown messages fall back to the code's kind, never to a guess.
export type StateKind = "temporary" | "permission" | "not_found" | "not_configured" | "lifecycle" | "validation" | "empty";
export type FailureKind = Exclude<StateKind, "empty">;

export type ErrorLike = { code?: string | null; message?: string | null } | null | undefined;

// Postgres SQLSTATE and PostgREST codes PIKAS raises or meets.
const codeKinds: Record<string, FailureKind> = {
  "42501": "permission",       // insufficient_privilege: every capability/authority refusal
  P0002: "not_found",          // no_data_found: the id does not resolve in the caller's scope
  PGRST116: "not_found",       // PostgREST: single row expected, none returned
  "22023": "validation",       // invalid_parameter_value: filters, payload shape
  "23514": "validation",       // check_violation
  "22003": "validation", "22001": "validation", "23503": "validation", "23505": "validation", "22P02": "validation",
  "40001": "temporary",        // serialization_failure (retry is correct)
  "55000": "temporary", "55P03": "temporary", "57014": "temporary", "53300": "temporary", "08000": "temporary", "08006": "temporary",
  PGRST301: "temporary", PGRST302: "temporary",
  "54000": "validation",       // program_limit_exceeded (e.g. export too large): narrow the request
};

// Named refusals whose kind is not the code's default. Keys are the exact database/API messages.
export const messageKinds: Record<string, FailureKind> = {
  customer_suspended: "lifecycle", customer_closed: "lifecycle", organization_suspended: "lifecycle", organization_closed: "lifecycle",
  wallet_not_active: "lifecycle", register_session_closed: "lifecycle", register_session_already_closed: "lifecycle",
  existing_membership_not_active: "lifecycle", login_suspended: "lifecycle",
  temporary_access_expired: "permission", temporary_expired: "permission", demo_mode_active: "permission", platform_actor_changed: "permission",
  session_owner_required: "permission", authentication_required: "permission",
  register_not_ready: "not_configured", active_register_required: "not_configured", enabled_catalog_currency_required: "not_configured",
  menu_products_required: "not_configured", pending_provisioning_required: "not_configured",
  FINANCIAL_POLICY_NOT_ACTIVE: "not_configured",
  REPLENISHMENT_REQUEST_NOT_FOUND: "not_found", CUSTOMER_INELIGIBLE: "lifecycle",
  invalid_filters: "validation", student_export_limit: "validation",
};

// The kind of a failed read or call. `known` lets a surface declare its own message → kind pairs
// (for example a route's JSON `error` names) without widening the shared table.
export function classifyError(error: ErrorLike, known: Record<string, FailureKind> = {}): FailureKind {
  if (!error) return "temporary";
  const message = error.message ?? "";
  if (message in known) return known[message];
  if (message in messageKinds) return messageKinds[message];
  const code = error.code ?? "";
  if (code in codeKinds) return codeKinds[code];
  if (code in known) return known[code];
  // PostgREST network/connection classes and anything unknown: a retry is the honest next step.
  return "temporary";
}

// The kind behind an HTTP status from PIKAS' own routes (which already translate database refusals).
export function classifyStatus(status: number, body?: { error?: string } | null, known: Record<string, FailureKind> = {}): FailureKind {
  const named = body?.error ?? "";
  if (named in known) return known[named];
  if (named in messageKinds) return messageKinds[named];
  if (status === 401 || status === 403) return "permission";
  if (status === 404 || status === 410) return "not_found";
  if (status === 400 || status === 413 || status === 422) return "validation";
  if (status === 409) return "temporary";
  return "temporary";
}

// Default wording per kind. Surfaces override the title with the concrete thing that failed and, where
// safe, say who owns the next step; the description keeps the honest next action.
export const stateCopy: Record<FailureKind, { title: string; description: string; retry: boolean }> = {
  temporary: { title: "No pudimos cargar esta información.", description: "Inténtalo de nuevo. Si continúa, vuelve a esta sección más tarde.", retry: true },
  permission: { title: "No tienes acceso a esta sección.", description: "Tu rol no incluye este permiso. Si crees que deberías tenerlo, pídelo a quien administra tu acceso.", retry: false },
  not_found: { title: "No encontramos este recurso.", description: "Puede haber sido desactivado o la dirección ya no es válida.", retry: false },
  not_configured: { title: "Esta sección todavía no está configurada.", description: "Falta completar su configuración antes de poder usarla.", retry: false },
  lifecycle: { title: "Este recurso no está disponible en su estado actual.", description: "Su estado impide esta operación. Solo quien lo administra puede restaurarlo.", retry: false },
  validation: { title: "La solicitud no es válida.", description: "Revisa los datos o vuelve a empezar desde la sección.", retry: false },
};

// Wording for a response PIKAS received but could not read (contract mismatch). Not a permission or
// network problem and not something the person can fix: say so, and still allow a retry.
export const invalidResponseCopy = { title: "No pudimos mostrar esta información.", description: "La respuesta recibida no tiene el formato esperado. Inténtalo de nuevo; si continúa, avisa a PIKAS." };
