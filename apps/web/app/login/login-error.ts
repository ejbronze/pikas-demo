export type LoginErrorMessage = {
  title: string;
  body: string;
};

const messages: Record<string, LoginErrorMessage> = {
  school_authority: {title:"No pudimos abrir la administración escolar",body:"Tu sesión terminó o tu acceso cambió. Inicia sesión de nuevo; si el problema continúa, comunícate con el administrador de tu institución."},
  cafeteria_authority: {title:"No tienes acceso de administración a una cafetería",body:"Tu cuenta necesita un acceso explícito a la cafetería. Vuelve a Administración escolar para solicitarlo al administrador de la cuenta."},
  membership: {
    title: "No tienes acceso a una cuenta de PIKAS",
    body: "Tu usuario no está asociado actualmente a ninguna escuela o cafetería. Si crees que esto es un error, comunícate con el administrador de tu institución.",
  },
  credentials: {
    title: "No se pudo iniciar sesión",
    body: "Verifica tu correo o usuario y tu contraseña e inténtalo de nuevo.",
  },
  session: {
    title: "No se pudo iniciar sesión",
    body: "El servicio no respondió. Inténtalo de nuevo en unos minutos.",
  },
  identity: {
    title: "No se pudo verificar tu cuenta",
    body: "Comunícate con el administrador de tu institución para revisar el acceso.",
  },
  organization_suspended: {
    title: "Acceso de la organización suspendido",
    body: "El acceso de esta organización está temporalmente suspendido. Comunícate con el administrador de tu organización o con PIKAS para más información.",
  },
  organization_closed: {
    title: "Organización cerrada",
    body: "Esta cuenta de organización está cerrada y ya no tiene acceso operativo a PIKAS.",
  },
  temporary_expired: {
    title: "Tu contraseña temporal venció",
    body: "Las contraseñas temporales caducan a los 15 minutos si no se usan. Pide una nueva al administrador de tu cafetería e inicia sesión con ella.",
  },
  pos_authority: {
    title: "No tienes acceso al POS",
    body: "Tu usuario no tiene un acceso POS activo en ninguna cafetería. El administrador de la cafetería debe darte acceso y asignarte una caja.",
  },
  pos_unavailable: {
    title: "No pudimos verificar tu acceso al POS",
    body: "El servicio no respondió. Inténtalo de nuevo en unos minutos.",
  },
  pilot_email_required: {
    title: "Revisa tu correo electrónico",
    body: "Ingresa el correo electrónico asociado a tu cuenta de PIKAS.",
  },
};

export function getLoginErrorMessage(
  error: string | null,
): LoginErrorMessage | null {
  return error ? messages[error] ?? null : null;
}
