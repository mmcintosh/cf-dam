---
title: "Qué reciben los clientes"
summary: "Qué hay en los archivos que los clientes descargan o compran desde una galería, qué pueden leer en la página y qué comprobar antes de enviar un enlace."
section: Sharing
order: 6
review: machine
source: bc827434a0e0
---

Una galería muestra tus fotos, pero un archivo descargado puede llevar más que la imagen. Esta página enumera lo que reciben los clientes, para que no se vaya con él nada que quisieras mantener privado.

## En la página de la galería

- **Los títulos, pies de foto y textos alternativos** los ve cualquiera que abra el enlace. Un pie de foto como «Lily, 4 años, con la abuela» nombra a personas, así que revisa los pies de foto antes de compartir un álbum.
- **Los nombres de archivo** solo se muestran con **Mostrar los nombres de archivo** activado.
- **Las personas que has nombrado** en cf-dam nunca se muestran, ni tampoco las palabras clave, las valoraciones, los lugares del mapa o las notas.

## Nombres de archivo

Con **Mostrar los nombres de archivo** desactivado, nada de lo que recibe un cliente lleva el nombre real del archivo. Las descargas llevan el nombre de la galería y el lugar de la foto en ella, por ejemplo `boda-garcia-042.jpg`. Los pedidos y los recibos de Stripe la llaman **Foto 42**. Activado, los archivos conservan su nombre real.

## Descargas Pequeña y Grande

Las descargas Pequeña y Grande son JPEG que cf-dam crea a partir de la foto, con tus ediciones (recortes y giros) y la marca de agua si la galería tiene una.

## Originales

Un original descargado es el archivo tal como se subió, **limpiado** al salir cuando es un JPEG o un PNG:

- **Se quita:** los nombres de personas (también las regiones de cara de Lightroom), los pies de foto y descripciones, las palabras clave, las valoraciones, los comentarios, la ubicación GPS, el nombre del propietario de la cámara, las notas privadas del fabricante (algunas guardan nombres de reconocimiento facial) y las credenciales de contenido (C2PA).
- **Se conserva:** la imagen en sí, intacta; los ajustes de la cámara y la fecha; y tu **autoría** y **aviso de copyright**, de los campos de Derechos de la foto en cf-dam.
- **Las fotos HDR de teléfono**, que esconden una segunda imagen en el archivo, llegan como imagen estándar.
- **Ninguna edición hecha en cf-dam.** Si aquí recortaste a alguien, sigue en el original.

Si un archivo no se puede limpiar con seguridad, no se envía: se pide al cliente que te contacte y la **Actividad** indica qué galería.

**Enviar los originales exactamente como están guardados** (en los ajustes de la galería, en Descargas) envía los originales intactos, con todo lo que tu programa y tu cámara escribieron en ellos. Úsalo solo si has comprobado qué incluye tu exportación. En Lightroom, el ajuste **Metadatos** de la exportación puede incluir solo el copyright y los datos de contacto.

Las descargas de pago en **Tamaño completo** también son originales, limpiados igual, y solo se venden para fotos JPEG y PNG sin ediciones en cf-dam.

Los originales siempre salen del propio cf-dam. Aunque estén guardados en Amazon S3, el cliente nunca recibe un enlace a tu bucket.

## Otros tipos de archivo

Las fotos RAW, TIFF, HEIC, WebP, AVIF y GIF y los vídeos siempre se envían como están guardados, sin limpiar, sea cual sea el ajuste de la galería. Las fotos de teléfono (HEIC) y los vídeos suelen llevar la ubicación GPS.

## Ver también

- [Galerías de clientes](/help/client-galleries)
- [Vender fotos](/help/selling)
- [Personas en las fotos](/help/people-in-photos)
