import {describe,expect,it} from "vitest";
import {activePartnershipAllows,can,workspaceFor} from "./admin-policy";
describe("administration policy",()=>{
  it("keeps organization permissions separated",()=>{expect(can("school_admin","students:manage")).toBe(true);expect(can("cafeteria_admin","students:manage")).toBe(false);expect(can("cafeteria_admin","menu:manage")).toBe(true);expect(can("pos_operator","pos_users:manage")).toBe(false)});
  it("routes roles to their own workspace",()=>{expect(workspaceFor("school_admin")).toBe("/admin/escuela");expect(workspaceFor("cafeteria_admin")).toBe("/admin/cafeteria");expect(workspaceFor("pos_operator")).toBe("/pos")});
  it("requires an active scoped partnership",()=>{expect(activePartnershipAllows("active",["eligibility"],"eligibility")).toBe(true);expect(activePartnershipAllows("pending",["eligibility"],"eligibility")).toBe(false);expect(activePartnershipAllows("suspended",["transactions"],"transactions")).toBe(false);expect(activePartnershipAllows("active",["eligibility"],"transactions")).toBe(false)});
});
