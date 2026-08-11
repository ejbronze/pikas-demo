# Guía de marca PIKAS

## Propósito

PIKAS es una **billetera escolar amigable**: clara para familias, cercana para estudiantes y eficiente para cafetería. La marca conecta las experiencias sin borrar sus señales de rol.

## Activos aprobados

Todos viven en `apps/web/public/brand/`.

| Archivo | Uso |
| --- | --- |
| `pikas-logo-horizontal-full-color.png` | Landing, login y espacios anchos sobre fondo claro. |
| `pikas-logo-mark-full-color.png` | Cabeceras compactas, barra móvil e iconos. |
| `pikas-logo-stacked-navy.png` | Composiciones verticales pequeñas sobre fondo claro. |
| `favicon-32x32.png`, `apple-touch-icon.png`, `icon-192x192.png`, `icon-512x512.png` | Iconos de aplicación, generados desde el mark. |

Mínimos: horizontal 120 px de ancho, mark 28 px y stacked 56 px de alto. Deja un espacio libre de al menos la altura del ojo del mark. No estirar, recortar, recolorear, rotar, sombrear el logo ni colocarlo sobre fondos recargados.

Los PNG originales tienen transparencia: horizontal 882×334, mark 322×316 y stacked 184×239. No hay SVG ni fuente adecuada para impresión grande; no amplíes el stacked más allá de una aplicación digital moderada.

## Colores y tokens

| Token | Valor | Uso |
| --- | --- | --- |
| `--primary` | `#03234B` | Navegación, botones y estructura. |
| `--accent` | `#04C7C5` | Acentos de marca; no texto pequeño sobre blanco. |
| `--accent-hover` | `#04A5A8` | Foco y hover. |
| `--surface-muted` | `#FAF3E0` | Superficies cálidas discretas. |
| `--foreground` | `#14213D` | Texto principal. |
| `--background` | `#F6F8FC` | Canvas. |
| `--border` | `#DBE3EE` | Bordes. |

Familia conserva azul con teal de apoyo; Estudiante conserva violeta con amarillo reservado para hitos; POS usa teal y navy; Administración usa navy con teal discreto.

## Componentes y accesibilidad

Botones primarios usan navy y texto blanco; controles secundarios son blancos con borde. Tarjetas usan radio medio, borde y sombra leve. Alertas siempre incluyen texto; las restricciones no dependen solo de color. El foco usa teal oscuro visible y los enlaces mantienen contraste.

La tipografía actual es la pila del sistema `Inter, ui-sans-serif, system-ui, sans-serif`. Respeta `prefers-reduced-motion`, textos en español y objetivos táctiles de 44 px.
