---
title: "Qué reciben los clientes"
summary: "Qué hay en los archivos que los clientes descargan o compran desde una galería, qué pueden leer en la página y qué comprobar antes de enviar un enlace."
section: Sharing
order: 6
review: machine
source: f6588c6151b7
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

Un original descargado es **el archivo exactamente como se subió**. Eso incluye:

- **Todo lo que tu programa de edición escribió en él:** por ejemplo, Lightroom puede escribir nombres de personas, palabras clave, pies de foto, valoraciones y tus datos de contacto.
- **La información de la cámara:** algunas cámaras y teléfonos añaden la ubicación GPS, el nombre del propietario de la cámara y sus propios nombres de reconocimiento facial.
- **Ninguna edición hecha en cf-dam.** Si aquí recortaste a alguien, sigue en el original.

Las descargas de pago en **Tamaño completo** también son originales, y solo se venden para fotos JPEG y PNG sin ediciones en cf-dam.

Antes de ofrecer originales, comprueba qué incluye tu exportación. En Lightroom, el ajuste **Metadatos** de la exportación puede incluir solo el copyright y los datos de contacto, y quitar la información de personas y ubicación.

Los originales siempre salen del propio cf-dam. Aunque estén guardados en Amazon S3, el cliente nunca recibe un enlace a tu bucket.

> **Próximamente:** cf-dam quitará los nombres de personas, las palabras clave, los pies de foto y la ubicación de los originales JPEG y PNG cuando los clientes los descarguen, y conservará los datos de la cámara y tu copyright. Cada galería tendrá un interruptor para enviar los originales exactamente como están guardados.

## Otros tipos de archivo

Las fotos RAW, TIFF, HEIC, WebP, AVIF y GIF y los vídeos siempre se envían como están guardados. Las fotos de teléfono (HEIC) y los vídeos suelen llevar la ubicación GPS.

## Ver también

- [Galerías de clientes](/help/client-galleries)
- [Vender fotos](/help/selling)
- [Personas en las fotos](/help/people-in-photos)
