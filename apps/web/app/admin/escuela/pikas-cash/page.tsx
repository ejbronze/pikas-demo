import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isDemoMode } from '../../../../lib/env';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveSchoolAccess } from '../../../../lib/auth/school-access';
import { readSchoolWalletAccess } from '../../../../lib/wallet/access';
import { readSchema, type SchoolStudent } from '../../../../lib/school/contracts';
import { walletReportSchema } from '../../../../lib/school/wallet-report';
import { joinWallets, studentRowsSchema, walletOverview, walletRowsSchema, type WalletStudent } from '../../../../lib/school/wallets';
import { ConnectedSchoolShell } from '../../../../components/connected-school-shell';
import { SchoolPikasCash } from '../../../../components/school-pikas-cash';
import { AppPageHeader } from '../../../../components/app-page-header';
import { ErrorState } from '../../../../components/state-panels';

// PIKAS UX 7 School PIKAS Cash: student wallet administration. Visible with the server-derived
// school:wallets:read (the sandbox admin POV keeps its financial exclusion). Every read is an
// existing School read, scoped to this school and reduced here to wallet state and balance.
export default async function Page({ searchParams }: { searchParams: Promise<{ school?: string; q?: string; after?: string; vista?: string }> }) {
  if (isDemoMode()) return <ErrorState kind="not_configured" title="PIKAS Cash no está disponible en esta demostración." description="La demostración no incluye monederos. En un colegio real, esta sección muestra los monederos de sus estudiantes." />;
  const client = await createSupabaseServerClient();
  const access = await resolveSchoolAccess(client);
  if (access.status !== 'authorized') redirect('/login?error=school_authority');
  const params = await searchParams;
  const schoolId = params.school ?? access.context.schools[0].school_id;
  if (!access.context.schools.some(s => s.school_id === schoolId)) redirect('/admin/escuela');
  const wallet = await readSchoolWalletAccess(client, schoolId);
  const shell = (children: React.ReactNode) => <ConnectedSchoolShell context={access.context} schoolId={schoolId} walletNav={Boolean(wallet?.read)}>{children}</ConnectedSchoolShell>;
  if (!wallet?.read) return shell(<><AppPageHeader title="PIKAS Cash" /><ErrorState kind="permission" title="Tu rol no tiene acceso a PIKAS Cash en esta escuela." description="Lo otorga el administrador de la cuenta del colegio; pídeselo si lo necesitas." /></>);

  const query = z.string().max(80).catch('').parse(params.q ?? ''), after = z.guid().nullable().catch(null).parse(params.after ?? null), view = params.vista === 'atencion' ? 'atencion' as const : 'todos' as const;
  const own = (r: { data: unknown; error: unknown }) => { const p = readSchema.safeParse(r.data); return !r.error && p.success && p.data.scope.school_id === schoolId && p.data.scope.actor_id === access.context.person_id ? p.data : null; };
  // Rows and attention come from school_wallet_rows under the same authority as the summary (require_school_admin), so
  // a real School Admin and the sandbox School Admin POV see the same consistent state.
  const walletRows = (args: { p_student_ids: string[] | null; p_attention: boolean }) => client.rpc('school_wallet_rows', { p_school_id: schoolId, ...args })
    .then(r => { const p = walletRowsSchema.safeParse(r.data); return !r.error && p.success ? p.data : null; }, () => null);
  const walletsFor = async (ids: string[]) => ids.length === 0 ? [] : await walletRows({ p_student_ids: ids, p_attention: false });

  const [report, roster, attentionWallets] = await Promise.all([
    client.rpc('school_wallet_report', { p_school_id: schoolId, p_period: 'last_7_days', p_from: null, p_to: null }).then(r => { const p = walletReportSchema.safeParse(r.data); return !r.error && p.success && p.data.school_id === schoolId ? p.data : null; }, () => null),
    view === 'todos' ? client.rpc('school_student_roster', { p_school_id: schoolId, p_query: query, p_status: '', p_after: after, p_limit: 50, p_location_id: null, p_grade: null }).then(own, () => null) : Promise.resolve(null),
    // Frozen or below-zero wallets (the two wallet states the product records), at most 50.
    walletRows({ p_student_ids: null, p_attention: true }),
  ]);
  let students: WalletStudent[] | null = null, nextCursor: string | null = null;
  if (view === 'todos' && roster) {
    const page = (roster.rows ?? []).filter((r): r is SchoolStudent => 'student_code' in r);
    const rows = await walletsFor(page.map(s => s.id));
    students = rows ? joinWallets(page.map(s => ({ id: s.id, display_name: s.display_name, student_code: s.student_code, status: s.status })), rows) : null;
    nextCursor = roster.next_cursor ?? null;
  }
  let attention: WalletStudent[] | null = null;
  if (attentionWallets) {
    const names = studentRowsSchema.safeParse(attentionWallets.map(w => ({ id: w.student_id, display_name: w.display_name, student_code: w.student_code, status: w.student_status })));
    attention = names.success ? joinWallets(names.data, attentionWallets).sort((a, b) => a.name.localeCompare(b.name, 'es')) : null;
  }
  return shell(<SchoolPikasCash schoolId={schoolId} schoolName={access.context.schools.find(s => s.school_id === schoolId)!.school_name}
    overview={report ? walletOverview(report) : null} students={view === 'todos' ? students : attention} view={view} attentionCount={attention?.length ?? null}
    query={query} paged={after !== null} nextCursor={nextCursor} />);
}
