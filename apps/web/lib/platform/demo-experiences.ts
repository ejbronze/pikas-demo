import { z } from "zod";
import type { SandboxPovCode } from "./sandbox-pov";
export const demoExperienceSchema = z.enum(["school", "cafeteria", "pos"]);
export type DemoExperience = z.infer<typeof demoExperienceSchema>;
export const demoExperiences = [
  { experience: "school", code: "school_admin", label: "Escuela", description: "Estudiantes, PIKAS Cash y administración escolar." },
  { experience: "cafeteria", code: "cafeteria_admin", label: "Cafetería", description: "Productos, servicios y administración de cafetería." },
  { experience: "pos", code: "cashier", label: "Caja / POS", description: "Explora la caja y las ventas con José, el cajero de demostración." },
] as const;
export function demoLabel(code: SandboxPovCode) { return demoExperiences.find(e => e.code === code)!.label; }
