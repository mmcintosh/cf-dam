---
title: "Correo"
summary: "Enviar invitaciones, restablecimientos de contraseña y correos de galerías desde tu propio dominio: configurarlo, activarlo y qué hacer cuando se detiene."
section: Settings
order: 2
review: machine
source: a8d41006e12b
---

cf-dam puede enviar correo desde tu propio dominio: invitaciones, restablecimientos de contraseña y mensajes sobre galerías de clientes. Mientras no pueda, son enlaces que copias y pasas tú mismo, y todo lo demás funciona como siempre.

El correo se configura en **Configuración → Correo**. Solo lo ven los administradores.

## Qué necesitas

- Tu dominio en **Cloudflare DNS** (la misma cuenta de Cloudflare en la que funciona cf-dam).
- El plan **Workers Paid**. El envío está incluido hasta 3.000 correos al mes; por encima, Cloudflare cobra una pequeña cantidad.
- Una dirección desde la que enviar. Lo mejor es un **subdominio**, por ejemplo `cf-dam@dam.yourstudio.com`: el correo hacia y desde tu dirección principal queda exactamente como está, y los correos a clientes construyen su propia reputación.

## Configurarlo

1. En el panel de Cloudflare, abre **Email Service → Email Sending** y añade el dominio desde el que enviarás (por ejemplo `dam.yourstudio.com`).
2. Cuando muestre los registros DNS que quiere añadir, acepta los tres registros **cf-bounce**.
   - **No** dejes que añada ni sustituya un registro `_dmarc` si ya tienes uno. Dos registros DMARC rompen DMARC para todo tu correo.
   - **No** actives **Email Routing** para un dominio cuyo correo se gestiona en otro sitio (Google, Microsoft, Purelymail…): se quedaría con el correo entrante de ese dominio.
3. Junto al código de cf-dam, en un archivo llamado `.env.deploy`, pon la dirección de envío: `MAIL_FROM=cf-dam@dam.yourstudio.com`.
4. Vuelve a desplegar. El despliegue comprueba que el dominio puede enviar y añade el correo solo si puede; si no, dice por qué y sigue sin él.
5. Abre **Configuración → Correo**, rellena el **Nombre del estudio** y la dirección de **Las respuestas van a** (tu bandeja de entrada real) y pulsa **Activar el correo**.

Activar el correo fija la dirección web a la que apuntan los enlaces de los correos: la que estás usando en ese momento, que se muestra en la página. Si más adelante mueves cf-dam a una dirección nueva, abre Configuración → Correo desde la dirección nueva y pulsa **Usar esta dirección**.

## Comprobar que funciona

**Envíame un correo de prueba** te envía uno al momento y te dice enseguida si no ha podido. La primera vez, mira también en la carpeta de spam.

La página también muestra cuándo salió el último correo, cuántos salieron en las últimas 24 horas, qué está esperando y el último problema.

## Qué se envía

- **¿Olvidaste tu contraseña?** en la página de inicio de sesión: un enlace para elegir una contraseña nueva y, después, un aviso de que ha cambiado. Consulta [Tu cuenta y el inicio de sesión](/help/account-security).
- **Invitaciones**: a los clientes que invitas a una galería o añades a la página de un cliente, y a los nuevos miembros del equipo que eligen su propia contraseña, cuando está marcado **Enviarles la invitación por correo** (o la casilla equivalente del equipo). Consulta [Galerías de clientes](/help/client-galleries) y [Personas y funciones](/help/people-and-roles).
- **Sobre galerías**: **Escribir a los miembros**, un recordatorio tres días antes de que cierre una galería y un aviso para ti cuando un cliente termina de elegir. Los clientes pueden desactivar estos correos para cada galería.
- **Problemas**: a las personas que ven los avisos, cuando algo nuevo necesita atención. Consulta [Avisos y actividad](/help/alerts-and-activity).

Todos los correos salen con el nombre de tu estudio, y las respuestas van a la dirección que hayas indicado.

## Cuando algo va mal

- Si el servicio de envío rechaza la cuenta o la dirección de envío, el correo **se detiene** (no se envía nada más, así que nada se acumula como fallos) y un aviso lo dice en **Equipo → Avisos**. Corrígelo en Cloudflare y luego envía un correo de prueba: cuando llegue, el envío vuelve a empezar y sale todo lo que estaba esperando.
- Un mensaje que falla por un motivo pasajero se vuelve a intentar unos minutos después, tres veces en total.
- Si se alcanza el límite de envío del día, lo que queda espera al día siguiente, con un aviso.
- El servicio de envío omite una dirección que ya rebotó antes; el mensaje se marca como no entregado.

## Qué se guarda

Cada correo espera en una bandeja de salida hasta que se envía. Los enlaces que inician sesión o establecen una contraseña se quitan de ella en cuanto el correo ha salido, y un mensaje cuyo enlace ha caducado nunca se envía. La bandeja de salida no forma parte de las copias de seguridad del catálogo, y las entradas se borran a los 90 días.

## La copia de staging

Una copia de staging de cf-dam puede contener copias de clientes reales, así que solo envía correo a las direcciones de su lista de permitidas (`STAGING_MAIL_ALLOW_TO` en `.env.deploy`). Todo lo demás se descarta, nunca se envía.
