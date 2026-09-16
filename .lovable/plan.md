# Biblioteca VIP de 1700+ GIFs/videos de ejercicios con bot de Telegram y pagos

## Qué vamos a construir

Un bot de Telegram que vende acceso a una biblioteca de más de 1700 videos/GIFs de ejercicios, con dos productos:

- **Ver en línea — $2**: acceso a una app web privada (streaming/visualización), sin descarga.
- **Ver y descargar — $10**: mismo acceso más descarga de los archivos.

El bot atiende el cobro y la entrega; la biblioteca vive en una app web protegida (no dentro del grupo de Telegram). Esto es lo que hace posible controlar quién ve qué, y evita que el plan de $2 termine con los archivos en su teléfono.

## La decisión clave: no entregues los archivos por Telegram

En tu bot actual el producto es un grupo VIP. Para una biblioteca de videos eso no funciona: cualquier archivo enviado en Telegram se reenvía y se descarga, incluso con "prohibir reenvío" activado (se puede grabar pantalla y el archivo ya está en el dispositivo). Si el contenido se entrega en el grupo, el plan de $2 y el de $10 son el mismo producto.

Propuesta: el bot es la caja registradora y la puerta; el contenido se ve en una app web propia con enlaces firmados de corta duración. Ahí sí se puede separar "ver" de "descargar".

## Flujo del usuario

```text
/start en el bot
   -> elige plan ($2 ver | $10 ver+descargar)
   -> paga por PayPal
   -> PayPal confirma (webhook)
   -> el bot manda un botón "Abrir mi biblioteca"
   -> la app web abre ya autenticada con su cuenta de Telegram
   -> ve el catálogo; el botón de descarga sólo aparece en el plan de $10
```

## Protección del contenido (por capas, realista)

Ninguna capa es perfecta, pero juntas hacen el robo incómodo y rastreable:

1. **Nada público**: los archivos se guardan en almacenamiento privado. La app nunca expone una URL fija.
2. **Enlaces firmados de corta vida**: cada reproducción genera una URL que caduca en 1–2 minutos y sirve sólo a ese usuario.
3. **Descarga sólo con plan de $10**: el permiso se comprueba en el servidor, no en el navegador.
4. **Marca de agua personalizada**: el nombre/ID del comprador se sobreimprime al vuelo en lo que ve. Si aparece filtrado, se sabe de quién salió.
5. **Límites de uso**: tope de reproducciones por minuto y por día; una sesión activa por cuenta. Si alguien comparte su acceso, choca con el límite.
6. **Sesión atada al usuario**: el enlace de acceso es personal y de un solo uso; no funciona reenviado a un amigo.
7. **Panel de auditoría**: registro de quién vio qué y desde dónde, para detectar cuentas revendidas y bloquearlas.

Y en la interfaz: sin clic derecho, sin menú de descarga del reproductor. Es cosmético, pero filtra al 90% de los curiosos.

## Aguantar más de 1000 personas entrando de golpe

Esto es lo que tu bot actual no soportaría (un solo proceso Flask, una conexión nueva a la base por consulta, self-ping para no dormirse). El diseño nuevo:

- **Responder a Telegram al instante y trabajar después**: el webhook guarda el evento y contesta OK en milisegundos; el trabajo pesado (crear accesos, mandar mensajes) va en una cola. Telegram reintenta si tardas, y ahí es donde se cae un bot con mucho tráfico.
- **Conexiones a base de datos agrupadas**, no una por consulta.
- **Catálogo servido desde caché/CDN**: 1700 fichas se sirven prearmadas; las miniaturas y los archivos van por CDN, así el pico no toca la base de datos.
- **Envío de mensajes con control de ritmo**: Telegram limita ~30 mensajes por segundo; la cola respeta ese límite en lugar de fallar.
- **Pagos idempotentes**: el mismo aviso de PayPal repetido no crea dos suscripciones ni cobra doble.
- **Confirmación por webhook de PayPal**, no por la página de retorno: si el usuario cierra el navegador, el pago igual se acredita.
- **Prueba de carga** simulando 1000 `/start` y 200 pagos simultáneos antes de abrir al público.

## Cómo entra el catálogo de 1700 archivos

- Subes los archivos a almacenamiento privado (carga por lotes, no uno por uno).
- Cada uno lleva: nombre del ejercicio, músculo principal, equipo, dificultad y etiquetas de búsqueda.
- Si los nombres de archivo ya traen esa información, la extraemos automáticamente y tú sólo corriges lo que salga mal.
- El catálogo necesita buscador y filtros; con 1700 fichas, sin filtros es inservible.

## Plan por etapas

1. **Etapa 1 — Base**: activar la base de datos y el almacenamiento privado, cuentas de usuario, y el modelo de catálogo/permisos.
2. **Etapa 2 — Biblioteca web**: catálogo con buscador y filtros, reproductor con enlaces firmados, marca de agua y bloqueo de descarga.
3. **Etapa 3 — Carga masiva**: importar los 1700+ archivos con sus datos y generar miniaturas.
4. **Etapa 4 — Bot y pagos**: bot de Telegram con los dos planes, cobro por PayPal con confirmación por webhook, entrega del acceso, cola de trabajos.
5. **Etapa 5 — Administración**: panel para ver ventas, actividad sospechosa, bloquear cuentas y reenviar accesos.
6. **Etapa 6 — Carga y lanzamiento**: prueba de 1000 usuarios simultáneos, ajustes, apertura.

## Notas técnicas

- Backend con Lovable Cloud (base de datos Postgres con políticas por fila, almacenamiento privado, funciones de servidor). Los archivos van en un bucket privado; el acceso siempre por URL firmada generada en servidor tras verificar la suscripción.
- Webhook de Telegram y de PayPal como rutas públicas con verificación de firma; el resto de endpoints exige sesión.
- Cola de trabajos en tabla con reintentos y respeto del límite de envío de Telegram.
- Login en la app web mediante enlace personal de un solo uso emitido por el bot (o Telegram Login Widget), canjeado por una sesión.
- El conector de Telegram ya disponible se encarga de las credenciales del bot; nada de tokens en el código.
- Marca de agua: sobreimpresión en el reproductor para GIF/video corto, más versión quemada en el archivo para las descargas del plan de $10.

## Decisiones que necesito de ti

1. ¿Los 1700 archivos son GIF, MP4, o mezcla? ¿Cuánto pesan en total?
2. ¿Los pagos son de una sola vez (acceso permanente) o suscripción mensual?
3. ¿Quieres conservar el grupo VIP de Telegram además de la biblioteca web, o sólo la biblioteca?
4. ¿Mantienes el día gratis de prueba?
