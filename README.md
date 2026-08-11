# PIKAS MVP

Monorepo para la primera fase de PIKAS: portales web funcionales para familias y estudiantes, respaldados por una fuente central de datos simulados.

## Demo alojada

Oscar puede revisar las aplicaciones directamente desde un navegador, sin instalar Node.js ni ejecutar el proyecto en modo desarrollador:

- [Abrir Pikas Familias](https://pikas-family-c49g7cuhh-ejbronzes-projects.vercel.app)
- [Abrir Pikas Student](https://pikas-student-7yk9ygxmv-ejbronzes-projects.vercel.app)

Estas son implementaciones de demostración alojadas en Vercel. Actualmente tienen activa la protección de despliegues de Vercel: si aparece una pantalla de acceso, Oscar debe iniciar sesión con una cuenta autorizada en el equipo `ejbronze's projects`. Alternativamente, el propietario del proyecto puede desactivar la protección del preview o publicar una implementación de producción pública desde el panel de Vercel.

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
