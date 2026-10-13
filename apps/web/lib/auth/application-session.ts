import { z } from "zod";

export const applicationSessionSchema = z.object({
  session_id: z.uuid(), user_id: z.uuid(), server_now: z.iso.datetime({ offset: true }),
  started_at: z.iso.datetime({ offset: true }), last_active_at: z.iso.datetime({ offset: true }),
  idle_deadline: z.iso.datetime({ offset: true }), absolute_deadline: z.iso.datetime({ offset: true }),
  idle_seconds: z.union([z.literal(900), z.literal(1800)]),
}).strict();
export type ApplicationSession = z.infer<typeof applicationSessionSchema>;
export function remainingSessionMs(session: ApplicationSession) {
  return Math.max(0, Math.min(Date.parse(session.idle_deadline), Date.parse(session.absolute_deadline)) - Date.parse(session.server_now));
}
export function protectedSurface(path: string): "pos" | "admin" | null {
  if (path === "/pos" || path.startsWith("/pos/")) return "pos";
  return ["/platform", "/admin/escuela", "/admin/cafeteria", "/pilot/connected", "/familias", "/estudiante"].some(p => path === p || path.startsWith(p + "/")) ? "admin" : null;
}
