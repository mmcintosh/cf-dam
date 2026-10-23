---
title: "Copias de seguridad y restaurar el catálogo"
summary: "Copias diarias del catálogo, cómo recuperarlo en una instalación nueva y la comprobación de vistas previas."
section: Where photos are kept
order: 4
review: machine
source: 85a0a0571ca4
---

Los **originales** de tus fotos están protegidos por el sitio donde los guardas (consulta [Archivar y restaurar los originales](/help/archiving)). El **catálogo** (los detalles de cada foto, palabras clave, pies de foto, valoraciones, álbumes, galerías y personas) está protegido por las **copias de seguridad del catálogo**.

## Activar las copias de seguridad

En **Almacenamiento**, en **Copias de seguridad del catálogo**:

1. **Copiar en:** elige un bucket. Vale cualquier bucket conectado; el integrado ya está ahí.
2. **Cada día a las:** la hora (en UTC; cf-dam muestra tu hora local al lado).
3. **Conservar:** cuántos días de copias guardar. Las más antiguas se eliminan, pero nunca la más reciente.
4. Pulsa **Guardar**. La primera copia empieza en menos de un minuto; **Hacer copia ahora** hace una en cualquier momento.

> **Si puedes, usa un bucket fuera de Cloudflare.** El bucket integrado está en la misma cuenta de Cloudflare que el catálogo, así que te protege de errores, pero no de perder la cuenta. Un bucket en Amazon S3 (o Backblaze B2, Wasabi…) te protege de las dos cosas.

### Qué hay en una copia y qué no

| Incluye | No incluye |
| --- | --- |
| Los detalles de cada foto, palabras clave, pies de foto, valoraciones, etiquetas de color | Los archivos originales (están donde los guardes) |
| Álbumes, galerías de cliente, sus visitantes y sus elecciones | Contraseñas, llaves de acceso, códigos de la verificación en dos pasos, sesiones iniciadas |
| Personas y sus funciones | Claves de API |
| Palabras clave, ajustes preestablecidos, ajustes, conexiones de los asistentes | Miniaturas y vistas previas (se vuelven a crear) |

Como las contraseñas no están en la copia, después de una restauración todo el mundo recibe una contraseña nueva.

## Recuperar el catálogo

Una restauración se hace en un cf-dam **nuevo y vacío** (por ejemplo, después de empezar de cero en otra cuenta de Cloudflare):

1. Instala cf-dam como siempre. En la primera página, elige **Restaurar desde una copia de seguridad** en lugar de **Empezar un archivo nuevo**.
2. Indica **dónde están las copias de seguridad**: el almacenamiento integrado de esta instalación si aún las tiene, o un bucket S3. Bastan claves de solo lectura; se guardan solo hasta que termine la restauración.
3. **Elige una copia** de la lista y crea el primer administrador.

La restauración se hace en segundo plano y puedes seguirla en la página. Si se detiene (por un problema de red, por ejemplo), **inténtalo de nuevo**: continúa donde se quedó.

Después de una restauración:

- Los **asistentes** de tu NAS y tus ordenadores se vuelven a emparejar y recuperan sus propias entradas, así que no envían todo dos veces. Consulta [Ordenadores y NAS](/help/computers-and-nas).
- Las **miniaturas y vistas previas** se vuelven a crear: a partir de los originales donde cf-dam puede leerlos, y mediante los asistentes para los originales que están en un NAS.

## La comprobación de vistas previas

En **Almacenamiento**, en **Vistas previas**, **Comprobar cada vista previa** pregunta al almacenamiento integrado por cada miniatura y vista previa, y vuelve a crear las que falten. Con un millón de fotos tarda unas horas y cuesta mucho menos de un dólar. **Reintentar las atascadas** vuelve a intentar las que no se pudieron crear.

Normalmente no lo necesitarás: cf-dam detecta que falta una vista previa la primera vez que alguien la abre. Está ahí para después de una restauración, o para quedarte tranquilo.
