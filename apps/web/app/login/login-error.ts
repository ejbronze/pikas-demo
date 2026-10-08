export type LoginErrorMessage = {
  title: string;
  body: string;
};

const messages: Record<string, LoginErrorMessage> = {
  membership: {
    title: "No tienes acceso a una cuenta de PIKAS",
    body: "Tu usuario no está asociado actualmente a ninguna escuela o cafetería. Si crees que esto es un error, comunícate con el administrador de tu institución.",
  },
  credentials: {
    title: "No se pudo iniciar sesión",
    body: "Verifica tu correo electrónico y contraseña e inténtalo de nuevo.",
  },
  identity: {
    title: "No se pudo verificar tu cuenta",
    body: "Comunícate con el administrador de tu institución para revisar el acceso.",
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
