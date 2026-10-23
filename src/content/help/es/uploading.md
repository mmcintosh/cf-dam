---
title: "Subir fotos"
summary: "Añadir fotos y vídeos desde tu ordenador, adónde van y qué les pasa después."
section: Your photos
order: 3
review: machine
source: 6589f6acdb5e
---

Subir fotos va bien para unos cientos de fotos cada vez, o para fotos de un ordenador que no las va a conservar. Para un NAS entero o una colección grande en un ordenador, es mejor un asistente: cataloga las fotos donde están, sin subir los originales (consulta [Ordenadores y NAS](/help/computers-and-nas)).

## Cómo subir

1. En la **Biblioteca**, pulsa **Subir**.
2. Elige adónde van los originales: **Guardar los originales en** (el predeterminado ya está elegido) y la **Clase de almacenamiento**. Consulta [Dónde se guardan los originales](/help/storage).
3. Arrastra fotos, archivos RAW y vídeos al cuadro, o haz clic en él para elegirlos. Puedes arrastrar una **carpeta entera**: cf-dam la abre, junto con las carpetas que contiene, y sube todo lo que hay dentro (los archivos ocultos se omiten).

Cada archivo muestra su progreso: **Buscando duplicados…**, luego un porcentaje y luego **Subido**. Los archivos grandes se suben por partes, hasta 5 TB cada uno, y puedes seguir trabajando mientras tanto. **Cancelar** detiene uno. Cuando terminen, pulsa **Actualizar la biblioteca** para verlos.

## Los duplicados se omiten

Antes de subir, cf-dam comprueba si ese mismo archivo ya está en el archivo, tanto si se subió antes como si lo catalogó un asistente. Si es así, el archivo indica **Ya está en el archivo**, con un enlace a la foto, y no se vuelve a subir. (Los archivos de más de 512 MB se saltan esta comprobación, porque supone leer el archivo entero.)

Las copias que no son idénticas, como una exportación más pequeña o un JPEG vuelto a guardar, sí se suben, y luego aparecen en [Duplicados](/help/duplicates) como fotos parecidas.

## Qué pasa después

A los pocos segundos de cada subida, cf-dam:

1. lee sus detalles: cámara, objetivo, exposición, fecha, GPS y cualquier palabra clave, título, pie de foto, crédito y copyright que ya tenga el archivo;
2. crea una miniatura y una vista previa;
3. busca la ciudad y el país a partir de su posición GPS;
4. hace que se pueda buscar;
5. la pone en cola para la [revisión con IA](/help/ai-review), si está activada para las fotos nuevas.

## Tipos de archivo

| Tipo | Notas |
| --- | --- |
| JPEG, PNG, WebP, AVIF, GIF, HEIC (iPhone) | cf-dam crea las vistas previas. |
| Archivos de más de unos 20 MB | Tu navegador crea la vista previa antes de subirlos, porque el servicio de imágenes de Cloudflare solo lee archivos de hasta 20 MB. |
| RAW (archivos de cámara), TIFF | Las vistas previas salen del pequeño JPEG que la mayoría de las cámaras meten dentro del archivo. Si no lo hay, la foto no tiene vista previa hasta que un asistente la crea. |
| Vídeo | Tu navegador crea un fotograma de portada, si puede reproducir el vídeo. |

## Directamente al archivo profundo

Si subes directamente a **Glacier** o **Deep Archive**, tu navegador crea primero la vista previa, porque después no se puede volver a leer el original durante horas. Recuperar el original más tarde requiere una restauración: consulta [Archivar y restaurar los originales](/help/archiving).
