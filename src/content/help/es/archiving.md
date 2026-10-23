---
title: "Archivar y restaurar los originales"
summary: "Cómo guardar una copia segura y barata de cada original en Amazon Glacier, y recuperar una foto cuando la necesites."
section: Where photos are kept
order: 3
review: machine
source: f92f0190ae52
---

Un **archivo** es una copia de tus originales en un sitio seguro y barato, para el día en que falle un disco o te roben el NAS. **Glacier Deep Archive** de Amazon guarda un terabyte por más o menos un dólar al mes. La pega es que recuperar un archivo tarda horas, así que sirve para guardar, no para el uso diario.

cf-dam puede archivar de dos formas, según dónde estén tus originales.

## Originales en un NAS u ordenador

El asistente de tu NAS u ordenador puede copiar cada original a un bucket S3 por su cuenta.

1. Primero conecta un bucket en la página **Almacenamiento** (consulta [Conectar Amazon S3](/help/amazon-s3)).
2. En **Ordenadores y NAS**, busca el asistente y, en **Archivar los originales**, pulsa **Configurar el archivado**.
3. Elige el **Bucket** y la **Clase de almacenamiento**: **Deep Archive** para guardar lo más barato posible.
4. Elige las horas en que puede trabajar (**Desde** y **Hasta**, según el reloj del propio asistente), por ejemplo por la noche, y un límite de velocidad en Mbps para que no sature tu conexión a internet. La misma hora en los dos significa a cualquier hora; 0 Mbps significa sin límite.
5. Guarda.

El asistente copia cada original cuando lleva un día sin tocarse (para no archivar un archivo que todavía estás editando) y comprueba cada parte al llegar. Solo **lee** tus archivos: nunca los cambia ni los elimina. El panel muestra lo que se ha enviado, lo que queda y más o menos cuánto tardará.

Puedes **Cambiar** los ajustes o **Dejar de archivar** en cualquier momento. Lo que ya está en el bucket se queda ahí.

## Originales que ya están en un bucket

Si el original de una foto está en S3, su página muestra dónde está y te deja **Mover** el original a otra clase de almacenamiento, por ejemplo de Standard a Deep Archive.

> Amazon cobra una **estancia mínima**: 30 días para las clases IA, 90 días para Glacier y 180 días para Deep Archive. Si sacas una foto antes, pagas igualmente el periodo entero, así que mueve solo las fotos que sepas que vas a dejar tranquilas.

## Recuperar una foto de Glacier

Un archivo en Glacier o Deep Archive no se puede abrir al momento. Primero Amazon tiene que traer una copia:

1. Abre la página de la foto. En el almacenamiento del original, elige la velocidad:

   | Velocidad | Glacier Flexible Retrieval | Deep Archive | Coste |
   | --- | --- | --- | --- |
   | **Urgente** | minutos | no disponible | el más alto |
   | **Estándar** | de 3 a 5 horas | en 12 horas como máximo | unos 20 $ por TB desde Deep Archive |
   | **Masiva** | de 5 a 12 horas | en 48 horas como máximo | el más bajo: unos 2,50 $ por TB desde Deep Archive |

2. Elige cuánto tiempo **Mantener restaurado durante** (después la copia desaparece y el original sigue archivado).
3. Pulsa **Solicitar la restauración**.

cf-dam vigila la restauración por su cuenta y te avisa cuando está lista; **Comprobar el estado** se lo pregunta a Amazon al momento. Una vez restaurada, puedes descargar la foto como siempre hasta que caduque la copia.

Tus miniaturas y vistas previas nunca están en Glacier: siempre puedes ver, buscar, poner palabras clave y compartir cada foto, aunque su original esté en el archivo más profundo.
