---
title: "Conectar Amazon S3"
summary: "Una guía paso a paso, desde abrir una cuenta de Amazon Web Services hasta que cf-dam guarde allí los originales."
section: Where photos are kept
order: 2
review: machine
source: a41b1d1edfa1
---

Amazon es conocida sobre todo como tienda, pero también alquila almacenamiento a través de un negocio aparte, **Amazon Web Services (AWS)**. Su servicio de almacenamiento se llama **S3**. Muchos fotógrafos lo usan porque una parte de él, **Glacier Deep Archive**, guarda un terabyte por alrededor de un dólar al mes.

Esta guía te lleva desde cero hasta que cf-dam guarde originales en S3. Calcula unos 30 minutos la primera vez. Necesitarás una dirección de correo electrónico, un teléfono y una tarjeta de crédito o débito.

> No necesitas Amazon para usar cf-dam. Los originales pueden quedarse en el almacenamiento propio de Cloudflare o en tu NAS. Vuelve aquí cuando quieras un almacenamiento barato a largo plazo.

## 1. Abre una cuenta de AWS

Tu cuenta de AWS es independiente de cualquier cuenta de compras de Amazon, aunque use el mismo correo electrónico.

1. Ve a [aws.amazon.com](https://aws.amazon.com) y elige **Create an AWS account**.
2. Indica una dirección de correo electrónico y un nombre de cuenta (el nombre de tu estudio sirve). AWS te envía un código por correo para confirmar la dirección.
3. Elige una contraseña segura. Este primer inicio de sesión es el **root user**: el propietario de la cuenta, con todo el poder. Guarda su contraseña en tu gestor de contraseñas.
4. Rellena tus datos de contacto y una tarjeta de pago. AWS puede hacer un pequeño cargo temporal para comprobar la tarjeta.
5. Confirma tu número de teléfono con el código que te envía AWS.
6. Elige un plan. Las cuentas nuevas empiezan con algo de crédito gratuito en cualquier caso.

> **Sobre el plan Free:** en el momento de escribir esto, el plan Free termina a los seis meses (o cuando se acaba el crédito), y una cuenta que no se haya actualizado para entonces se cierra, con sus archivos. Un archivo fotográfico está pensado para durar, así que elige el plan **Paid** desde el principio o ponte un recordatorio para actualizarlo. Solo pagas por lo que usas.

## 2. Protege la cuenta

Antes de guardar nada:

1. Inicia sesión, abre el menú bajo el nombre de tu cuenta (arriba a la derecha) y elige **Security credentials**.
2. En **Multi-factor authentication (MFA)**, elige **Assign MFA device** y añade una llave de acceso, una app de autenticación o una llave de seguridad. A partir de ahora, la necesitarás para iniciar sesión como root user.
3. Configura un aviso de gasto: busca **Budgets** en la consola, elige **Create budget**, escoge la plantilla de coste mensual e indica una cantidad pequeña, como 10 $, y tu correo electrónico. AWS te escribe si los costes del mes la superan.

## 3. Crea un bucket

Un **bucket** es un espacio de almacenamiento con nombre. Con uno basta para cf-dam.

1. En el cuadro de búsqueda de arriba en la consola de AWS, escribe **S3** y ábrelo.
2. Elige **Create bucket**.
3. **Bucket name:** letras minúsculas, números y guiones, como `smith-studio-archive`. Tiene que ser único en todo AWS, así que añade algo tuyo.
4. **Region:** elige la más cercana a ti (por ejemplo, **US East (N. Virginia)** es `us-east-1`; **Europe (London)** es `eu-west-2`). Apunta el código: cf-dam te lo pedirá.
5. Deja activado **Block all public access**. Tus fotos siguen siendo privadas; cf-dam no necesita que sean públicas.
6. Deja el resto de ajustes como están y elige **Create bucket**.

## 4. Conéctalo a cf-dam

cf-dam puede acceder a tu bucket de dos formas. **Sin claves** es más seguro: nunca se guarda ningún secreto parecido a una contraseña. Usa **claves de acceso** si la opción sin claves no te sirve, por ejemplo si tu cf-dam no está en `https`.

### Sin claves (recomendado)

Necesitarás tu **AWS account ID**: el número de 12 cifras que aparece en el menú bajo el nombre de tu cuenta, arriba a la derecha en la consola de AWS.

1. En cf-dam, abre **Almacenamiento** y pulsa **Añadir una conexión S3**.
2. Elige **Amazon S3** y luego **Sin claves: una función de IAM (recomendado)**.
3. Rellena un **Nombre**, el nombre del **Bucket**, el código de **Región** y, si quieres, una **Carpeta en el bucket** como `cf-dam`.
4. **ARN de la función:** escribe `arn:aws:iam::`, luego tu ID de cuenta de 12 cifras y después `:role/cf-dam`. Por ejemplo: `arn:aws:iam::123456789012:role/cf-dam`. (Crearás esta función en un momento.)
5. Pulsa **Añadir y probar**. De momento la prueba falla: es lo esperado.
6. En la nueva conexión, abre **Configuración de AWS para esta conexión sin claves**. Muestra tres cosas que copiar: una **URL y audiencia del proveedor de identidad**, una **política de confianza** y una **política de permisos**.

Ahora, en la consola de AWS:

7. Busca **IAM** y ábrelo. Elige **Identity providers** y luego **Add provider**.
8. Elige **OpenID Connect**. Pega la **URL del proveedor** y la **audiencia** de cf-dam. Elige **Add provider**.
9. En IAM, elige **Roles** y luego **Create role**.
10. Elige **Custom trust policy**, borra lo que haya en el cuadro y pega la **política de confianza** de cf-dam (el botón **Copiar** la copia). Elige **Next**.
11. Sáltate la lista de permisos (elige **Next**). Ponle a la función exactamente el nombre `cf-dam` y luego **Create role**.
12. Abre la nueva función. En **Permissions**, elige **Add permissions** y luego **Create inline policy**.
13. Elige **JSON**, borra lo que haya y pega la **política de permisos** de cf-dam. Elige **Next**, llámala `cf-dam-bucket` y pulsa **Create policy**.

De vuelta en cf-dam, pulsa **Probar** en la conexión. «Conectado: se ha escrito, leído y borrado un objeto de prueba» significa que ya está.

La política de permisos solo deja entrar a cf-dam en **ese bucket** (y esa carpeta): puede añadir, leer, eliminar y restaurar archivos allí, y listarlos. No puede tocar nada más de tu cuenta de AWS.

### Con claves de acceso

1. En la consola de AWS, abre **IAM**, elige **Users** y luego **Create user**. Llámalo `cf-dam`. No le des acceso a la consola. Elige **Next**.
2. Elige **Attach policies directly**, luego **Next** y **Create user** (añadirás una política en un momento).
3. Abre el nuevo usuario. Elige **Add permissions**, luego **Create inline policy**, luego **JSON**, y pega esto, poniendo el nombre de tu bucket donde dice `YOUR-BUCKET` (dos veces):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:RestoreObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    },
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::YOUR-BUCKET" }
  ]
}
```

4. Llama a la política `cf-dam-bucket` y créala.
5. En la pestaña **Security credentials** del usuario, elige **Create access key**, escoge **Application running outside AWS** y créala.
6. AWS muestra un **Access key ID** y una **Secret access key**. El secreto se muestra **una sola vez**: deja esta página abierta.
7. En cf-dam, **Almacenamiento → Añadir una conexión S3 → Amazon S3 → Claves de acceso**. Rellena el nombre, el bucket, la región y la carpeta, pega las dos claves y pulsa **Añadir y probar**.

cf-dam cifra el secreto antes de guardarlo y no lo vuelve a mostrar. Nunca envíes claves por correo ni las pegues en ningún otro sitio.

## 5. Si vas a subir directamente a este bucket

Cuando subes desde el navegador a una conexión S3, los archivos van directamente de tu ordenador a Amazon. El bucket tiene que permitirlo:

1. En el formulario **Añadir una conexión S3** de cf-dam (o cuando añadas otra), abre **Las subidas desde el navegador van directas al bucket** y copia la regla.
2. En la consola de AWS, abre el bucket, luego **Permissions**, baja hasta **Cross-origin resource sharing (CORS)** y elige **Edit**.
3. Pega la regla y pulsa **Save changes**.

No lo necesitas si tus fotos solo llegan a S3 porque se importan o se mueven allí.

## 6. Hazlo predeterminado (opcional)

En **Almacenamiento**, pulsa **Hacer predeterminada** en la conexión para enviar allí las nuevas subidas. Aun así, puedes elegir otro sitio en el cuadro de subida.

## Cuánto cuesta

| | Aproximadamente (precios de EE. UU.) |
| --- | --- |
| Guardar en S3 Standard | 23 $ por terabyte al mes |
| Guardar en Glacier Deep Archive | 1 $ por terabyte al mes (permanencia mínima de 180 días) |
| Recuperar un archivo de Deep Archive | unos 20 $ por terabyte (opción «Bulk», más barata: unos 2,50 $), más una espera de hasta 12 o 48 horas |
| Descargar fuera de AWS | unos 90 $ por terabyte a partir de los primeros 100 GB al mes |
| Las miniaturas y vistas previas de cf-dam | nada en Amazon: están en Cloudflare |

Consulta la [página de precios de S3 de Amazon](https://aws.amazon.com/s3/pricing/) para tu región. Consulta [Archivar y restaurar](/help/archiving) para mover fotos a Glacier y recuperarlas.

## Si la prueba falla

| Lo que dice cf-dam | Suele significar |
| --- | --- |
| Access Denied | La política de permisos tiene otro nombre de bucket, o una carpeta que no coincide con la carpeta de la conexión. |
| Un mensaje sobre la región, o un «redirect» | El código de región en cf-dam no coincide con la región del bucket. |
| Not authorized to perform `sts:AssumeRoleWithWebIdentity` | Sin claves: la URL o la audiencia del proveedor de identidad, o la política de confianza de la función, no coinciden con lo que mostró cf-dam. Vuelve a copiarlas. |
| No se encuentra la función | El ARN de la función tiene una errata, o la función no se llama `cf-dam`. |
| Las subidas fallan con un error de red | Falta la regla CORS del bucket (paso 5). |

¿Sigues atascado? El [glosario](/help/glossary) explica los términos de AWS. Puedes **Quitar** una conexión que nunca funcionó y empezar de nuevo. (cf-dam no quita una que todavía guarda originales: muévelos primero.)
