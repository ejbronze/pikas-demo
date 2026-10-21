import { z } from "zod";
import type { SchoolStudent } from "./contracts";

// PIKAS UX 6 Student workspace: one student, read through existing School authority and reduced on
// the server before presentation. No balances history, purchases, cafetería sales or IDs are rendered.

// school_student_roster pages by id (`id > p_after`, ordered by id). Asking for the single row after
// the id just below this one returns exactly this student, with the roster's own guards and scope.
export function uuidPredecessor(id: string): string | null {
  const hex = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  const n = BigInt(`0x${hex}`);
  if (n === 0n) return null;
  const p = (n - 1n).toString(16).padStart(32, "0");
  return `${p.slice(0, 8)}-${p.slice(8, 12)}-${p.slice(12, 16)}-${p.slice(16, 20)}-${p.slice(20)}`;
}

// PIKAS Cash, school:wallets:read only: the existing school_wallet_read returns the wallet and its
// movements (including purchase lines). Only the wallet's state and balance are kept.
export const walletReadSchema = z.object({ school_id: z.guid(), student_id: z.guid(), wallet: z.object({ status: z.enum(["active", "frozen"]), balance_minor: z.string().regex(/^-?(0|[1-9][0-9]*)$/) }).passthrough().nullable() }).passthrough();
export type WalletState = { status: "active" | "frozen"; balance_minor: string } | null;
export const walletState = (r: z.infer<typeof walletReadSchema>): WalletState => r.wallet ? { status: r.wallet.status, balance_minor: r.wallet.balance_minor } : null;

// Service: the student's active cafetería relationships (school:customers:read) joined to the
// school's cafeterías (school:sharing:read), reduced to what the School may know about service.
export const customerRowsSchema = z.array(z.object({ cafeteria_id: z.guid(), status: z.string() }));
type CafeteriaRead = { id: string; name: string; location: string; status: string; sharing_status: "active" | "revoked" };
export type ServiceEntry = { name: string; location: string; serving: boolean };
export const studentService = (enabledCafeteriaIds: string[], cafeterias: CafeteriaRead[]): ServiceEntry[] =>
  cafeterias.filter(c => enabledCafeteriaIds.includes(c.id)).map(c => ({ name: c.name, location: c.location, serving: c.status === "active" && c.sharing_status === "active" }));

// Restrictions (school:restrictions:read): active ones, label and kind only.
export const restrictionRowsSchema = z.array(z.object({ restriction_type: z.enum(["allergen", "dietary", "avoidance"]), display_label: z.string(), starts_on: z.string(), ends_on: z.string().nullable() }));
export type Restriction = { kind: "allergen" | "dietary" | "avoidance"; label: string; until: string | null };
export const restrictionKind = { allergen: "Alérgeno", dietary: "Dieta", avoidance: "Evitar" } as const;

export type WorkspaceInputs = { student: SchoolStudent; wallet: WalletState | undefined; service: ServiceEntry[] | null; restrictions: Restriction[] | null };

// A few explainable, school-side conditions. Wallet ones only exist with wallet authority.
export type StudentAttention = { key: string; text: string };
export function studentAttention(i: WorkspaceInputs): StudentAttention[] {
  const items: StudentAttention[] = [], e = i.student.enrollment;
  if (i.student.status === "suspended") items.push({ key: "suspended", text: "El estudiante está suspendido." });
  if (i.student.status === "inactive") items.push({ key: "inactive", text: "El estudiante está inactivo en el colegio." });
  if (!e) items.push({ key: "enrollment", text: "No tiene una matrícula activa." });
  else if (!e.location_id || !e.grade) items.push({ key: "placement", text: `La matrícula no tiene ${[!e.location_id && "campus", !e.grade && "grado"].filter(Boolean).join(" ni ")} asignado.` });
  if (i.wallet?.status === "frozen") items.push({ key: "frozen", text: "El monedero de PIKAS Cash está congelado." });
  if (i.wallet && i.wallet.balance_minor.startsWith("-")) items.push({ key: "negative", text: "El monedero de PIKAS Cash tiene saldo negativo." });
  if (i.service && i.service.length > 0 && !i.service.some(s => s.serving)) items.push({ key: "service", text: "Está habilitado en una cafetería sin compartición activa con el colegio." });
  return items;
}
