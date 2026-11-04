---
title: "Avisos y actividad"
summary: "Problemas que necesitan a alguien y el registro de quién hizo qué."
section: People and security
order: 3
review: machine
source: 8c052952756a
---

Las dos páginas son para administradores.

## Avisos

cf-dam se revisa a sí mismo cada cinco minutos y crea un **aviso** cuando algo necesita a una persona. El menú muestra cuántos hay abiertos junto a **Avisos**.

| Aviso | Qué suele significar | Qué hacer |
| --- | --- | --- |
| Un asistente está sin conexión | Un NAS u ordenador está apagado, en reposo o ha perdido la conexión de red. | Comprueba que esté encendido. Después de un cambio en la red, reinicia el asistente (o su contenedor). |
| Un asistente no tiene permiso para leer una carpeta | El ordenador o el NAS no le deja entrar: en un Mac, se le negó el acceso a Imágenes, a una unidad o a un volumen de red. | En un Mac: **System Settings → Privacy & Security → Files and Folders** (o **Full Disk Access**), permite `node`. En un NAS: los permisos de la carpeta. |
| Problemas de archivado | Un asistente no pudo copiar los originales al bucket de archivo. | El aviso dice por qué: a menudo son los permisos del bucket. |
| Problemas de almacenamiento | Hay originales que cf-dam esperaba y no estaban donde creía, o no se puede leer un bucket. | Abre **Almacenamiento → Comprobaciones**. |
| Copias de seguridad que fallan o se retrasan | La copia de seguridad diaria del catálogo no terminó. | Consulta [Copias de seguridad](/help/backups); revisa el bucket de las copias. |
| Vistas previas atascadas | No se pudieron crear algunas miniaturas o vistas previas. | **Almacenamiento → Vistas previas → Reintentar las atascadas**. |
| Fotos que no se pudieron procesar o que esperan | No se pudo leer un archivo (dañado, o de un tipo que cf-dam no sabe abrir), o hay fotos que llevan más de un día esperando porque el trabajo en segundo plano no avanza. | **Ir a** muestra en la biblioteca las que no se pudieron procesar: súbelas de nuevo o quítalas. Para las fotos que esperan, consulta *Trabajo en segundo plano* más abajo. |
| La revisión con IA se rindió | El modelo de IA falló tres veces con algunas fotos; el aviso da su último error. | **Ir a** las muestra en la biblioteca. Cuando la causa esté resuelta, selecciónalas y elige **IA… → Volver a analizar**. |
| El archivado se ha detenido | Hay originales esperando a copiarse al archivo y no se ha copiado ninguno en más de un día. | Revisa la conexión de almacenamiento del archivo: ábrela desde **Almacenamiento** y pulsa **Probar**. |
| AWS rechazó el rol | Amazon rechazó el rol sin claves de cf-dam para una conexión de almacenamiento: el rol o su política de confianza se cambió o se eliminó. | **Ir a** abre la conexión. Corrige el rol en AWS (consulta [Amazon S3](/help/amazon-s3)) y luego pulsa **Probar**. |
| Trabajo en segundo plano que falla o se ha detenido | El trabajo que cf-dam hace cada minuto (procesamiento, IA, comprobaciones, copias de seguridad) tiene un error o no se ha ejecutado. | El aviso dice qué parte. Si se ha detenido por completo, busca errores en los registros del Worker en el panel de Cloudflare, o vuelve a desplegar. |

Cada aviso indica desde cuándo existe e incluye **Ir a** la página donde se arregla. Cuando el problema se soluciona, el aviso se cierra solo y pasa a **Arreglados en las dos últimas semanas**.

**Descartar** saca un aviso del recuento mientras te ocupas de él (o si has decidido que no importa). Vuelve a contar si reaparece después de arreglarse; **Volver a contarlo** deshace el descarte.

### Por correo

Cuando este archivo puede enviar correos (consulta [Correo](/help/email)), las personas que ven los avisos también reciben un correo cuando se abre uno nuevo: como mucho uno al día por cada tipo de problema, con la lista de lo que está abierto y un enlace a esta página. No se envía correo cuando un asistente de escritorio deja de dar señales (un portátil en reposo), ni por problemas con el propio correo. Desactiva estos correos, o vuelve a activarlos, en **Cuenta → Correos sobre problemas**.

## Actividad

**Actividad** es el registro de quién ha iniciado sesión y quién ha cambiado qué, lo más reciente primero: inicios de sesión (y los fallidos), personas añadidas o modificadas, funciones, cambios en la verificación en dos pasos, conexiones de almacenamiento, importaciones, eliminaciones, galerías compartidas, revisiones con IA puestas en cola, ajustes cambiados y trabajo en segundo plano como copias de seguridad y comprobaciones.

Fíltralo por **Tipo** de evento o por **Persona**. Es el primer sitio donde mirar cuando algo ha cambiado y no sabes cómo.
