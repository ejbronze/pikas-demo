import { describe, expect, it } from "vitest";
import { studentAttention, studentService, uuidPredecessor, walletReadSchema, walletState } from "./student-workspace";
import type { SchoolStudent } from "./contracts";

const student = (patch: Partial<SchoolStudent> = {}): SchoolStudent => ({ id: "4d600000-0000-4000-8000-000000000101", first_name: "Ana", last_name: "Ficticia", display_name: "Ana Ficticia", student_code: "EST-1",
  status: "active", enrollment: { id: "4d600000-0000-4000-8000-000000000201", starts_on: "2026-08-20", location_id: "4d600000-0000-4000-8000-0000000000a1", grade: "4to", class: "A", homeroom: null }, ...patch });

describe("single-student lookup through the roster's keyset", () => {
  it("returns the id just below, borrowing across bytes and groups", () => {
    expect(uuidPredecessor("4d600000-0000-4000-8000-000000000101")).toBe("4d600000-0000-4000-8000-000000000100");
    expect(uuidPredecessor("4d600000-0000-4000-8000-000000000100")).toBe("4d600000-0000-4000-8000-0000000000ff");
    expect(uuidPredecessor("4d600000-0000-4000-8001-000000000000")).toBe("4d600000-0000-4000-8000-ffffffffffff");
    expect(uuidPredecessor("00000000-0000-0000-0000-000000000000")).toBeNull(); expect(uuidPredecessor("not-a-uuid")).toBeNull();
  });
  it("orders exactly like Postgres uuid comparison (byte order), so the next row is the student", () => {
    const ids = ["0f000000-0000-4000-8000-000000000001", "f0000000-0000-4000-8000-000000000000", "4d600000-0000-4000-8000-000000000101"];
    for (const id of ids) { const p = uuidPredecessor(id)!; expect(p < id).toBe(true); expect(ids.filter(x => x > p).sort()[0]).toBe(id); }
  });
});

describe("server-side reductions", () => {
  it("PIKAS Cash keeps state and balance only; purchase lines, cafeterías and receipts are dropped", () => {
    const read = walletReadSchema.parse({ school_id: "4d600000-0000-4000-8000-000000000001", student_id: student().id, student_name: "Ana Ficticia", next_before: null,
      wallet: { id: "4d600000-0000-4000-8000-000000000301", status: "frozen", currency: "DOP", balance_minor: "-2500", version: "7" },
      movements: [{ type: "purchase", amount_minor: "-6500", cafeteria: "Cafetería Ficticia", receipt_number: "42", items: [{ name: "Empanada", quantity: 1, line_total_minor: "6500" }] }] });
    const w = walletState(read);
    expect(w).toEqual({ status: "frozen", balance_minor: "-2500" }); expect(JSON.stringify(w)).not.toMatch(/Empanada|Cafetería|receipt|6500|movements/);
    expect(walletState(walletReadSchema.parse({ school_id: "4d600000-0000-4000-8000-000000000001", student_id: student().id, wallet: null }))).toBeNull();
  });
  it("service: only cafeterías where the student is enabled, with whether the school shares with them", () => {
    const cafes = [{ id: "c1", name: "Cafetería Santiago", location: "Sede Santiago", status: "active", sharing_status: "active" as const },
      { id: "c2", name: "Cafetería Tamboril", location: "Sede Tamboril", status: "active", sharing_status: "revoked" as const }, { id: "c3", name: "Otra", location: "X", status: "active", sharing_status: "active" as const }];
    expect(studentService(["c1", "c2"], cafes)).toEqual([{ name: "Cafetería Santiago", location: "Sede Santiago", serving: true }, { name: "Cafetería Tamboril", location: "Sede Tamboril", serving: false }]);
    expect(studentService([], cafes)).toEqual([]);
  });
});

describe("student attention", () => {
  it("none for an active, placed student with a healthy wallet and serving cafetería", () => {
    expect(studentAttention({ student: student(), wallet: { status: "active", balance_minor: "15000" }, service: [{ name: "C", location: "S", serving: true }], restrictions: [] })).toEqual([]);
  });
  it("explainable school-side conditions only", () => {
    const keys = (s: Partial<SchoolStudent>, wallet: Parameters<typeof studentAttention>[0]["wallet"] = undefined, service: Parameters<typeof studentAttention>[0]["service"] = null) =>
      studentAttention({ student: student(s), wallet, service, restrictions: null }).map(a => a.key);
    expect(keys({ status: "suspended" })).toEqual(["suspended"]); expect(keys({ status: "inactive" })).toEqual(["inactive"]);
    expect(keys({ enrollment: null })).toEqual(["enrollment"]);
    expect(studentAttention({ student: student({ enrollment: { ...student().enrollment!, grade: null, location_id: null } }), wallet: undefined, service: null, restrictions: null })[0].text).toBe("La matrícula no tiene campus ni grado asignado.");
    expect(keys({}, { status: "frozen", balance_minor: "-100" })).toEqual(["frozen", "negative"]);
    expect(keys({}, undefined, [{ name: "C", location: "S", serving: false }])).toEqual(["service"]);
    expect(keys({}, null, [])).toEqual([]); // no wallet and no cafetería are states, not alerts
  });
});
