---
title: "Vender fotos"
summary: "Dejar que los clientes compren archivos digitales desde su galería: conectar Stripe, listas de precios, pedidos, reembolsos y de qué eres responsable."
section: Sharing
order: 5
review: machine
source: 43b5d0e7ac24
---

Los clientes pueden comprar archivos digitales desde su galería y pagar con Stripe, en tu propia cuenta de Stripe. El dinero va para ti; cf-dam no cobra comisión. Las copias impresas llegarán más adelante.

## Qué necesitas

- Una cuenta de **Stripe** (stripe.com). Prueba todo primero con el **modo de prueba** de Stripe: no se mueve dinero real, y cf-dam muestra **Modo de prueba** mientras estás en él.
- Estar listo para actuar como vendedor: el IVA o los impuestos sobre las ventas, los reembolsos y los recibos son cosa tuya. Stripe puede calcular y cobrar los impuestos por ti, pero el registro y las declaraciones te tocan a ti.

## Conectar Stripe

En **Trabajo con clientes → Pedidos**, la sección **Venta** te guía paso a paso (solo administradores):

1. En Stripe, en **Developers → API keys**, crea una **clave restringida** que pueda escribir Checkout Sessions y leer Charges y Payment Intents. Pégala en **Clave restringida de Stripe**.
2. En Stripe, en **Developers → Webhooks**, añade un endpoint con la dirección que se muestra y los eventos que aparecen al lado.
3. Copia el **signing secret** de ese endpoint (empieza por `whsec_`) en **Signing secret del webhook**, pulsa **Guardar** y luego **Comprobar**.

La clave y el secret se guardan cifrados, no se vuelven a mostrar y quedan fuera de las copias de seguridad del catálogo (vuelve a introducirlos después de restaurar en una instalación nueva). En **Tú, el vendedor**, elige la **Moneda** (no se puede cambiar una vez que la usan precios o pedidos), el **Nombre del negocio** y las **Condiciones y reembolsos** que se muestran en la página de pago de Stripe.

## Listas de precios

Una lista de precios indica cuánto cuestan **Pequeña**, **Grande** y **Tamaño completo**, y cuánto cuestan **Todas las fotos** de una galería de una vez. Deja un precio vacío para no vender ese tamaño. Crea tantas listas como quieras (para bodas, para retratos…) y luego elige una para una galería, bajo su enlace, en **Vende con**.

- Un tamaño que la galería ya da gratis no se vende en ella.
- **Pequeña** y **Grande** se hacen a partir de la foto tal como la ven los clientes (con tu giro y tu recorte), sin la marca de agua.
- **Tamaño completo** es el archivo original, así que solo se ofrece para originales JPEG y PNG que no hayas girado ni recortado en cf-dam, y solo mientras el original se pueda leer en ese momento (no en un NAS, no en almacenamiento de archivo profundo).

## Qué ven los clientes

En la galería, la vista grande de una foto tiene **Comprar…** con cada tamaño y su precio, y arriba de la galería aparece **Comprar todas las fotos** cuando eso tiene precio. Pagan en la propia página de Stripe (tarjeta, Apple Pay, Google Pay, Link) y vuelven a su **página del pedido**: su dirección es su enlace a los archivos, en cualquier dispositivo. La galería también muestra lo que compraron, en el navegador con el que lo compraron.

## Pedidos

**Trabajo con clientes → Pedidos** lista lo que se ha comprado: cuándo, quién, desde qué galería, el total y su estado.

- **Pagado**: las descargas funcionan.
- **Por revisar**: Stripe dice que está pagado, pero el importe no coincide con lo pedido. No se puede descargar nada hasta que lo hayas revisado; resuélvelo en Stripe (reembolso o contacto con el cliente).
- **Reembolsado** y **En disputa**: las descargas se detienen. Haz los reembolsos en tu panel de Stripe; el pedido de aquí se actualiza solo.
- **Pagándose** y **No pagado**: un cliente salió de la página de pago; no se cobró nada.

Si el mensaje de Stripe sobre un pago se pierde, cf-dam se lo pregunta a Stripe unos minutos después, para que un pedido pagado nunca se quede atascado.
