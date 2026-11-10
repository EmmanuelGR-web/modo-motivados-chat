# 🎧 Modo Motivados — Chat en vivo

Chat en tiempo real para acompañar una presentación tipo *streaming*. Los **oyentes** (alumnos y docentes) entran desde el celular o la compu con un link, sin crear cuenta. Los **expositores** manejan la sala desde un panel propio.

---

## 📱 Manual del oyente

### Entrar a la sala
1. Abrí el link que te compartieron (o escaneá el código QR).
2. Escribí tu **nombre** y elegí un **avatar**. Si no se te ocurre nada, tocá 🎲 para que se elijan solos.
3. Tocá **Entrar al chat**.
4. Puede que un expositor tenga que **aprobar tu ingreso**: quedate en esa pantalla y vas a entrar solo apenas te acepten.
5. Si la transmisión todavía no empezó, vas a ver una sala de espera. El chat se abre solo cuando arranca.

### Qué podés hacer
| Quiero… | Cómo |
|---|---|
| Escribir en el chat | Escribí abajo y tocá ➤ |
| Mandar emojis o stickers | Tocá 😊. En **Stickers** hay tres paquetes: *Modo Motivados*, *El grupo* y *Clásicos* |
| Hablar en privado con alguien | Tocá su nombre o su avatar → **Enviar mensaje privado**. Se abre una pestaña nueva arriba del chat |
| Escribirle al expositor | Tocá 👥: el expositor aparece primero, con una 👑 |
| Dejar de ver los mensajes de alguien | Tocá su nombre → **Silenciar** (solo lo dejás de ver vos) |
| Que alguien no me escriba por privado | Tocá su nombre → **Bloquear** |
| Apagar los sonidos | Tocá 🔔 arriba |
| Cambiar entre modo claro y oscuro | Tocá ☀️ / 🌙 |
| Cambiar mi nombre o avatar | Tocá tu avatar (arriba a la derecha) |

> Los mensajes privados entre oyentes solo los ven las dos personas que hablan.

---

## 👑 Manual del expositor

### Entrar al panel
Se entra **por el mismo link que los oyentes**. No hay un botón especial: escribí tu **nombre de expositor**. Al reconocerlo, la app te pide la **contraseña** (con 👁️ podés verla mientras la escribís). Con la contraseña correcta pasás directo al panel.

> El nombre de expositor y la contraseña te los pasa el grupo. No los compartas.

### Manejar la transmisión
- **▶️ Iniciar transmisión**: abre el chat para todos. Antes de eso, los oyentes esperan en la sala de espera.
- **⏸️ Pausar** / **▶️ Reanudar**: nadie puede escribir mientras está en pausa.
- **⏹️ Cortar**: cierra el chat. Si después iniciás una nueva transmisión, el chat arranca vacío.
- El reloj muestra cuánto tiempo lleva la transmisión.

### Barra de opciones
- **📤 Compartir**: muestra un **código QR** grande para proyectar, y botones para **enviar por WhatsApp**, **compartir el QR** como imagen y **copiar el link**.
- **Pedir aprobación**: si está activado, cada oyente espera que lo aceptes. Si lo desactivás, entran todos directo.
- **🔔 Sonido del chat**: apaga o prende los sonidos de mensajes y avisos.
- **🧹 Limpiar**: borra todos los mensajes del chat general (pide confirmación).
- **✏️ Título**: cambia el nombre de la sala.
- **🚪**: cerrar sesión.

### Oyentes
En **Oyentes** (abajo, en el celular) hay tres pestañas: **En sala**, **Solicitudes** y **Baneados**. Tocá a cualquier persona para:
- **💬 Enviarle un mensaje privado**
- **🔇 Suspenderla** por un rato (1, 5, 10 o 30 minutos, o hasta que la restablezcas): no puede escribir.
- **🚪 Expulsarla**: sale de la sala, pero puede volver a pedir ingreso.
- **⛔ Banearla**: no puede volver a entrar hasta que la **restablezcas** desde *Baneados*.

En el chat podés **borrar** cualquier mensaje con 🗑. Los privados que te mandan los oyentes aparecen como pestañas arriba del chat, al lado de **🌐 Sala**.

### Checklist para el día de la presentación
1. Abrí el link **unos minutos antes** (si estuvo un rato sin uso, puede tardar alrededor de un minuto en cargar la primera vez).
2. Entrá al panel con tu nombre de expositor.
3. Tocá **📤 Compartir** y proyectá el QR.
4. Aceptá a los que van llegando (o desactivá *Pedir aprobación*).
5. Cuando empiece la exposición: **Iniciar transmisión**. Al terminar: **Cortar**.
6. No publiques cambios del proyecto durante la presentación: al reiniciarse el servidor se borra el chat.

---

## ❓ Preguntas frecuentes

**¿Se guardan los mensajes?** No. No hay base de datos: el chat de la sala existe solo mientras dura la transmisión y **se borra al tocar Cortar**. Los mensajes privados ni siquiera pasan por una memoria: el servidor los entrega y los descarta.

**¿Es seguro?** Todo viaja cifrado (https), lo que escribe la gente siempre se muestra como texto (no se puede inyectar código), la sesión del expositor se cierra al cerrar la pestaña y solo esta página puede conectarse al chat.

**Alguien baneado, ¿puede volver?** El ban queda asociado a su navegador. Si borra los datos del navegador podría intentar entrar con otro nombre; con *Pedir aprobación* activado lo vas a ver en *Solicitudes*.

**¿Por qué los emojis se ven distinto en cada celular?** Son los emojis propios de cada teléfono (el mismo estándar que usa WhatsApp, con el dibujo de cada marca).

---

## 🛠️ Tecnología

- **Servidor:** Node.js con Express y Socket.IO (mensajes en tiempo real por WebSockets).
- **Interfaz:** HTML, CSS y JavaScript, sin frameworks. Diseño responsive con modo claro y oscuro.
- **Código QR:** generado en el servidor con la librería `qrcode`.
- **Sonidos:** generados con Web Audio (sin archivos de audio).
- **Configuración:** variables de entorno cargadas desde un archivo `.env` (librería `dotenv`).
- **Publicación:** Render (necesita un servidor que mantenga conexiones abiertas; Vercel o Netlify no sirven para esto).

## 📁 Estructura

```
server.js              Servidor: sala, ingreso, moderación, mensajes y privados
public/
  index.html, app.js   Ingreso único y vista del oyente
  admin.html, admin.js Panel del expositor
  shared.js            Partes comunes: avatares, emojis, stickers, sonidos, ventanas
  style.css, theme.js  Estilos y modo claro/oscuro
  stickers.json        Lista de stickers por paquete
  stickers/            Imágenes de los stickers
  brand/               Logos del pie de página
  logo.png             Logo de Modo Motivados
test/smoke.js          Pruebas automáticas
.env.example           Modelo de configuración (sin datos reales)
render.yaml            Configuración para publicar en Render
```

## ⚙️ Configuración

Los datos sensibles (contraseña y nombres de expositores) **nunca van en el código ni en este repositorio**:

- **En la compu:** copiá `.env.example` como `.env` y completalo. El archivo `.env` no se sube a GitHub.
- **En Render:** se cargan en *Environment* (`ADMIN_PASSWORD` y `ADMIN_NAMES`).

Para probarlo en la compu: `npm install` y después `npm start`, y abrí `http://localhost:3000`. Las pruebas se corren con `npm test`.

---

© 2026 NeoEmaTech & EBTech - Todos los derechos reservados
