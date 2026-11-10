# 🎧 Modo Motivados — Chat en vivo para presentaciones

Chat en tiempo real para la presentación tipo streaming del grupo: los **oyentes** (alumnos y docentes) entran con un link, y los **expositores** manejan todo desde un panel protegido con contraseña.

**Un solo link y un solo ingreso para todos:** `https://TU-LINK/`. No hay ningún botón de "soy expositor". Cuando alguien escribe uno de los nombres de expositor registrados (`ADMIN_NAMES`), recién ahí aparece el campo de contraseña; con la contraseña correcta entra directo al panel. Cualquier otro nombre entra como oyente.

## Qué incluye

**Expositores (panel)**
- Iniciar, pausar, reanudar y cortar el chat (con cronómetro).
- Aprobar o rechazar a cada oyente antes de entrar (se puede desactivar para entrada libre).
- Por oyente: **suspender** (1, 5, 10, 30 min o hasta restablecer), **expulsar**, **banear** y **restablecer**.
- Lista de solicitudes, de oyentes en sala y de baneados.
- Escribir como expositor (con insignia 👑), borrar mensajes sueltos o **limpiar todo el chat general**.
- **Mensajes privados con los oyentes:** cada oyente que te escribe aparece en una pestaña del chat; también podés escribirle desde sus acciones.
- **📤 Compartir:** código QR del link (para proyectarlo o mandarlo como imagen), enviar por WhatsApp y copiar link.
- Interruptor de **sonido del chat** (mensajes y avisos de solicitudes).

**Oyentes**
- Nombre + avatar estilo Kahoot (o nombre y avatar al azar con 🎲).
- Chat de sala, emojis, stickers y sonido de notificación estilo Messenger.
- **Mensajes privados** en pestañas dentro del mismo chat. Entre oyentes solo los ven los dos participantes (los expositores no los reciben).
- **Escribirle al expositor por privado:** aparece primero (👑) en la lista de personas.
- **Stickers propios del grupo** en tres paquetes: Modo Motivados, El grupo y Clásicos.
- **Modo claro y oscuro** con botón ☀️/🌙: arranca según el sistema del usuario y recuerda su elección.
- **Silenciar** los mensajes de alguien en la sala, **bloquear** (no recibir ni enviar privados) y apagar el sonido.

## Probarlo en tu compu

```bash
npm install
ADMIN_PASSWORD="la-clave-del-grupo" ADMIN_NAMES="Juan Pérez, María Gómez" npm start
```

En Windows (PowerShell): `$env:ADMIN_PASSWORD="la-clave-del-grupo"; $env:ADMIN_NAMES="Juan Pérez, María Gómez"; npm start`

Abrí `http://localhost:3000`. Para entrar como expositor escribí uno de los nombres de `ADMIN_NAMES` (no importan mayúsculas ni acentos) y la contraseña.

Para probar con el celular en la misma red WiFi, usá la IP de tu compu: `http://192.168.x.x:3000`.

## Publicarlo gratis y obtener el link (Render)

> Vercel y Netlify **no sirven** para esto: este chat necesita un servidor que mantenga conexiones WebSocket abiertas.

1. Subí esta carpeta a un repositorio de GitHub.
2. En [render.com](https://render.com) → **New → Web Service** → elegí el repo. (Con el `render.yaml` incluido se completa solo; si no: Build `npm install`, Start `npm start`, plan **Free**.)
3. En **Environment** agregá:
   - `ADMIN_PASSWORD`: la contraseña de los expositores.
   - `ADMIN_NAMES`: los nombres de los expositores separados por coma, ej. `Juan Pérez, María Gómez`.
4. Cuando termine el deploy, Render te da el link `https://algo.onrender.com`. Ese es el único link: lo usan oyentes y expositores.

### Que no se duerma (keep-alive)

El plan gratis de Render apaga el servicio tras ~15 min sin visitas. Para evitarlo hay dos capas:

1. **Auto-ping incluido:** en Render el servidor se pide a sí mismo `/health` cada 10 minutos usando su URL pública (`RENDER_EXTERNAL_URL`, que Render define solo). No hay que configurar nada.
2. **Respaldo externo (recomendado):** un cron gratuito en [cron-job.org](https://cron-job.org) que pida `https://TU-LINK/health` cada 10 minutos. Si por algún motivo el servidor se reinicia y queda dormido, este lo despierta.

El plan gratis da 750 horas por mes por cuenta: alcanza para tener **un** servicio prendido todo el mes.

### Alternativa rápida sin hosting (link temporal)

Si lo corrés desde una compu del grupo, [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) te da un link público gratis sin crear cuenta:

```bash
npm start
cloudflared tunnel --url http://localhost:3000
```

Te imprime un `https://xxxx.trycloudflare.com` para compartir. Funciona mientras la compu esté prendida y el comando abierto.

## Cómo se usa el día de la presentación

1. Entrá al link, escribí tu nombre de expositor (el registrado en `ADMIN_NAMES`) y la contraseña. Los demás expositores entran igual, cada uno con su nombre y la misma contraseña. Para salir del panel, botón 🚪.
2. Tocá **📤 Compartir**: proyectá el QR para que lo escaneen, o mandá el link por WhatsApp.
3. Los oyentes entran a una sala de espera. Aprobalos desde **Solicitudes** (o **Aceptar a todos**).
4. Tocá **Iniciar transmisión**: el chat se abre para todos.
5. Si alguien molesta: tocá **Acciones** en su fila → suspender, expulsar o banear. Los baneados se restablecen desde la pestaña **Baneados**.
6. Al terminar, **Cortar**.

## Cosas para saber

- **El estado vive en memoria**: si el servidor se reinicia, se pierden el chat y la lista de oyentes. Alcanza para un evento puntual.
- **El ban se asocia al navegador del oyente**, no a su IP (en la facultad muchos comparten la misma red). Alguien que borre los datos del navegador podría intentar entrar de nuevo con otro nombre; con la aprobación activada lo ves en Solicitudes y podés rechazarlo.
- **Los emojis son los del dispositivo** (el mismo conjunto Unicode que usa WhatsApp, pero con el diseño de cada teléfono o sistema). Los stickers son propios de esta app.
- Hay un límite anti-spam (6 mensajes cada 5 segundos) y el ingreso de expositores se bloquea 1 minuto tras 5 contraseñas incorrectas.
- Cambiá la contraseña por defecto (`(definida en .env)`) definiendo `ADMIN_PASSWORD`, y definí `ADMIN_NAMES` (si no, el único expositor es el de ejemplo, "Juan Pérez"). El servidor avisa en consola si falta alguna.
- Alguien que escriba el nombre de un expositor va a ver que se pide contraseña, pero sin ella no puede entrar. Entrar a `/admin` sin sesión lleva al ingreso.

## Estructura

```
server.js            servidor (Express + Socket.IO): sala, roles, moderación, mensajes
public/index.html    ingreso único + vista de oyentes   public/app.js
public/admin.html    panel de expositores (con sesión)  public/admin.js
public/shared.js     avatares, emojis, stickers, sonidos, componentes
public/style.css     tema neón (colores del logo), con variables para modo claro/oscuro
public/theme.js      aplica el tema guardado antes de pintar (evita parpadeos)
public/stickers.json lista de stickers por paquete (editable)
public/stickers/     imágenes WebP de los stickers ilustrados
test/smoke.js        pruebas automáticas del servidor (npm test)
```

Hecho por NeoEmaTech.
