import type {PosStudentRecord} from './pos';

export type CustomerScope = 'eligibility'|'balance'|'limits'|'restrictions'|'transactions';
export type PosCustomer = Pick<PosStudentRecord,'id'|'preferredName'|'grade'|'code'|'status'> & {
  scopes: CustomerScope[];
  balanceMinor?: number;
  walletStatus?: PosStudentRecord['walletStatus'];
  dailyLimitMinor?: number;
  dailyLimitEnabled?: boolean;
  perTransactionLimitMinor?: number;
  spentTodayMinor?: number;
  allergies?: string[];
  blockedProducts?: string[];
  blockedProductIds?: string[];
};

// Only the adapter may construct this projection from its internal demo graph.
export function projectPosCustomer(student:PosStudentRecord, scopes:CustomerScope[]):PosCustomer|null {
  if (!scopes.includes('eligibility') || student.status !== 'active') return null;
  return {
    id:student.id, preferredName:student.preferredName, grade:student.grade, code:student.code, status:student.status, scopes,
    ...(scopes.includes('balance') ? {balanceMinor:student.balanceMinor,walletStatus:student.walletStatus} : {}),
    ...(scopes.includes('limits') ? {dailyLimitMinor:student.dailyLimitMinor,dailyLimitEnabled:student.dailyLimitEnabled,perTransactionLimitMinor:student.perTransactionLimitMinor,spentTodayMinor:student.spentTodayMinor} : {}),
    ...(scopes.includes('restrictions') ? {allergies:student.allergies,blockedProducts:student.blockedProducts,blockedProductIds:student.blockedProductIds} : {}),
  };
}
export function checkoutCustomer(customer:PosCustomer, method:'cash'|'student_wallet'):PosStudentRecord|null {
  const required:CustomerScope[]=['eligibility','limits','restrictions','transactions',...(method==='student_wallet'?['balance' as const]:[])];
  if (!required.every(scope=>customer.scopes.includes(scope))) return null;
  return {id:customer.id,preferredName:customer.preferredName,grade:customer.grade,code:customer.code,status:customer.status,school:'',walletStatus:customer.walletStatus??'active',balanceMinor:customer.balanceMinor??0,dailyLimitMinor:customer.dailyLimitMinor!,dailyLimitEnabled:customer.dailyLimitEnabled,perTransactionLimitMinor:customer.perTransactionLimitMinor!,spentTodayMinor:customer.spentTodayMinor!,allergies:customer.allergies!,blockedProducts:customer.blockedProducts!,blockedProductIds:customer.blockedProductIds!};
}
