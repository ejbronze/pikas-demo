import { requirePlatform } from '../../../lib/platform/customer-console';
import { IDENTITY_SUPPORT_CAPABILITY } from '../../../lib/identity/contracts';
import { AppPageHeader } from '../../../components/app-page-header';
import { IdentitySearch } from '../../../components/identity-credentials';
import { ErrorState } from '../../../components/state-panels';

// Phase 6A Platform identity support: credentials only. It never opens tenant data or grants roles.
export default async function IdentitiesPage() {
  const session = await requirePlatform();
  if (!session.capabilities.includes(IDENTITY_SUPPORT_CAPABILITY)) return <ErrorState title="No tienes permiso para dar soporte de identidad." />;
  return <section className="space-y-5">
    <AppPageHeader title="Identidades" description="Usuario, correo, contraseña temporal y suspensión de inicio de sesión. Cada cambio queda registrado con tu nombre." />
    <IdentitySearch />
  </section>;
}
