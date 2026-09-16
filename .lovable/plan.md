# Plan actualizado: prueba de 2 horas + pago único de $10

Cambia el modelo de negocio de lo ya construido (dos planes de $2 y $10) al nuevo:
prueba gratis de 2 horas para ver, y un solo pago de $10 para acceso permanente con descarga.

## 1. Modelo comercial nuevo

- `/start` en el bot registra al usuario y activa automáticamente 2 horas de prueba (solo ver, sin descargar).
- Al terminar las 2 horas, la biblioteca se bloquea y muestra el muro de pago de $10.
- El pago de $10 da acceso permanente: ver en línea y botón de descarga en el móvil.
- Desaparece el plan de $2: el bot ya no pregunta entre dos opciones.

## 2. Qué se ajusta de lo ya hecho

- El bot: `/start` crea la prueba y manda el botón "Abrir mi biblioteca" al instante; `/planes` pasa a ser un único botón de pago de $10.
- La app web muestra el tiempo restante de la prueba y, al expirar, reemplaza el reproductor por el muro de pago.
- El servidor deja de firmar enlaces de video cuando la prueba venció y no hay pago.
- La descarga sigue permitida solo con pago confirmado.

## 3. Organización del catálogo

- Se añaden secciones de rutinas combinadas ("Pecho y tríceps", "Pierna completa", etc.): una tabla de rutinas y su relación con ejercicios, más su vista en la biblioteca.
- Filtros rápidos por grupo muscular y equipo (ya existentes) más pestaña de rutinas.

## 4. Seguridad y antiabuso

- Una sola sesión activa por cuenta: se registra el dispositivo actual y las sesiones anteriores quedan invalidadas.
- Registro de reproducciones con IP y dispositivo para detectar cuentas compartidas.
- Se mantienen: enlaces firmados de 1–2 minutos atados al usuario, marca de agua con el ID del comprador, límites de uso por hora, sin clic derecho ni menú de descarga en la prueba.

## 5. Panel de administración

- Ventas y pagos, usuarios en prueba vs pagados, bloquear usuarios infractores, editar metadatos y rutinas del catálogo, ver auditoría de accesos sospechosos.

## 6. Puesta en marcha (necesita tu participación)

1. Conectar Telegram y registrar el webhook del bot.
2. Guardar credenciales de PayPal y la dirección pública de la app.
3. Subir los 1700+ archivos con sus datos y generar miniaturas.
4. Crear tu usuario administrador.
5. Prueba de estrés: 1000 entradas simultáneas a `/start` y 200 pagos a la vez.
6. Apertura al público.

## Detalles técnicos

- Migración: `access_plan` gana el valor `trial`; nueva tabla `trials` (user_id, started_at, expires_at) o uso de `entitlements` con `plan='trial'` y `expires_at = now() + interval '2 hours'`; nuevas tablas `routines` y `routine_exercises` con GRANTs y RLS; columna `active_session_id` en `profiles` y tabla `sessions` para sesión única. Sin borrar nada existente (el valor `view` queda en desuso).
- `current_plan()` se amplía para devolver `trial` cuando no hay pago y la prueba está vigente.
- `getMyAccess` devuelve `canView`, `canDownload`, `trialEndsAt` y `needsPayment`.
- `getPlaybackUrl` rechaza cuando no hay `canView`; `getDownloadUrl` sigue exigiendo pago.
- `bot.server.ts`: `/start` crea prueba + enlace mágico; un solo `callback_data` de pago (`pay_10`).
- PayPal: se mantiene el flujo idempotente por webhook y ruta de retorno, con un solo precio.
- Admin: rutas bajo `_authenticated/admin` protegidas por `has_role(auth.uid(),'admin')`.
