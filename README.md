# 🎧 Modo Motivados — Chat en vivo para presentaciones

Chat en tiempo real para la presentación tipo streaming del grupo: los **oyentes** (alumnos y docentes) entran con un link, y los **expositores** manejan todo desde un panel protegido con contraseña.

- **Oyentes:** `https://TU-LINK/`
- **Expositores:** `https://TU-LINK/admin`

## Qué incluye

**Expositores (panel `/admin`)**
- Iniciar, pausar, reanudar y cortar el chat (con cronómetro).
- Aprobar o rechazar a cada oyente antes de entrar (se puede desactivar para entrada libre).
- Por oyente: **suspender** (1, 5, 10, 30 min o hasta restablecer), **expulsar**, **banear** y **restablecer**.
- Lista de solicitudes, de oyentes en sala y de baneados.
- Escribir como expositor (con insignia 👑), borrar mensajes, copiar el link o compartirlo por WhatsApp.

**Oyentes**
- Nombre + avatar estilo Kahoot (o nombre y avatar al azar con 🎲).
- Chat de sala, emojis, stickers y sonido de notificación estilo Messenger.
- **Mensajes privados** en pestañas dentro del mismo chat. Solo los ven los dos participantes (los expositores no los reciben).
- **Modo claro y oscuro** con botón ☀️/🌙: arranca según el sistema del usuario y recuerda su elección.
- **Silenciar** los mensajes de alguien en la sala, **bloquear** (no recibir ni enviar privados) y apagar el sonido.

## Probarlo en tu compu

```bash
npm install
ADMIN_PASSWORD="la-clave-del-grupo" npm start
```

En Windows (PowerShell): `$env:ADMIN_PASSWORD="la-clave-del-grupo"; npm start`

Abrí `http://localhost:3000` (oyentes) y `http://localhost:3000/admin` (expositores).

Para probar con el celular en la misma red WiFi, usá la IP de tu compu: `http://192.168.x.x:3000`.

## Publicarlo gratis y obtener el link (Render)

> Vercel y Netlify **no sirven** para esto: este chat necesita un servidor que mantenga conexiones WebSocket abiertas.

1. Subí esta carpeta a un repositorio de GitHub.
2. En [render.com](https://render.com) → **New → Web Service** → elegí el repo. (Con el `render.yaml` incluido se completa solo; si no: Build `npm install`, Start `npm start`, plan **Free**.)
3. En **Environment** agregá `ADMIN_PASSWORD` con la contraseña de los expositores.
4. Cuando termine el deploy, Render te da el link `https://algo.onrender.com`. Ese es el link para los oyentes, y `/admin` el de los expositores.

**Importante en el plan gratis de Render:** el servicio se duerme tras ~15 min sin visitas y tarda cerca de un minuto en despertar. **Abrí el link 5 a 10 minutos antes de la presentación.** Mientras alguien tenga el chat abierto no se duerme.

### Alternativa rápida sin hosting (link temporal)

Si lo corrés desde una compu del grupo, [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) te da un link público gratis sin crear cuenta:

```bash
npm start
cloudflared tunnel --url http://localhost:3000
```

Te imprime un `https://xxxx.trycloudflare.com` para compartir. Funciona mientras la compu esté prendida y el comando abierto.

## Cómo se usa el día de la presentación

1. Entrá a `/admin` con tu nombre y la contraseña. Los demás expositores entran igual, con la misma contraseña.
2. Compartí el link de oyentes (botón **WhatsApp** o **Copiar**).
3. Los oyentes entran a una sala de espera. Aprobalos desde **Solicitudes** (o **Aceptar a todos**).
4. Tocá **Iniciar transmisión**: el chat se abre para todos.
5. Si alguien molesta: tocá **Acciones** en su fila → suspender, expulsar o banear. Los baneados se restablecen desde la pestaña **Baneados**.
6. Al terminar, **Cortar**.

## Cosas para saber

- **El estado vive en memoria**: si el servidor se reinicia, se pierden el chat y la lista de oyentes. Alcanza para un evento puntual.
- **El ban se asocia al navegador del oyente**, no a su IP (en la facultad muchos comparten la misma red). Alguien que borre los datos del navegador podría intentar entrar de nuevo con otro nombre; con la aprobación activada lo ves en Solicitudes y podés rechazarlo.
- **Los emojis son los del dispositivo** (el mismo conjunto Unicode que usa WhatsApp, pero con el diseño de cada teléfono o sistema). Los stickers son propios de esta app.
- Hay un límite anti-spam (6 mensajes cada 5 segundos) y el panel se bloquea 1 minuto tras 5 contraseñas incorrectas.
- Cambiá la contraseña por defecto (`(definida en .env)`) definiendo `ADMIN_PASSWORD`; el servidor te avisa en consola si no lo hiciste.

## Estructura

```
server.js            servidor (Express + Socket.IO): sala, roles, moderación, mensajes
public/index.html    vista de oyentes          public/app.js
public/admin.html    panel de expositores      public/admin.js
public/shared.js     avatares, emojis, stickers, sonidos, componentes
public/style.css     tema neón (colores del logo), con variables para modo claro/oscuro
public/theme.js      aplica el tema guardado antes de pintar (evita parpadeos)
public/stickers.json packs de stickers (editable)
test/smoke.js        pruebas automáticas del servidor (npm test)
```

Hecho por NeoEmaTech.
