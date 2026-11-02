---
title: "Buscar caras"
summary: "Dejar que cf-dam encuentre las caras de tus fotos para nombrar a las personas con un clic, y qué se guarda."
section: Your photos
order: 11
review: machine
source: 73ecb5d3191d
---

**Buscar caras** muestra en la página de una foto, bajo **Personas**, una pequeña imagen de cada cara que encuentra. Haz clic en una y escribe quién es: la foto se etiqueta con esa persona, como si hubieras añadido el nombre a mano. Ahorra escribir en fotos con varias personas, y así la página de una persona tiene una imagen de su cara.

Es **encontrar, no reconocer**. cf-dam nunca averigua quién es alguien y nunca compara una cara con otra. Cada cara la nombras tú.

## Qué se guarda

Para cada cara: un recuadro (dónde está la cara en la foto) y lo seguro que estaba el detector. Nada más: ningún rasgo facial, ninguna «huella facial», nada que por sí solo pueda identificar a nadie. El detector (BlazeFace de Google) también calcula dónde están los ojos, la nariz y la boca; cf-dam lo descarta antes de guardar nada.

Las caras se encuentran en tus propios equipos, con tu asistente (el programa de tu NAS u ordenador que cataloga tus fotos). Las fotos y las caras nunca se envían a nadie para esto. **Los clientes nunca ven las caras**: ni en las galerías, ni en las descargas, ni en los archivos.

## Activarlo

En **Configuración → Revisión con IA → Buscar caras**, lee lo que implica (consulta [Las caras y la ley](/help/faces-and-the-law)), marca **Lo he leído** y pulsa **Activar «Buscar caras»**. Hace falta permiso para cambiar la configuración (los administradores, por defecto). Después:

- tu asistente revisa cada foto nueva al hacer su vista previa y repasa las fotos anteriores en segundo plano, unos cientos por minuto;
- las fotos subidas por la web se revisan desde su álbum: en la página de un álbum (o de un trabajo), **Buscar caras en este álbum** repasa las fotos aún sin revisar, en esa pestaña. Deja la pestaña abierta (y delante, en un móvil) hasta que termine; cerrarla lo detiene, y el resto espera a la próxima vez. Una pestaña hace unos miles de fotos por hora. Justo después de una subida, el área de subida ofrece lo mismo para las fotos recién enviadas.

Tu asistente tiene que estar al día: uno más antiguo sigue como antes, sin caras.

## Nombrar caras

En la página de una foto, haz clic en una cara:

- escribe un nombre (se ofrecen las personas que ya has nombrado) y pulsa **Nombrar**;
- **No es alguien a nombrar** para un transeúnte, una cara en un cartel o una estatua: se aparta y no se vuelve a ofrecer (**Mostrar** recupera las caras apartadas);
- **Quitar el nombre** quita el nombre de esa cara; si ninguna otra cara de la foto tiene ese nombre, la persona también sale de la foto.

Quitar a alguien de una foto en **Personas** quita también su nombre de su cara en ella. Al fusionar dos personas se mueven sus caras; al eliminar una persona sus caras se apartan, para que no se vuelvan a ofrecer.

Nombrar una cara cambia al momento lo que la pareja puede encontrar en una galería, si la galería incluye a esa persona (consulta [Personas en una galería de cliente](/help/people-in-galleries)).

## Nombrar muchas a la vez

En la página de un álbum (o de un trabajo), **Caras por nombrar** muestra las caras encontradas allí que nadie ha nombrado ni apartado, las más grandes primero. Marca varias caras de la misma persona, escribe o elige su nombre una vez y pulsa **Nombrar**: cada cara marcada se nombra y cada foto se etiqueta. **No es alguien a nombrar** aparta las caras marcadas. **Foto** bajo una cara abre su foto.

## Qué tal funciona

Encuentra la mayoría de las caras hasta aproximadamente el 3 % del ancho de una foto: las últimas filas de un grupo de unas veinte personas. A menudo no ve caras tapadas en parte (por otra cabeza, una mano o un móvil) o muy giradas de lado, y de vez en cuando enmarca algo que no es una cara, como un vestido estampado. A quien no vea lo puedes nombrar a mano en la foto, como siempre.

Buscar caras nunca cambia el número de **Personas** de una foto; la página muestra las dos cosas.

## Pausar y quitar

**Pausar** detiene toda búsqueda al momento; todo lo encontrado se queda, y puedes seguir nombrando caras. Al volver a activarlo, sigue donde lo dejó.

**Quitar todos los recuadros de caras…**, en pausa, elimina cada cara que encontró el detector, con nombre o sin él. Los nombres siguen en las fotos como etiquetas normales. Se hace en segundo plano, unos miles por minuto.

## Si no aparece

Una instalación puede configurarse sin búsqueda de caras. Entonces **Buscar caras** indica que no forma parte de esta instalación, y no aparece nada sobre caras en ningún sitio.
