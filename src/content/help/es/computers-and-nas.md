---
title: "Ordenadores y NAS"
summary: "El pequeño asistente que cataloga las fotos de tu NAS u ordenador sin moverlas, y cómo configurarlo."
section: Computers and NAS
order: 1
review: machine
source: 2bbdf56551b0
---

Muchos fotógrafos guardan sus fotos en un **NAS** (un disco de red en el estudio o en casa) o en los discos de un ordenador. cf-dam puede catalogarlas **donde están**: un pequeño programa asistente se ejecuta junto a las fotos, lee cada una y envía a cf-dam sus detalles, una miniatura y una vista previa. Los originales nunca se mueven ni se modifican.

Puedes tener varios asistentes, por ejemplo uno en el NAS y otro en un portátil.

## Qué hace el asistente

- Lee los detalles de cada foto (cámara, fecha, lugar, palabras clave, pies de foto) y crea una miniatura y una vista previa.
- Los envía a cf-dam, para que las fotos aparezcan en la biblioteca y puedas buscarlas, ponerles palabras clave y compartirlas.
- Vuelve a analizar cada cierto tiempo y detecta las fotos nuevas, cambiadas, renombradas y eliminadas. Una foto cuyo archivo desaparece queda marcada como **falta**, nunca se elimina del catálogo.
- Si quieres, copia los originales a un bucket de archivo (consulta [Archivar y restaurar los originales](/help/archiving)).
- En un primer análisis grande envía primero todas las miniaturas, para que la biblioteca se llene rápido, y después las vistas previas más grandes.

Solo **lee** tus carpetas de fotos. Las carpetas propias de Synology (`@eaDir`, `#recycle`), los archivos sobrantes de Mac y Windows y las cachés de Lightroom siempre se omiten.

## Añadir un asistente

En **Ordenadores y NAS**, pulsa **Añadir un ordenador o NAS** y elige dónde se ejecuta. La página muestra los pasos exactos para cada caso; aquí tienes el resumen.

### En un NAS

El asistente se ejecuta como un **contenedor Docker**, una forma habitual de ejecutar programas pequeños en un NAS. Elige tu NAS en **¿Qué NAS?** y cf-dam te muestra los pasos para ese modelo, con un archivo de configuración ya preparado (un «archivo compose») para copiar:

| NAS | Dónde va el archivo de configuración |
| --- | --- |
| Synology | Container Manager → Project → Create |
| QNAP | Container Station → Applications → Create |
| UGREEN | La app Docker: crea un proyecto |
| TerraMaster | Docker Manager: crea un proyecto |
| Asustor | Portainer (desde App Central) → Stacks → Add stack |
| TrueNAS (24.10 o posterior) | Apps → Discover Apps → ⋮ → Install via YAML |
| Unraid | Docker → Add Container (cf-dam muestra cada campo), o el plugin Compose Manager |
| OpenMediaVault | Services → Compose → Files → Add (con omv-extras) |
| Otro ordenador Linux | Guarda el archivo y ejecuta `docker compose up -d` |

**Pega el archivo de configuración tal cual: no hay nada que cambiar.** Permite al asistente *leer* el disco principal de tu NAS (`:ro` significa solo lectura: nunca puede cambiar ni eliminar nada ahí), y después eliges de una lista en cf-dam qué carpetas de fotos cataloga. El asistente necesita alrededor de 1 GB de memoria y funciona en modelos de NAS con Intel, AMD y ARM.

¿También tienes fotos en un segundo disco? El archivo de configuración tiene un comentario con la línea que hay que añadir.

Los NAS **WD My Cloud y Buffalo** no pueden ejecutar Docker. En ese caso, ejecuta el asistente en un Mac o PC que vea las carpetas compartidas del NAS.

### En un Mac o PC con Windows

1. Instala **Node.js 24** (el instalador LTS) desde [nodejs.org](https://nodejs.org), si aún no lo tienes.
2. Descomprime el asistente y abre un terminal (Mac: **Terminal**; Windows: **PowerShell**) en su carpeta.
3. Ejecuta el comando que muestra la página. Ya incluye la dirección de tu archivo.
4. En un Mac, cuando macOS pregunte si `node` puede leer tu carpeta Imágenes, tus discos o tus volúmenes de red, **permítelo**.

El asistente se inicia solo cada vez que inicias sesión en el ordenador, con tu usuario, así que ve tus discos y tus carpetas compartidas.

## Emparejar

Cada asistente nuevo muestra un **código de ocho letras**: en su propia página (`http://your-nas:8790` o `http://localhost:8790`) y en su registro.

1. Escribe el código en **Introduce el código** en la página Ordenadores y NAS.
2. Ponle un nombre al asistente, como «NAS del estudio», y pulsa **Conectar**.

El asistente recibe una clave que solo puede enviar fotos a este archivo: no puede leer nada más ni cambiar las fotos de nadie. Si vuelves a configurar un asistente (por ejemplo, después de reinstalar el NAS), elige **Otra vez como «…»** para que recupere su entrada, sus carpetas y sus fotos en lugar de enviarlo todo dos veces.

## Elegir carpetas

Debajo del asistente, en **Carpetas**, elige una carpeta de la lista (muestra las carpetas compartidas de tu NAS y las carpetas que contienen, con el nombre que les da el NAS, como `/volume1/photo/2024`) y pulsa **Indexar esta carpeta**. El primer análisis empieza al momento. Cada carpeta muestra cuándo se analizó por última vez. Las carpetas de discos extraíbles lo indican, y aparecen sin conexión mientras el disco está desconectado.

**Quitar** deja de indexar una carpeta. Sus fotos se quedan en cf-dam, marcadas como que faltan.

## Vigilarlo

La tarjeta de cada asistente muestra si está **En línea**, **Analizando** o cuándo se vio por última vez (**Visto por última vez**); cuántas fotos tiene; cuántas faltan; y qué está haciendo ahora. **Analizar ahora** inicia un análisis, y **Pausar** lo detiene hasta que pulses **Reanudar**.

Si un asistente lleva un tiempo sin dar señales, aparece un aviso para los administradores (consulta [Avisos y actividad](/help/alerts-and-activity)). Las causas habituales son que el NAS o el ordenador esté apagado o en reposo, o un cambio en la red. Reiniciar el asistente (o su contenedor) arregla casi todos los casos.

**Desconectar** quita la clave de un asistente. Sus fotos se quedan en cf-dam.
