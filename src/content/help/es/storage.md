---
title: "Dónde se guardan los originales"
summary: "La diferencia entre el catálogo y los originales, y los sitios donde cf-dam puede guardar los originales."
section: Where photos are kept
order: 1
review: machine
source: 95bfc3f3803f
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

La página **Almacenamiento** muestra todas las conexiones que has añadido, una por fila: de qué tipo es, cuántos originales guarda y cuánto espacio ocupan, y qué la usa (**Subidas nuevas**, **Archivo de encargos**, **Copias del catálogo**, el archivo de un asistente). Una de ellas es la **Predeterminada**, adonde van las subidas salvo que elijas otra en el cuadro de subida. Pulsa una fila para abrir la página propia de esa conexión.

## Conectar un bucket

En **Almacenamiento**, pulsa **Añadir una conexión** y elige el proveedor. cf-dam rellena lo que puede. Luego le indicas:

- **Nombre:** lo que te ayude a reconocerlo, como «Archivo del estudio».
- **Bucket:** el nombre del bucket, exactamente como lo muestra el proveedor.
- **Región:** dónde está el bucket, como `us-east-1`.
- **Carpeta en el bucket** (opcional): guarda los archivos de cf-dam en una carpeta, como `cf-dam`.
- **Cómo accede:** claves de acceso o, para Amazon, la opción sin claves (consulta [Conectar Amazon S3](/help/amazon-s3)).
- **Clases de almacenamiento que ofrece este bucket** y la **clase predeterminada para las subidas**.

Pulsa **Añadir y probar**. cf-dam abre la página de la nueva conexión y la prueba: escribe un pequeño archivo de prueba (dentro de la carpeta, si indicaste una), lo vuelve a leer y lo borra, y te dice si ha funcionado o por qué no. En una conexión de Amazon sin claves abre en su lugar los pasos de AWS, porque nada funciona hasta que estén hechos.

## La página de una conexión

- **Qué se guarda aquí:** cuántos originales tienen una copia aquí y cuánto espacio ocupan, por tipo de almacenamiento (caliente, templado, frío, archivo profundo), con enlaces que muestran esas fotos en la biblioteca. También las copias de archivo de trabajos que faltan por hacer y las copias de seguridad del catálogo guardadas aquí. Se cuentan a partir del catálogo, no mirando en el bucket.
- **Qué la usa:** las subidas nuevas (si es la predeterminada), el archivo de los trabajos entregados, la copia de seguridad diaria del catálogo, el archivo de un asistente de NAS o Mac, cada uno con dónde cambiarlo.
- **Subir desde el navegador:** consulta más abajo.
- **Catalogar los archivos que ya hay en este bucket:** consulta «Fotos que ya están en un bucket» más abajo.
- **Configuración de AWS para esta conexión sin claves** (solo Amazon): los pasos y las políticas que crear en AWS. Consulta [Conectar Amazon S3](/help/amazon-s3).
- **Datos:** pulsa **Editar** para cambiarle el nombre, cambiar las clases de almacenamiento que ofrece y la clase predeterminada, o cambiar su función (sin claves) o sus claves de acceso. Un secreto nuevo sustituye al anterior; deja el campo vacío para mantenerlo. Al guardar credenciales nuevas, se prueban en el acto. El **bucket, la región, el punto de conexión y la carpeta** solo pueden cambiar mientras no haya nada guardado aquí y nada use la conexión, porque los originales se guardan con esos nombres: para pasar a otro bucket, añade una conexión nueva.
- **Quitar:** olvida la conexión (el bucket y sus archivos se quedan como están). No se puede quitar mientras haya algo guardado aquí o algo la use; la página muestra qué.

## Subir desde el navegador y la regla CORS

Cuando subes a una conexión S3 (es la predeterminada o la elegiste en el cuadro de subida), tu navegador envía las fotos **directamente al bucket**, no a través de cf-dam. Un bucket lo rechaza salvo que permita este sitio, con un ajuste en el propio bucket llamado **regla CORS**.

1. En la página de la conexión, bajo **Subir desde el navegador**, pulsa **Copiar** junto a la regla.
2. En la consola de AWS: **S3**, el bucket, **Permissions**, **Cross-origin resource sharing (CORS)**, **Edit**. Pégala y guarda. (Otros servicios tienen el mismo ajuste en el bucket.)
3. De vuelta en cf-dam, pulsa **Probar la subida desde este navegador**. Envía un byte igual que una subida y te dice si el bucket lo aceptó y, si no, por qué.

Solo necesitas la regla para subir desde el navegador. Las copias propias de cf-dam (archivar trabajos, copias de seguridad, mover entre clases, restauraciones) y el asistente de NAS o Mac llegan al bucket sin ella.

## Fotos que ya están en un bucket

Si el bucket ya tiene fotos, abre la página de la conexión y, bajo **Catalogar los archivos que ya hay en este bucket**, pulsa **Importar**. Cada archivo se puede buscar donde está: no se copia ni se mueve nada. Puedes empezar por una carpeta, como `photos/2019/`. Las vistas previas se crean en segundo plano. Los archivos en almacenamiento profundo aparecen con su nombre, tamaño y clase hasta que los restauras.

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
