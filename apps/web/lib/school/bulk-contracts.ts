import { z } from "zod";
export const bulkPayloadLimit = 1048576;
// Rows deliberately remain unknown here so authoritative validation can report invalid
// values against source row numbers instead of silently dropping or rejecting the whole file.
const rows = z.array(z.unknown()).min(1).max(200);
export const bulkRequestSchema = z.discriminatedUnion("action", [
 z.object({ action: z.literal("validate"), schoolId: z.uuid(), rows }).strict(),
 z.object({ action: z.literal("commit"), schoolId: z.uuid(), rows, included_rows: z.array(z.number().int().positive().max(9999999)).min(1).max(200), confirmed: z.literal(true) }).strict(),
]);
const checked = z.object({ source_row: z.number().int().positive(), row: z.record(z.string(),z.unknown()), errors: z.array(z.string()) }).strict();
export const bulkValidationSchema = z.object({ school_id: z.uuid(), valid: z.boolean(), rows: z.array(checked).min(1).max(200) }).strict();
export const bulkCommitSchema = z.union([
 bulkValidationSchema.extend({ status: z.literal("invalid"), request_id: z.uuid() }),
 z.object({ status: z.literal("committed"), request_id: z.uuid(), school_id: z.uuid(), created: z.array(z.object({ source_row: z.number().int().positive(), student_id: z.uuid(), enrollment_id: z.uuid() }).strict()).min(1).max(200), excluded_rows: z.array(z.number().int().positive()).max(200) }).strict(),
]);
