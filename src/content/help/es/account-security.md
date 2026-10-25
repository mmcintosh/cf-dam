---
title: "Tu cuenta y el inicio de sesión"
summary: "Llaves de acceso, verificación en dos pasos, tu contraseña, dónde tienes la sesión iniciada y claves de API."
section: People and security
order: 2
review: machine
source: f65cab557caa
---

Tu página **Cuenta** (el último elemento del menú) reúne todo lo relacionado con cómo inicias sesión. Ahí también está [Apariencia y accesibilidad](/help/appearance).

Tu archivo guarda años de trabajo y momentos privados de otras personas, así que merece la pena dedicar cinco minutos a que iniciar sesión sea seguro.

## Llaves de acceso: la forma más fácil y segura

Una **llave de acceso** te permite iniciar sesión con tu huella, tu cara o el PIN del dispositivo, o con un gestor de contraseñas como 1Password, en lugar de una contraseña. No hay nada que escribir ni nada que una web falsa pueda robar.

1. En **Llaves de acceso**, pulsa **Añadir una llave de acceso**.
2. Tu navegador o tu gestor de contraseñas te pregunta dónde guardarla; sigue sus pasos.

Añade una en cada dispositivo que uses (o una en un gestor de contraseñas que las sincronice; la lista indica **sincronizada**). Por seguridad, para añadir una llave de acceso tienes que haber iniciado sesión en los últimos 15 minutos: si te lo pide, cierra sesión, vuelve a iniciarla y añádela.

## Verificación en dos pasos con una app de autenticación

Si inicias sesión con contraseña, añade un segundo paso: un código de seis cifras de una app de tu teléfono (Google Authenticator, Microsoft Authenticator, 1Password, Authy y otras).

1. En **Verificación en dos pasos**, pulsa **Configurar la verificación en dos pasos** y confirma tu contraseña.
2. Escanea el código con tu app de autenticación (o escribe la clave que aparece en **¿No puedes escanear?**).
3. Escribe el código que muestra la app y pulsa **Verificar y activar**.
4. **Guarda los códigos de respaldo** en un lugar seguro, como tu gestor de contraseñas o en papel. Cada uno sirve una vez si pierdes el teléfono. No se volverán a mostrar.

No necesitas códigos cuando inicias sesión con una llave de acceso. Tu administrador puede exigir una cosa u otra a todo el mundo (consulta [Personas y funciones](/help/people-and-roles)).

**¿Has perdido el teléfono y los códigos de respaldo?** Pídeselo a un administrador: en **Equipo → Cuentas**, **Teléfono o llave de acceso perdidos** desactiva tus códigos para que puedas configurarlos de nuevo.

## Tu contraseña

Al menos 12 caracteres. Una frase corta que recuerdes es mejor que un batiburrillo que olvidarás. Cámbiala en **Contraseña**: escribe la actual y luego la nueva. Tras demasiados intentos fallidos, la cuenta se bloquea durante un rato, y un administrador puede desbloquearla.

¿La olvidaste? Cuando este archivo puede enviar correos (consulta [Correo](/help/email)), la página de inicio de sesión tiene **¿Olvidaste tu contraseña?**: escribe tu dirección y llegará un enlace para elegir una contraseña nueva, que funciona una vez, durante una hora. También cierra todas las demás sesiones, quita un bloqueo y recibirás un correo diciendo que la contraseña cambió. La verificación en dos pasos sigue pidiendo su código. Sin correo, pide a un administrador una contraseña temporal.

## Dónde tienes la sesión iniciada

Cada navegador mantiene la sesión hasta que pasa una semana sin usarse. **Dónde tienes la sesión iniciada** los muestra y marca **Este navegador**. **Cierra la sesión** en los que no reconozcas y cambia tu contraseña.

## Claves de API

Para scripts y otros programas que trabajan con tu archivo, como un script de exportación. Una clave solo puede hacer lo que tú puedes, limitado a los **permisos** que elijas, y puede caducar. La clave se muestra **una sola vez**, al crearla: cópiala entonces. Nunca compartas claves ni las pongas en un correo.

La mayoría de la gente nunca necesita una. Los asistentes de tu NAS y tus ordenadores reciben sus propias claves al emparejarse; esas no se crean aquí.
