export type AdminRole = "school_admin" | "cafeteria_admin" | "pos_operator";
export type AdminPermission = "school:read"|"students:manage"|"school_admins:manage"|"partnerships:review"|"cafeteria:read"|"menu:manage"|"pos_users:manage"|"partnerships:request"|"pos:verify"|"pos:checkout";
export type PartnershipStatus = "pending"|"active"|"suspended"|"rejected"|"revoked";
export type PartnershipScope = "eligibility"|"balance"|"restrictions"|"limits"|"transactions";

const permissions: Record<AdminRole, readonly AdminPermission[]> = {
  school_admin:["school:read","students:manage","school_admins:manage","partnerships:review"],
  cafeteria_admin:["cafeteria:read","menu:manage","pos_users:manage","partnerships:request"],
  pos_operator:["pos:verify","pos:checkout"],
};
export const can=(role:AdminRole,permission:AdminPermission)=>permissions[role].includes(permission);
export const workspaceFor=(role:AdminRole)=>role==="school_admin"?"/admin/escuela":role==="cafeteria_admin"?"/admin/cafeteria":"/pos";
export const activePartnershipAllows=(status:PartnershipStatus,scope:readonly PartnershipScope[],operation:PartnershipScope)=>status==="active"&&scope.includes(operation);
