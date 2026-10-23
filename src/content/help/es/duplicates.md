---
title: "Duplicados"
summary: "Encontrar archivos idénticos y copias parecidas, y quedarte con la mejor."
section: Your photos
order: 6
review: machine
source: 7fde0a7267ff
---

Los archivos acumulan copias: la misma foto subida dos veces, una exportación junto a su original, un JPEG guardado otra vez, la misma carpeta en dos discos. **Duplicados** las encuentra y te sugiere cuál conservar.

## Dos tipos

- Los **archivos idénticos** son el mismo archivo byte a byte, vengan de donde vengan: por ejemplo, una subida y la copia de un asistente en el NAS.
- Las **fotos parecidas** son archivos distintos de la misma imagen: redimensionados, guardados otra vez, exportados con otra calidad, ligeramente editados. cf-dam las encuentra mediante una «huella» de las zonas claras y oscuras de cada imagen, así que detecta copias que una comparación de archivos no ve. Dos fotos tomadas con un instante de diferencia también pueden parecerse, por eso las fotos parecidas tienes que revisarlas tú.

Las fotos de escenas sencillas (un cielo vacío, niebla, un fotograma negro) tienen muy poca información en su huella, así que solo se emparejan cuando sus huellas y sus tamaños en píxeles son **exactamente** iguales.

Los archivos idénticos ni siquiera se pueden subir dos veces: la subida dice **Ya está en el archivo** (consulta [Subir fotos](/help/uploading)).

## Cuál conservar

Cada grupo muestra todas las copias con su tamaño en píxeles, el tamaño del archivo, el tipo de archivo, la fecha y la cámara, y marca una como **Sugerida**, con el motivo. cf-dam prefiere, en este orden:

1. **Más píxeles**: la imagen más grande.
2. **El original RAW**, y después un archivo sin pérdida (TIFF, PNG), antes que un JPEG.
3. Con el mismo tamaño, el archivo **menos comprimido**: «El mismo tamaño, pero menos comprimida (707 KB frente a 664 KB)».
4. **Tu elección**, y después la **mejor valorada**.
5. Si no, la que llegó primero.

El motivo se muestra para que puedas no estar de acuerdo: elige otra copia antes de pulsar el botón.

## Conservar una

Elige la copia que quieres conservar y pulsa **Conservar la elegida y quitar …**. Las palabras clave, álbumes, valoración y marca de elegida de las demás pasan a la que conservas, y las demás se quitan del catálogo.

> **Quitar un duplicado nunca elimina un archivo.** Solo saca esa copia del catálogo de cf-dam. Los archivos originales se quedan donde están, en tu NAS, tu ordenador o el almacenamiento, para que los ordenes si quieres.

## No son duplicados

Para fotos parecidas que en realidad no son copias (dos fotogramas de una ráfaga, por ejemplo):

- **No son duplicados** descarta el grupo entero;
- **No es un duplicado** debajo de una foto saca solo esa del grupo.

Las parejas descartadas no se vuelven a sugerir.
