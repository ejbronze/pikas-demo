import { z } from 'zod';
// PostgreSQL UUID entity columns also accept legacy deterministic GUIDs.
const id = z.guid();
const version = z.number().int().positive();
const name = z.string().trim().min(1).max(120);
const description = z.string().trim().max(500);
const food = z.array(z.string().trim().min(1).max(80)).max(30);
const posRole = z.enum(['pos_cashier', 'pos_supervisor']);
const memberStatus = z.enum(['active', 'suspended', 'inactive']);
const base = { id, version: version.nullable() };
const payloads = {
 product_save: z.object({ ...base, name, description, category: z.string().trim().min(1).max(80), price_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), active: z.boolean(), available: z.boolean(), ingredients: food, allergens: food }).strict(),
 category_save: z.object({ ...base, name: z.string().trim().min(1).max(80), display_order: z.number().int(), status: z.enum(['active','archived']) }).strict(),
 menu_save: z.object({ ...base, name, description, active: z.boolean(), product_ids: z.array(id).max(10000) }).strict(),
 shift_save: z.object({ ...base, menu_id: id, name, start_time: z.string().regex(/^\d{2}:\d{2}$/), end_time: z.string().regex(/^\d{2}:\d{2}$/), enabled: z.boolean(), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7) }).strict(),
 settings_save: z.object({ version, scheduling_enabled: z.boolean() }).strict(),
 staff_prepare: z.object({ email: z.email().trim().max(254), role: posRole }).strict(),
 staff_complete: z.object({ invitation_id: id, display_name: z.string().trim().min(1).max(200) }).strict(),
 staff_status: z.object({ membership_id: id, status: memberStatus }).strict(),
 register_save: z.object({ ...base, code: z.string().trim().min(1).max(32), name, status: z.enum(['active','inactive']) }).strict(),
 assignment_save: z.object({ membership_id: id, register_id: id, status: z.enum(['active','inactive']), version: version.nullable() }).strict(),
};
export const commandSchema = z.discriminatedUnion('operation', [
 z.object({ cafeteriaId:id, operation:z.literal('product_save'), payload:payloads.product_save }).strict(),
 z.object({ cafeteriaId:id, operation:z.literal('category_save'), payload:payloads.category_save }).strict(),
 z.object({ cafeteriaId:id, operation:z.literal('menu_save'), payload:payloads.menu_save }).strict(),
 z.object({ cafeteriaId:id, operation:z.literal('shift_save'), payload:payloads.shift_save }).strict(),
 z.object({ cafeteriaId:id, operation:z.literal('settings_save'), payload:payloads.settings_save }).strict(),
 z.object({ cafeteriaId:id, operation:z.literal('staff_prepare'), payload:payloads.staff_prepare }).strict(),
 z.object({ cafeteriaId:id, operation:z.literal('staff_complete'), payload:payloads.staff_complete }).strict(),
 z.object({ cafeteriaId:id, operation:z.literal('staff_status'), payload:payloads.staff_status }).strict(),
 z.object({ cafeteriaId:id, operation:z.literal('register_save'), payload:payloads.register_save }).strict(),
 z.object({ cafeteriaId:id, operation:z.literal('assignment_save'), payload:payloads.assignment_save }).strict(),
]);
export type Operation = keyof typeof payloads;
export type CafeteriaCommand = { cafeteriaId: string; operation: Operation; payload: unknown };
export const commandResultSchema = z.object({ request_id: z.uuid(), operation: z.enum(Object.keys(payloads) as [Operation,...Operation[]]), target_id: id.nullable() }).strict();
const cafeteria = { cafeteria_id: id, cafeteria_name: z.string(), account_name: z.string(), school_name: z.string(), location_name: z.string(), tenant_kind: z.enum(['customer','sandbox']) };
export const contextSchema = z.object({ person_id: id, display_name: z.string(), cafeterias: z.array(z.object(cafeteria).strict()) }).strict();
export type CafeteriaContext = z.infer<typeof contextSchema>;
export const readSchema = z.object({
 scope: z.object({ ...cafeteria, actor_id: id, membership_id: id, account_id: id, capabilities: z.array(z.string()) }).strict(),
 settings: z.object({ currency: z.literal('DOP'), scheduling_enabled: z.boolean(), version }),
 categories: z.array(z.object({ id, name: z.string(), status: z.enum(['active','archived']), display_order: z.number().int(), version })),
 products: z.array(z.object({ id, name: z.string(), description: z.string(), category_id: id.nullable(), price_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), active: z.boolean(), available: z.boolean(), ingredients: z.array(z.string()), allergens: z.array(z.string()), version })),
 menus: z.array(z.object({ id, name: z.string(), description: z.string(), active: z.boolean(), version, product_ids: z.array(id) })),
 shifts: z.array(z.object({ id, menu_id: id, name: z.string(), start_time: z.string(), end_time: z.string(), enabled: z.boolean(), version, weekdays: z.array(z.number().int()) })),
 registers: z.array(z.object({ id, code: z.string(), name: z.string(), status: z.enum(['active','inactive']), version, has_history: z.boolean(), open: z.boolean() })),
 staff: z.array(z.object({ id, name: z.string(), role: posRole, status: memberStatus, open: z.boolean() })),
 assignments: z.array(z.object({ id, membership_id: id, register_id: id, status: z.enum(['active','inactive']), version })),
 invitations: z.array(z.object({ id, email: z.string(), role: posRole, status: z.enum(['pending','accepted','expired','revoked']), expires_at: z.string() })),
 service: z.object({status:z.enum(['manual','no_active_service','invalid_configuration','active']),scheduling_enabled:z.boolean(),business_date:z.string(),local_time:z.string(),business_timezone:z.string(),service_shift_id:id.nullable(),service_shift_name:z.string().nullable(),menu_id:id.nullable(),menu_name:z.string().nullable()}).nullable(),
}).strict();
export type CafeteriaRead = z.infer<typeof readSchema>;
