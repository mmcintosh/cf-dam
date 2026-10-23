---
title: "Glosario"
summary: "Las palabras que usan cf-dam y los servicios de almacenamiento, explicadas con sencillez."
section: Getting started
order: 9
review: machine
source: 1f33cb2730fb
---

**Revisión con IA.** Un modelo de IA mira cada foto y escribe sugerencias: texto alternativo, un pie de foto, una descripción, palabras clave. Tú decides qué conservar. Consulta [Revisión con IA](/help/ai-review).

**Texto alternativo.** Una descripción breve de una foto para quien no puede verla. Los lectores de pantalla la leen en voz alta; las galerías y los sitios web la usan.

**Copia de archivo.** Una copia segura y barata de tus originales, normalmente en Glacier Deep Archive, para el día en que algo salga mal. Consulta [Archivar](/help/archiving).

**AWS (Amazon Web Services).** El negocio de Amazon que alquila ordenadores y almacenamiento, aparte de su tienda. S3 forma parte de él. Consulta [Conectar Amazon S3](/help/amazon-s3).

**Bucket.** Un espacio de almacenamiento con nombre en S3, R2 o servicios parecidos: como un disco en la nube. cf-dam puede guardar los originales en uno o en varios.

**Catálogo.** Todo lo que cf-dam sabe de tus fotos: datos, palabras clave, pies de foto, valoraciones, álbumes, miniaturas y vistas previas. No los originales en sí.

**Galería de cliente.** Un álbum compartido con un cliente mediante un enlace privado, con su propia contraseña, caducidad y descargas, o con un cliente que inicia sesión en una cuenta que solo le muestra sus galerías. Consulta [Galerías de clientes](/help/client-galleries).

**Docker.** Una forma estándar de ejecutar programas pequeños, como el asistente de cf-dam, en un NAS. Cada programa se ejecuta en su propio «contenedor» aislado.

**EXIF.** Los datos que tu cámara escribe en cada foto: cámara, objetivo, exposición, fecha y hora, y la posición GPS si la tiene.

**Glacier y Deep Archive.** Las clases de almacenamiento más baratas de Amazon, para archivos que abres muy de vez en cuando. Un terabyte en Deep Archive cuesta alrededor de un dólar al mes, pero recuperar un archivo tarda hasta 12 o 48 horas. Consulta [Archivar](/help/archiving).

**HEIC.** El formato de foto que usan los iPhone. cf-dam lo lee.

**Asistente (agente).** Un pequeño programa en tu NAS u ordenador que cataloga las fotos donde están, sin moverlas. Consulta [Ordenadores y NAS](/help/computers-and-nas).

**IPTC.** El conjunto estándar de campos para describir fotos que usan agencias, periódicos, Lightroom y Photo Mechanic: titular, autor, línea de crédito, copyright, condiciones de uso, datos de contacto, lugar, encargo.

**Palabra clave.** Una palabra o frase que dice qué hay en una foto o de qué trata. cf-dam las guarda en un árbol, como *Lugares › Noruega › Bergen*. Consulta [Palabras clave](/help/keywords).

**Foto parecida.** Una copia de una foto que no es el mismo archivo: redimensionada, guardada de nuevo, exportada otra vez. Consulta [Duplicados](/help/duplicates).

**Metadatos.** Información sobre una foto, no la imagen en sí: EXIF, IPTC, palabras clave, pies de foto, valoraciones.

**NAS (almacenamiento conectado a la red).** Una caja con discos en tu red, como un Synology o un QNAP, que guarda archivos para todos los ordenadores de la casa o del estudio.

**Neuronas.** Cómo mide (y factura) Cloudflare Workers AI. Tienes 10.000 al día gratis; después, 0,011 $ por cada 1000. Revisar 1000 fotos gasta unas 46.000.

**Original.** El archivo completo de tu cámara o de tu programa de edición. cf-dam nunca lo cambia.

**Código de emparejamiento.** Las ocho letras que muestra un asistente nuevo. Al escribirlas en cf-dam, el asistente se conecta a tu archivo.

**Llave de acceso.** Una forma de iniciar sesión con tu huella, tu cara, el PIN de tu dispositivo o tu gestor de contraseñas en lugar de una contraseña. Más segura, y no tienes nada que recordar. Consulta [Tu cuenta y el inicio de sesión](/help/account-security).

**Vista previa.** Una copia grande de una foto (hasta 2048 píxeles de ancho) que cf-dam crea para verla, compartirla y revisarla con IA, guardada en tu cuenta de Cloudflare.

**R2.** El almacenamiento propio de Cloudflare. Las miniaturas y vistas previas de cf-dam siempre están ahí, y los originales también pueden estarlo.

**RAW.** El archivo sin procesar que guardan algunas cámaras (como `.CR3`, `.NEF`, `.ARW`). Contiene el máximo detalle; lo revelas en Lightroom o un programa parecido.

**Restaurar.** Traer de vuelta desde Glacier una copia de un original archivado para poder descargarla. También: recuperar el catálogo a partir de una copia de seguridad. Consulta [Copias de seguridad](/help/backups).

**S3.** El servicio de almacenamiento de Amazon, y el «idioma» que hablan también muchos otros servicios de almacenamiento (R2, Backblaze B2, Wasabi).

**Clase de almacenamiento.** Cómo se guarda un archivo en S3: Standard (inmediato, el más caro), Infrequent Access, Glacier, Deep Archive (el más lento y el más barato).

**Miniatura.** Una copia pequeña de una foto (480 píxeles de ancho) para la cuadrícula de la biblioteca.

**Verificación en dos pasos (doble factor).** Un segundo paso después de tu contraseña: un código de una app de tu teléfono. Consulta [Tu cuenta y el inicio de sesión](/help/account-security).

**Marca de agua.** Tu nombre o logotipo superpuesto a las fotos que se muestran en las galerías de clientes y en las copias descargadas. Los originales nunca llevan marca de agua.

**XMP.** Una forma estándar de guardar metadatos (palabras clave, pies de foto, valoraciones, etiquetas) dentro de una foto o en un pequeño archivo a su lado (un archivo «sidecar»), que leen Lightroom, Capture One y Bridge.
