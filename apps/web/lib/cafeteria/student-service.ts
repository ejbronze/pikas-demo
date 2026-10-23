import type { CafeteriaRead } from './contracts';

// UX 13 / 13B: student service is School-owned. The copy for one cafetería's live status, shared by
// the Cafetería Admin (Hoy) and the Platform workspace (setup map). UI-free; never a Cafetería CTA.
export type StudentServiceStatus = NonNullable<CafeteriaRead['student_service']>;
export function studentServiceCopy(status: StudentServiceStatus, school: string, cafeteria: string): { label: string; tone: 'ready' | 'school' | 'off'; detail: string } {
  const n = status.enabled_students;
  switch (status.state) {
    case 'ready': return { label: n === 1 ? '1 estudiante habilitado' : `${n} estudiantes habilitados`, tone: 'ready', detail: `${school} ya comparte esta cafetería y habilitó estudiantes: el POS puede encontrarlos.` };
    case 'no_students_enabled': return { label: '0 estudiantes habilitados', tone: 'school', detail: `${school} debe habilitar estudiantes para ${cafeteria}; hasta entonces el POS no encontrará ninguno.` };
    case 'no_students': return { label: 'Requiere acción del colegio', tone: 'school', detail: `${school} todavía no ha agregado estudiantes.` };
    case 'identification_not_shared': return { label: 'Requiere acción del colegio', tone: 'school', detail: `${school} comparte esta cafetería sin «Identificación básica»: el POS no puede buscar estudiantes por nombre hasta que la incluya.` };
    case 'sharing_revoked': return { label: 'Compartición revocada', tone: 'off', detail: `${school} debe volver a compartir ${cafeteria} para que los estudiantes aparezcan en el POS.` };
    default: return { label: 'Requiere acción del colegio', tone: 'school', detail: `${school} todavía no ha compartido estudiantes con ${cafeteria}.` };
  }
}
