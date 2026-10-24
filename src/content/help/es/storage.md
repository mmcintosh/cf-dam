---
title: "Dónde se guardan los originales"
summary: "La diferencia entre el catálogo y los originales, y los sitios donde cf-dam puede guardar los originales."
section: Where photos are kept
order: 1
review: machine
source: b58b424e45f6
---

cf-dam guarda dos cosas distintas en dos sitios distintos.

- **El catálogo:** todo lo que cf-dam sabe de cada foto (sus detalles, palabras clave, pies de foto, valoraciones), más una pequeña **miniatura** y una **vista previa** más grande. Siempre están en tu cuenta de Cloudflare, así que la biblioteca va rápida pase lo que pase con los originales.
- **Los originales:** los archivos completos de tu cámara. Pueden estar en cualquiera de los sitios de abajo, y fotos distintas pueden estar en sitios distintos.

## Dónde pueden estar los originales

| Dónde | Ideal para | Notas |
| --- | --- | --- |
| **Cloudflare R2** (integrado) | Empezar; fotos que abres a menudo | Ya está configurado. Descargar no cuesta nada. |
| **Amazon S3** | Archivos grandes; almacenamiento a largo plazo muy barato | Necesita una cuenta de Amazon Web Services. Consulta [Conectar Amazon S3](/help/amazon-s3). |
| **Backblaze B2, Wasabi, R2 (segundo bucket)** | Alternativas más baratas a Amazon | Se conectan con claves de acceso, como S3. |
| **Tu NAS u ordenador** | Fotos que ya guardas en casa o en el estudio | No se mueve nada: un asistente las cataloga donde están. Consulta [Ordenadores y NAS](/help/computers-and-nas). |

La página **Almacenamiento** muestra todas las conexiones que has añadido. Una de ellas es la **Predeterminada**, adonde van las subidas salvo que elijas otra en el cuadro de subida.

## Conectar un bucket

En **Almacenamiento**, pulsa **Añadir una conexión S3** y elige el proveedor. cf-dam rellena lo que puede. Luego le indicas:

- **Nombre:** lo que te ayude a reconocerlo, como «Archivo del estudio».
- **Bucket:** el nombre del bucket, exactamente como lo muestra el proveedor.
- **Región:** dónde está el bucket, como `us-east-1`.
- **Carpeta en el bucket** (opcional): guarda los archivos de cf-dam en una carpeta, como `cf-dam`.
- **Cómo accede:** claves de acceso o, para Amazon, la opción sin claves (consulta [Conectar Amazon S3](/help/amazon-s3)).
- **Clases de almacenamiento que ofrece este bucket** y la **clase predeterminada para las subidas**.

Pulsa **Añadir y probar**. cf-dam escribe un pequeño archivo de prueba, lo vuelve a leer y lo borra. «Conectado» significa que todo ha funcionado; cualquier otra cosa viene con el motivo.

> **Subir desde el navegador a un bucket** necesita un ajuste más en el propio bucket, llamado regla CORS. El formulario muestra la regla exacta que copiar bajo «Las subidas desde el navegador van directas al bucket». Sin ella, las subidas a ese bucket fallan con un error de red.

## Fotos que ya están en un bucket

Si el bucket ya tiene fotos, abre **Catalogar los archivos que ya hay en este bucket** en la conexión y pulsa **Importar**. Cada archivo se puede buscar donde está: no se copia ni se mueve nada. Puedes empezar por una carpeta, como `photos/2019/`. Las vistas previas se crean en segundo plano. Los archivos en almacenamiento profundo aparecen con su nombre, tamaño y clase hasta que los restauras.

## Clases de almacenamiento, en resumen

Amazon ofrece «clases» más baratas para los archivos que abres poco. Cuanto más barato es el almacenamiento, más tarda y más cuesta recuperar un archivo:

| Clase | Aproximadamente por terabyte al mes | Recuperar un archivo |
| --- | --- | --- |
| Standard | 23 $ | Al momento |
| Standard-IA (acceso poco frecuente) | 12,50 $ | Al momento, con una pequeña tarifa por GB |
| Glacier Flexible Retrieval | 3,60 $ | De 3 a 12 horas |
| Glacier Deep Archive | 1 $ | En un plazo de 12 a 48 horas |

Los precios son los que Amazon publica para EE. UU. en el momento de escribir esto; consulta [la página de precios de S3 de Amazon](https://aws.amazon.com/s3/pricing/) para los tuyos. Amazon también cobra una **estancia mínima**: 30 días para las clases IA, 90 para Glacier y 180 para Deep Archive, aunque borres o muevas el archivo antes.

Puedes mover una foto de una clase a otra desde su página (**Mover**) y recuperar una foto de Glacier con **Solicitar la restauración**. Consulta [Archivar y restaurar](/help/archiving).

## Las otras partes de la página Almacenamiento

- **Comprobaciones:** cf-dam se asegura con regularidad de que los originales que conoce siguen donde cree que están. Los problemas aparecen aquí y como aviso.
- **Archivar trabajos entregados:** una copia en frío en S3 de los originales de cada trabajo entregado, unos días después de la entrega. Consulta [Trabajos](/help/jobs).
- **Cloudflare Images este mes:** cuántas imágenes ha creado Cloudflare este mes para vistas previas, miniaturas, IA y marcas de agua, que Cloudflare cobra por encima de lo que incluye tu plan, con un aviso cuando se supera el número que fijes.
- **Vistas previas:** comprueba que cada miniatura y vista previa existe de verdad y vuelve a crear las que faltan. Consulta [Copias de seguridad y restaurar el catálogo](/help/backups).
- **Copias de seguridad del catálogo:** copias diarias del propio catálogo. Consulta [Copias de seguridad y restaurar el catálogo](/help/backups).
