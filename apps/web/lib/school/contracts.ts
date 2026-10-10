import { z } from "zod";
const id = z.uuid();
const name = z.string().trim().min(1).max(80);
const optionalLabel = z.string().trim().max(80).nullable();
const placement = { location_id: id.nullable(), starts_on: z.iso.date(), grade: optionalLabel, class: optionalLabel, homeroom: optionalLabel };
const studentNames = { first_name: name, last_name: name, student_code: z.string().trim().min(1).max(64) };
export const schoolContextSchema = z.object({ person_id: id, display_name: z.string(), schools: z.array(z.object({ school_id: id, school_name: z.string(), account_id: id, account_name: z.string(), tenant_kind: z.enum(["customer", "sandbox"]) }).strict()) }).strict();
export type SchoolContext = z.infer<typeof schoolContextSchema>;
export const sectionSchema = z.enum(["summary", "students", "administrators", "cafeterias", "activity"]);
export type SchoolSection = z.infer<typeof sectionSchema>;
export const commandSchema = z.discriminatedUnion("operation", [
  z.object({ schoolId: id, operation: z.literal("student_create"), payload: z.object({ ...studentNames, ...placement }).strict() }).strict(),
  z.object({ schoolId: id, operation: z.literal("student_update"), payload: z.object({ student_id: id, ...studentNames }).strict() }).strict(),
  z.object({ schoolId: id, operation: z.literal("student_status"), payload: z.object({ student_id: id, status: z.enum(["active", "suspended", "inactive"]) }).strict() }).strict(),
  ...(["student_enroll", "student_transfer"] as const).map(operation => z.object({ schoolId: id, operation: z.literal(operation), payload: z.object({ student_id: id, ...placement }).strict() }).strict()),
  z.object({ schoolId: id, operation: z.literal("student_withdraw"), payload: z.object({ student_id: id, ends_on: z.iso.date() }).strict() }).strict(),
  z.object({ schoolId: id, operation: z.literal("admin_prepare"), payload: z.object({ email: z.email().trim().max(254) }).strict() }).strict(),
  z.object({ schoolId: id, operation: z.literal("admin_complete"), payload: z.object({ invitation_id: id, display_name: z.string().trim().min(1).max(200) }).strict() }).strict(),
  z.object({ schoolId: id, operation: z.literal("admin_status"), payload: z.object({ membership_id: id, status: z.enum(["active", "suspended"]) }).strict() }).strict(),
  z.object({ schoolId: id, operation: z.literal("sharing_set"), payload: z.object({ cafeteria_id: id, status: z.enum(["active", "revoked"]), categories: z.array(z.enum(["basic_identification", "student_code", "placement", "dietary_restrictions"])).max(4) }).strict() }).strict(),
  z.object({ schoolId: id, operation: z.literal("customer_set"), payload: z.object({ cafeteria_id: id, student_id: id, enabled: z.boolean() }).strict() }).strict(),
]);
export type SchoolCommand = z.infer<typeof commandSchema>;
export const commandResultSchema = z.object({ student_id: id.optional(), enrollment_id: id.optional(), share_id: id.optional(), customer_id: id.optional(), membership_id: id.optional(), invitation_id: id.optional(), status: z.enum(["pending", "accepted"]).optional() }).strict().refine(v => Object.keys(v).some(k => k.endsWith("_id")));
const enrollmentSchema = z.object({ id, starts_on: z.iso.date(), location_id: id.nullable(), grade: z.string().nullable(), class: z.string().nullable(), homeroom: z.string().nullable() });
const studentSchema = z.object({ id, first_name: z.string(), last_name: z.string(), display_name: z.string(), student_code: z.string(), status: z.enum(["active", "suspended", "inactive"]), enrollment: enrollmentSchema.nullable() });
export type SchoolStudent = z.infer<typeof studentSchema>;
export const readSchema = z.object({
  scope: z.object({ actor_id: id, membership_id: id, role: z.enum(["account_admin", "school_admin"]), account_id: id, school_id: id, account_name: z.string(), school_name: z.string(), tenant_kind: z.enum(["customer", "sandbox"]) }).strict(),
  locations: z.array(z.object({ id, name: z.string() })),
  counts: z.object({ students: z.number().int().nonnegative(), active: z.number().int().nonnegative(), suspended: z.number().int().nonnegative(), inactive: z.number().int().nonnegative(), cafeterias: z.number().int().nonnegative() }).optional(),
  rows: z.array(z.union([studentSchema, z.object({ id, name: z.string(), location: z.string(), status: z.string(), sharing_status: z.enum(["active", "revoked"]), categories: z.array(z.string()), customer_count: z.number().int(), customers: z.array(z.object({ student_id: id, display_name: z.string(), status: z.string() })) }), z.object({ id, occurred_at: z.string(), action: z.string(), target_type: z.string(), actor_name: z.string().nullable() })])).optional(),
  next_cursor: id.nullable().optional(),
  memberships: z.array(z.object({ id, display_name: z.string(), status: z.string(), role: z.enum(["account_admin", "school_admin"]), self: z.boolean(), manageable: z.boolean() })).optional(),
  invitations: z.array(z.object({ id, email: z.string(), status: z.string(), expires_at: z.string() })).optional(),
}).strict();
export type SchoolRead = z.infer<typeof readSchema>;
