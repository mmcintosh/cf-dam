---
title: "Trabajos"
summary: "Seguir cada trabajo para un cliente desde la reserva hasta la entrega: fechas de la sesión, etapas, álbumes, galerías y lo que requiere atención."
section: Sharing
order: 4
review: machine
source: 845d2cf93cb4
---

Un **trabajo** es un encargo para un cliente: una boda, una sesión de retrato, una sesión de producto. Guarda las fechas de la sesión, el lugar, en qué punto está el trabajo y sus álbumes. Sus galerías son las galerías de sus álbumes. **Trabajos** es la primera pestaña de **Trabajo con clientes** en el menú, junto a **Clientes** y **Galerías de clientes**; como los clientes, solo lo ven los **administradores**.

## Crear un trabajo

- **Desde la Biblioteca**, lo habitual, después de la sesión: filtra la Biblioteca para ver las fotos de la sesión (un álbum, un mes, una carpeta, una palabra clave) y pulsa **Nuevo trabajo con estas fotos**. El formulario rellena las fechas de la sesión a partir de las fotos y te ofrece ponerlas en el primer álbum del trabajo.
- **Desde la página de un cliente**: allí, **Nuevo trabajo** elige el cliente por ti.
- **Desde Trabajos**: **Nuevo trabajo**. Puedes crear un cliente nuevo en el mismo formulario: elige **+ Nuevo cliente** y escribe su nombre.

Ponle un título para tu equipo (*Boda García*) y, si quieres, un **Nombre que ve el cliente** (*Vuestra boda*), el tipo de trabajo, la fecha de la sesión (y el último día, si dura varios días), el lugar y cuándo hay que entregarlo.

## Etapas

Un trabajo pasa por **Reservado**, **Fotografiado**, **Edición**, **Selección del cliente**, **Retoques finales**, **Entregado** y **Completado**, o queda **Cancelado**. Pulsa una etapa en la página del trabajo para llevarlo a ella, hacia delante o hacia atrás. **Selección del cliente** y **Retoques finales** (con borde discontinuo) se pueden saltar: una sesión de retrato o de producto a menudo no tiene selección del cliente.

Dos cambios ocurren solos, y el historial lo indica:

- **Reservado → Fotografiado** cuando llegan al archivo fotos tomadas en las fechas de la sesión.
- **→ Entregado** cuando creas una galería a partir de uno de los álbumes del trabajo con **Entrega final** marcada (consulta [Galerías de clientes](/help/client-galleries)).

Todo lo demás depende de ti. **Completado** es para cuando el trabajo está terminado y pagado.

## Álbumes y galerías

En la página del trabajo, **Álbumes** muestra sus álbumes con sus fotos y galerías:

- **Añadir un álbum** pone en el trabajo un álbum que ya tienes. Un álbum pertenece como mucho a un trabajo; una foto puede estar en varios.
- **Nuevo álbum con las fotos de las fechas de la sesión** crea uno con todas las fotos tomadas esos días.
- **Crear una galería** abre el álbum con el formulario de la galería listo.
- **Quitar del trabajo** deja el álbum y sus galerías como están.

Un álbum que forma parte de un trabajo muestra un enlace a él arriba de su página.

## Originales

**Originales**, en la página del trabajo, indica dónde están los archivos originales de sus fotos:

- cuántos **se pueden leer ahora** (desde el almacenamiento propio del archivo, un ordenador o NAS, o una copia restaurada);
- cuántos **necesitan una restauración**: solo están en un archivo en frío (Glacier o Deep Archive), así que nadie puede descargarlos hasta que se recuperen;
- cuántos están **solo en un ordenador o NAS**: puedes abrirlos, pero una galería de clientes no puede ofrecerlos como originales;
- cuántos tienen **copia en frío**, una copia en Glacier o Deep Archive. Si se conserva la copia propia del archivo, una copia en frío no impide leer la foto.

La lista de **Trabajos** muestra lo mismo en corto: *Disponibles* o *n necesitan restaurar*, y *copia en frío* cuando todas las fotos tienen una.

### Restaurar un trabajo

Antes de un pedido de reimpresión, por ejemplo, pulsa **Restaurar n originales…**. Elige la **Velocidad** (*Masiva*: la más barata, hasta 48 horas; *Estándar*: más rápida, hasta 12 horas) y cuántos días mantener las copias, y luego **Ver el coste**: sacarlos del archivo, mantener las copias y lo que cuesta si los clientes los descargan todos una vez (a menudo la parte mayor). Después confirma. La página muestra cuánto ha avanzado la restauración y hasta cuándo están listas las copias. Los originales siguen en el archivo; las copias restauradas desaparecen tras los días elegidos.

Restaurar requiere el permiso para gestionar los niveles de almacenamiento (los administradores lo tienen).

Cuando una galería ofrece originales y algunos originales del álbum están archivados o solo en un NAS, el formulario de la galería lo indica antes de que crees el enlace.

## Archivar después de la entrega

Cuando **Archivar trabajos entregados** está activado (en la página **Almacenamiento**: elige la conexión S3, **Deep Archive** o **Glacier Flexible**, y cuántos días después de la entrega), cada original de los álbumes de un trabajo entregado recibe una copia en esa clase en frío cuando pasan esos días. La copia guardada en el almacenamiento propio de cf-dam se queda, así que nada tarda más en abrirse: la copia en frío es una copia de seguridad que cuesta muy poco mantener.

- Antes de activarlo, **¿Qué archivaría ahora?** muestra cuántos trabajos, originales y GB copiaría de una vez (cuenta cada trabajo que ya lleva entregado el tiempo suficiente), cuánto cuesta al mes mantenerlo y cuánto cuesta subirlo una vez.
- Cada parte de una copia se comprueba al llegar, y al final se compara el tamaño de la copia. Una copia interrumpida sigue donde se quedó.
- Si vuelves a entregar un trabajo, por ejemplo después de devolverlo a **Edición**, sus días empiezan de nuevo.
- **Mantener caliente**, en la página de un trabajo, hace que nunca se archive automáticamente (reimpresiones, álbumes en curso).
- **Archivar ahora** copia un trabajo en el momento, en la clase que elijas (requiere el permiso para gestionar las conexiones de almacenamiento).
- Los originales que solo están en un ordenador o NAS los archiva su asistente cuando esa carpeta archiva en S3 (**Ordenadores y NAS**); si no, el trabajo indica cuántos quedan fuera.
- Los originales que no se han podido copiar tras tres intentos aparecen como aviso.

En **Originales**, en la página del trabajo, **Copia en frío** indica cómo va: cuándo se archivará, cuánto ha avanzado una copia, cuándo se archivó o qué lo impide.

## Lo que requiere atención

Arriba de **Trabajos**, **Requiere atención** muestra:

- una entrega prevista en los próximos 7 días, o con retraso;
- una sesión de hace más de 3 días de la que aún no hay fotos;
- una galería de un trabajo que se cierra en los próximos 7 días;
- una galería de selección sin favoritas después de 14 días.

**En curso** muestra los trabajos abiertos por etapa, primero la sesión más próxima; **Entregados y cerrados** y **Todos** muestran el resto. Busca por título, lugar o cliente; los acentos no importan.

## Borrar un trabajo

**Borrar trabajo**, al final de su página (púlsalo dos veces), elimina solo el trabajo: sus álbumes y galerías se conservan. Borrar un cliente (consulta [Clientes](/help/clients)) también elimina sus trabajos.
