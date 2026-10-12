import { z } from "zod";

export const sandboxPovCodeSchema = z.enum(["cashier", "school_admin", "cafeteria_admin"]);
export type SandboxPovCode = z.infer<typeof sandboxPovCodeSchema>;
export const sandboxPovSchema = z.object({
  session_id: z.uuid(), pov_code: sandboxPovCodeSchema,
  operator_person_id: z.uuid(), operator_name: z.string(),
  expires_at: z.iso.datetime({ offset: true }),
}).strict();
export type SandboxPov = z.infer<typeof sandboxPovSchema>;
export const experienceLabel: Record<SandboxPovCode, string> = {
  cashier: "Cajero", school_admin: "Administrador escolar", cafeteria_admin: "Administrador de cafetería",
};
export function sandboxDestination(code: SandboxPovCode, schoolId: string, cafeteriaId: string) {
  if (code === "school_admin") return `/admin/escuela?school=${schoolId}`;
  if (code === "cafeteria_admin") return `/admin/cafeteria?cafeteria=${cafeteriaId}`;
  return "/pos";
}
