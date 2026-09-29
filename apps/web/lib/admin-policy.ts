import { roleAllows } from "@pikas/data-access";
export type { DemoRole as AdminRole, Permission as AdminPermission } from "@pikas/data-access";
import type { DemoRole as AdminRole } from "@pikas/data-access";
export type PartnershipStatus = "pending"|"active"|"suspended"|"rejected"|"revoked";
export type PartnershipScope = "eligibility"|"balance"|"restrictions"|"limits"|"transactions";

export const can = roleAllows;
export const workspaceFor=(role:AdminRole)=>role==="school_admin"?"/admin/escuela":role==="cafeteria_admin"?"/admin/cafeteria":"/pos";
export const activePartnershipAllows=(status:PartnershipStatus,scope:readonly PartnershipScope[],operation:PartnershipScope)=>status==="active"&&scope.includes(operation);
