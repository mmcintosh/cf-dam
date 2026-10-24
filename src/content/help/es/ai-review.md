---
title: "Revisión con IA"
summary: "Dejar que un modelo de IA describa tus fotos, cuánto cuesta y cómo sigues decidiendo tú lo que escribe."
section: Your photos
order: 5
review: machine
source: 48fdc91af68c
---

La revisión con IA mira cada foto y escribe sugerencias: **texto alternativo**, un **pie de foto**, una descripción más larga de **lo que vio**, cualquier **texto en la imagen** (carteles, documentos), **palabras clave** sugeridas y una nota sobre la calidad. Hace que un archivo grande se pueda buscar de una forma que nadie tiene tiempo de hacer a mano, y es lo que lee la [búsqueda por significado](/help/search).

Funciona con **Workers AI en tu propia cuenta de Cloudflare**. Tus fotos no se envían a ninguna otra empresa y el modelo no aprende de ellas.

## Tú decides

Nada de lo que escribe la IA sustituye tus propias palabras a menos que tú lo digas. En la [página de una foto](/help/photo-page), en **Sugerencias de la IA**:

- **Usar este** copia una sugerencia en un campo vacío; **Sustituir el mío** sobrescribe lo que haya.
- Las palabras clave sugeridas se pueden buscar enseguida, marcadas como de la IA. **✓** conserva una como tuya, **×** la descarta y **Conservar todas** las conserva todas.
- **Analizar** la vuelve a ejecutar (por ejemplo, después de cambiar el contexto que se explica más abajo).

Para aceptar sugerencias de muchas fotos a la vez, selecciónalas en la biblioteca y usa **IA…**: **Usar los pies de foto de la IA donde estén vacíos**, **Usar el texto alternativo de la IA donde esté vacío**, **Conservar las etiquetas de la IA** o **Volver a analizar**.

## La página Revisión con IA

**Revisión con IA**, en el menú, muestra cuántas fotos están **analizadas**, **en cola**, **nunca analizadas** y **con error**, y cuánto cuesta cada 1000 fotos en tu archivo.

### Ajustes (administradores)

- **Revisión con IA:** activada o desactivada. Desactivada detiene todo el análisis; las sugerencias ya hechas se conservan.
- **Analizar las nuevas subidas:** cada foto nueva se pone en cola en cuanto tiene vista previa. Las fotos de un asistente se ponen en cola después del primer análisis de una carpeta.
- **Modelo:** el modelo de IA que se usa. La página explica para qué es bueno cada uno.
- **Sobre tu trabajo:** una frase sobre ti que se da al modelo con cada foto para que sus palabras clave encajen con tu archivo, por ejemplo *«Fotógrafo de bodas y paisajes en el oeste de Noruega»* o *«Fotografía de aves, sobre todo en los humedales de Florida»*.

### Analizarlo todo de una vez

Si hay fotos que nunca se han analizado, **Analizar el archivo existente** dice cuántas son y cuánto costará, más o menos. Pulsa **Poner … en cola** para empezar. Las fotos se procesan en segundo plano, varias a la vez; puedes seguir trabajando. Una foto que falla se reintenta un par de veces y después se marca **con error**, con el motivo.

## Personas en las fotos

Junto a la revisión con IA, **Jev**, de TypeSafe, busca personas en cada foto nueva, y cuántas hay, para el filtro **Personas** de la biblioteca. Es más rápido y más barato que la revisión con IA (unos 9 céntimos por 1000 fotos), y en una prueba con 805 fotos encontró personas en 87 donde la revisión con IA encontró 47, casi siempre figuras pequeñas al fondo. No escribe texto.

- **Qué se envía:** una copia de 1024 px de cada foto, sin nombre de archivo, datos de cámara ni ubicación, va a TypeSafe (api.typesafe.ai). TypeSafe dice que no entrena con ella.
- **Fotos anteriores:** el panel **Personas en las fotos** de esta página cuenta lo encontrado (cada número abre esas fotos en la biblioteca) y **Mirar N fotos aún sin mirar** se encarga del resto.
- **Interruptores:** con **Buscar personas** desactivado no se envía nada más a TypeSafe (las respuestas ya obtenidas se quedan y el filtro sigue funcionando); con **En las fotos nuevas al llegar** desactivado, las fotos nuevas esperan al botón.
- **Respuestas equivocadas:** corrige una en la página de la foto, o muchas a la vez en la biblioteca (selecciónalas y elige **Personas…**). Jev nunca cambia una respuesta puesta a mano, y **Volver a la respuesta de Jev** la deshace.
- **Las fotos que no se pudieron mirar** aparecen en una lista con el motivo: demasiado pequeñas, rechazadas por TypeSafe o fallidas tres veces (con **Volver a intentar**).
- No se revisan los vídeos ni las fotos de menos de 280 píxeles por lado.

## Cuánto cuesta

Workers AI se factura en **neuronas**. Cloudflare regala 10 000 neuronas al día y después cobra 0,011 $ por cada 1000.

Un ejemplo real: revisar 662 fotos de aves usó unas 30 000 neuronas, unos **33 céntimos**, o unos 22 céntimos descontando la cuota gratuita diaria. Eso son unos 50 céntimos por cada 1000 fotos. La página Revisión con IA muestra la cifra de tu propio archivo.

## ¿Qué tal funciona?

Es buena con lo que hay en una imagen (*una garza real de pie en aguas poco profundas entre juncos*) y leyendo texto. No sabe quiénes son las personas, ni el nombre de los lugares que no puede leer, ni la historia detrás de una foto. Eso te toca añadirlo a ti. Toma sus palabras clave como un primer paso y su texto alternativo como un borrador.
