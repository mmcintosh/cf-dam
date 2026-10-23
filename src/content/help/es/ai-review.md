---
title: "Revisión con IA"
summary: "Dejar que un modelo de IA describa tus fotos, cuánto cuesta y cómo sigues decidiendo tú lo que escribe."
section: Your photos
order: 5
review: machine
source: f491e36f33e9
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

## Cuánto cuesta

Workers AI se factura en **neuronas**. Cloudflare regala 10 000 neuronas al día y después cobra 0,011 $ por cada 1000.

Un ejemplo real: revisar 662 fotos de aves usó unas 30 000 neuronas, unos **33 céntimos**, o unos 22 céntimos descontando la cuota gratuita diaria. Eso son unos 50 céntimos por cada 1000 fotos. La página Revisión con IA muestra la cifra de tu propio archivo.

## ¿Qué tal funciona?

Es buena con lo que hay en una imagen (*una garza real de pie en aguas poco profundas entre juncos*) y leyendo texto. No sabe quiénes son las personas, ni el nombre de los lugares que no puede leer, ni la historia detrás de una foto. Eso te toca añadirlo a ti. Toma sus palabras clave como un primer paso y su texto alternativo como un borrador.
