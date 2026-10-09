import { z } from "zod";

const membershipSchema = z.object({
  membership_id: z.uuid(),
  role_code: z.enum(["pos_cashier", "pos_supervisor"]),
  account_id: z.uuid(),
  account_name: z.string().min(1),
  tenant_kind: z.enum(["customer", "sandbox"]),
  school_id: z.uuid(),
  school_location_id: z.uuid(),
  cafeteria_id: z.uuid(),
  cafeteria_name: z.string().min(1),
}).strict();

export const posAccessContextSchema = z.object({
  actor: z.object({ person_id: z.uuid(), display_name: z.string().min(1) }).strict(),
  memberships: z.array(membershipSchema).min(1),
  pov: z.object({
    session_id: z.uuid(),
    pov_code: z.literal("cashier"),
    expires_at: z.iso.datetime({ offset: true }),
  }).strict().nullable(),
}).strict().refine((context) => !context.pov || (
  context.memberships.length === 1 &&
  context.memberships[0].role_code === "pos_cashier" &&
  context.memberships[0].tenant_kind === "sandbox"
), { message: "Invalid cashier POV scope" });

export type PosAccessContext = z.infer<typeof posAccessContextSchema>;
