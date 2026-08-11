# PIKAS MVP

Monorepo para la primera fase de PIKAS: portales web funcionales para familias y estudiantes, respaldados por una fuente central de datos simulados.

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
