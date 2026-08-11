# PIKAS MVP

Monorepo para la primera fase de PIKAS: portales web funcionales para familias y estudiantes, respaldados por una fuente central de datos simulados.

## Demo alojada

Oscar puede revisar las aplicaciones directamente desde un navegador, sin instalar Node.js ni ejecutar el proyecto en modo desarrollador:

- [Abrir Pikas Familias](https://pikas-family.vercel.app)
- [Abrir Pikas Student](https://pikas-student.vercel.app)

Estas implementaciones de demostración están alojadas públicamente en Vercel. Se pueden abrir directamente en un navegador moderno y no requieren una cuenta de Vercel, acceso al repositorio ni configuración local.

Los datos, saldos, recargas, preórdenes y códigos QR son ficticios. No se procesa dinero real ni se debe introducir información financiera.

## Inicio rápido

Requiere Node.js 20 o posterior.

```bash
npm install
npm run dev:family   # http://localhost:3000
npm run dev:student  # http://localhost:3001
```

Validación: `npm run typecheck`, `npm run lint`, `npm test` y `npm run build`.

## Estructura

- `apps/family-web`: portal familiar Next.js.
- `apps/student-web`: portal estudiantil Next.js.
- `packages/shared-types`: contratos de dominio compartidos.
- `packages/data-access`: interfaz asíncrona y adaptador mock.
- `packages/ui`: componentes visuales compartidos.
- `legacy-prototypes`: prototipos HTML originales, conservados sin cambios.
- `docs`: alcance y decisiones de arquitectura.

Todas las operaciones financieras visibles son demostraciones; no se recopilan datos de tarjeta ni se mueve dinero real.
