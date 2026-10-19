import "server-only";
import { cookies } from "next/headers";
import { isDemoMode } from "../env";
import type { FamilyRead, GuardianOverview, StudentActivity } from "./contracts";
import { DEMO_SCENARIO_COOKIE, guardianScenario, guardianScenarios, studentScenario, studentScenarios, type GuardianScenario, type StudentScenario } from "./demo-scenarios";

// The ONLY data source of the Parent/Student presentation in this milestone: deterministic demo
// scenarios, and only in demo mode. Nothing here reads real students, wallets or purchases; a
// connected milestone replaces these two functions with server-derived, guardian/self-scoped reads.
async function chosen<T extends string>(options: Record<T, string>, fallback: T): Promise<T> {
  const value = (await cookies()).get(DEMO_SCENARIO_COOKIE)?.value;
  return value && value in options ? value as T : fallback;
}
export async function readGuardianOverview(): Promise<{ scenario: GuardianScenario; read: FamilyRead<GuardianOverview> }> {
  if (!isDemoMode()) return { scenario: "varios", read: { kind: "unavailable" } };
  const scenario = await chosen(guardianScenarios, "varios"), value = guardianScenario(scenario);
  return { scenario, read: value ? { kind: "ready", value } : { kind: "unavailable" } };
}
export async function readStudentActivity(): Promise<{ scenario: StudentScenario; read: FamilyRead<StudentActivity> }> {
  if (!isDemoMode()) return { scenario: "normal", read: { kind: "unavailable" } };
  const scenario = await chosen(studentScenarios, "normal"), value = studentScenario(scenario);
  return { scenario, read: value ? { kind: "ready", value } : { kind: "unavailable" } };
}
