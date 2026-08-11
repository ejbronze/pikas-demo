import { describe, expect, it } from "vitest";
import { getFamilyStudents, getStudentTransactions, getStudentWallet } from ".";
describe("mock data adapter", () => {
  it("returns linked family students", async () => expect(await getFamilyStudents("fam-rosa")).toHaveLength(2));
  it("returns a wallet by student", async () => expect((await getStudentWallet("student-sofia"))?.availableBalance).toBe(2450));
  it("returns newest transactions first", async () => { const items = await getStudentTransactions("student-valentina"); expect(items[0]?.id).toBe("tx-4") });
});
