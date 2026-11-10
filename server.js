'use strict';

/**
 * Modo Motivados — chat en vivo para presentaciones tipo streaming.
 * Node + Express + Socket.IO. Estado en memoria (una sala por servidor).
 *
 * Variables de entorno:
 *   PORT              puerto (lo define el hosting)
 *   ADMIN_PASSWORD    contraseña de los expositores
 *   ADMIN_NAMES       nombres de los expositores separados por coma (ej: "Juan Pérez, María Gómez").
 *                     Hay un solo ingreso para todos: si alguien escribe uno de estos nombres,
 *                     se le pide la contraseña y entra como expositor.
 *   EVENT_TITLE       título inicial de la sala
 *   KEEPALIVE_URL     URL pública para auto-ping (en Render se usa RENDER_EXTERNAL_URL solo)
 */

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DEFAULT_PASSWORD = '(definida en .env)';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
const DEFAULT_ADMIN_NAMES = 'Juan Pérez';
const ADMIN_NAMES_RAW = process.env.ADMIN_NAMES || DEFAULT_ADMIN_NAMES;
const AVATAR_COUNT = 16;
const MAX_MESSAGES = 500;
const STICKERS = require('./public/stickers.json');
const STICKER_IDS = new Set(STICKERS.map((s) => s.id));

/* ---------------------------------------------------------------- HTTP */

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'"
  );
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/health', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });

/* --------------------------------------------------------------- Estado */

const room = {
  status: 'waiting', // waiting | live | paused | ended
  title: (process.env.EVENT_TITLE || 'Modo Motivados').slice(0, 60),
  requireApproval: true,
  startedAt: null,
  endedAt: null,
};

/** clientId (secreto) -> usuario */
const users = new Map();
/** uid (público) -> usuario */
const byUid = new Map();
/** token admin -> { name, hostId, at } */
const adminTokens = new Map();
let messages = [];
let msgSeq = 0;

/* ------------------------------------------------------------- Helpers */

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const checkPassword = (p) => crypto.timingSafeEqual(sha(p), sha(ADMIN_PASSWORD));

// quita caracteres de control y de dirección (RTL override), conserva ZWJ de los emojis
const CTRL = /[\u0000-\u001f\u007f-\u009f​‌‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;

function cleanName(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(CTRL, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 20);
}
function cleanText(s, max = 500) {
  return String(s || '').replace(/\s+/g, ' ').replace(CTRL, '').trim().slice(0, max);
}
const normName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const RESERVED = /(expositor|admin|moderador|sistema|host)/;

/** nombre normalizado -> nombre tal como se escribió en ADMIN_NAMES */
const ADMIN_NAMES = new Map();
for (const raw of ADMIN_NAMES_RAW.split(',')) {
  const n = cleanName(raw);
  if (n.length >= 2) ADMIN_NAMES.set(normName(n), n);
}
const adminNameOf = (name) => ADMIN_NAMES.get(normName(name)) || null;

function allow(u, key, max, windowMs) {
  const now = Date.now();
  u.rl = u.rl || {};
  const arr = (u.rl[key] || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    u.rl[key] = arr;
    return false;
  }
  arr.push(now);
  u.rl[key] = arr;
  return true;
}

const isSuspended = (u) => u.suspendedUntil === -1 || u.suspendedUntil > Date.now();
const pub = (u) => ({ uid: u.uid, name: u.name, avatar: u.avatar });
const isOnline = (u) => u.socketIds.size > 0;

function nameTaken(name, clientId) {
  const n = normName(name);
  const now = Date.now();
  for (const v of users.values()) {
    if (v.clientId === clientId || normName(v.name) !== n) continue;
    if (v.status === 'banned') return true;
    if ((v.status === 'active' || v.status === 'pending') && (isOnline(v) || now - v.lastSeen < 15 * 60e3)) return true;
  }
  return false;
}

function emitToUser(u, ev, payload) {
  for (const sid of u.socketIds) io.to(sid).emit(ev, payload);
}

function syncRooms(u) {
  for (const sid of u.socketIds) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    if (u.status === 'active') s.join('active');
    else s.leave('active');
  }
}

function youState(u) {
  return {
    uid: u.uid,
    name: u.name,
    avatar: u.avatar,
    status: u.status, // pending | active | kicked | banned
    reason: u.reason || null,
    suspendedUntil: isSuspended(u) ? u.suspendedUntil : 0,
    blocked: [...u.blocks],
  };
}
const sendYou = (u) => emitToUser(u, 'you:state', youState(u));

function sendHistory(u) {
  emitToUser(u, 'chat:history', messages.slice(-150));
}

function roomState() {
  let online = 0;
  for (const u of users.values()) if (u.status === 'active' && isOnline(u)) online++;
  return {
    status: room.status,
    title: room.title,
    requireApproval: room.requireApproval,
    startedAt: room.startedAt,
    endedAt: room.endedAt,
    online,
    now: Date.now(),
  };
}

function adminSnapshot() {
  const list = [];
  for (const u of users.values()) {
    if (u.status === 'kicked') continue;
    list.push({
      uid: u.uid,
      name: u.name,
      avatar: u.avatar,
      status: u.status,
      online: isOnline(u),
      suspendedUntil: isSuspended(u) ? u.suspendedUntil : 0,
      joinedAt: u.joinedAt,
    });
  }
  return { room: roomState(), users: list };
}

let bTimer = null;
function scheduleBroadcast() {
  if (bTimer) return;
  bTimer = setTimeout(() => {
    bTimer = null;
    io.emit('room:state', roomState());
    const list = [];
    for (const u of users.values()) if (u.status === 'active' && isOnline(u)) list.push(pub(u));
    io.to('active').emit('users:list', list);
    io.to('admins').emit('admin:snapshot', adminSnapshot());
  }, 120);
}

function pushMessage(m) {
  m.id = ++msgSeq;
  m.ts = Date.now();
  messages.push(m);
  if (messages.length > MAX_MESSAGES) messages.shift();
  io.to('active').to('admins').emit('chat:message', m);
  return m;
}

function buildContent(data) {
  data = data || {};
  if (data.sticker) {
    const id = String(data.sticker);
    return STICKER_IDS.has(id) ? { sticker: id } : null;
  }
  const text = cleanText(data.text);
  return text ? { text } : null;
}

function setStatus(u, status, reason) {
  u.status = status;
  u.reason = reason || null;
  if (status !== 'active') u.suspendedUntil = 0;
  syncRooms(u);
  sendYou(u);
  if (status === 'active') sendHistory(u);
  scheduleBroadcast();
}

const ipOf = (socket) =>
  String(socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim() || socket.handshake.address;

/* 5 contraseñas erróneas desde la misma IP ⇒ bloqueo de 1 minuto */
const loginFails = new Map();
function passwordFails(socket) {
  const f = loginFails.get(ipOf(socket));
  if (f && f.until > Date.now()) return { ok: false, code: 'locked', retry: Math.ceil((f.until - Date.now()) / 1000) };
  return null;
}
function registerFail(socket) {
  const ip = ipOf(socket);
  const f = loginFails.get(ip) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) {
    f.count = 0;
    f.until = Date.now() + 60e3;
  }
  loginFails.set(ip, f);
  return { ok: false, code: 'bad_password' };
}

/* ------------------------------------------------------------- Sockets */

io.on('connection', (socket) => {
  socket.data = { role: null, clientId: null };
  socket.emit('room:state', roomState());

  const me = () => (socket.data.role === 'listener' ? users.get(socket.data.clientId) : null);

  /* ---------- Oyentes ---------- */

  function attach(u) {
    socket.data.role = 'listener';
    socket.data.clientId = u.clientId;
    u.socketIds.add(socket.id);
    u.lastSeen = Date.now();
    syncRooms(u);
    if (u.status === 'active') socket.emit('chat:history', messages.slice(-150));
    scheduleBroadcast();
  }

  socket.on('join', (data, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    try {
      data = data || {};
      const clientId = String(data.clientId || '');
      if (!/^[A-Za-z0-9-]{16,64}$/.test(clientId)) return cb({ ok: false, code: 'bad_client' });

      // ¿Es un expositor? Un solo ingreso para todos: el rol se detecta por el nombre registrado.
      const adminName = adminNameOf(cleanName(data.name));
      if (adminName) {
        if (!data.password) return cb({ ok: false, code: 'need_password' });
        const fail = passwordFails(socket);
        if (fail) return cb(fail);
        if (!checkPassword(String(data.password))) return cb(registerFail(socket));
        loginFails.delete(ipOf(socket));
        const token = crypto.randomBytes(24).toString('hex');
        adminTokens.set(token, { name: adminName, hostId: token.slice(0, 6), at: Date.now() });
        return cb({ ok: true, role: 'admin', token, name: adminName });
      }

      let u = users.get(clientId);
      if (u && u.status === 'banned') {
        attach(u);
        return cb({ ok: true, you: youState(u) });
      }

      const name = cleanName(data.name);
      const avatar = Number.isInteger(data.avatar) && data.avatar >= 0 && data.avatar < AVATAR_COUNT ? data.avatar : 0;
      if (name.length < 2) return cb({ ok: false, code: 'name_short' });
      if (RESERVED.test(normName(name))) return cb({ ok: false, code: 'name_reserved' });
      if (nameTaken(name, clientId)) return cb({ ok: false, code: 'name_taken' });

      if (!u) {
        u = {
          clientId,
          uid: crypto.randomBytes(5).toString('hex'),
          name,
          avatar,
          status: 'kicked',
          reason: null,
          suspendedUntil: 0,
          blocks: new Set(),
          socketIds: new Set(),
          joinedAt: Date.now(),
          lastSeen: Date.now(),
        };
        users.set(clientId, u);
        byUid.set(u.uid, u);
      } else {
        u.name = name;
        u.avatar = avatar;
      }

      if (u.status === 'kicked') {
        u.status = room.requireApproval ? 'pending' : 'active';
        u.reason = null;
        u.joinedAt = Date.now();
      }

      attach(u);
      sendYou(u);
      cb({ ok: true, you: youState(u) });
    } catch (e) {
      console.error('join', e);
      cb({ ok: false, code: 'error' });
    }
  });

  socket.on('chat:send', (data) => {
    const content = buildContent(data);
    if (!content) return;

    if (socket.data.role === 'admin') {
      if (room.status !== 'live' && room.status !== 'paused') return socket.emit('chat:error', { code: 'closed' });
      return void pushMessage({
        from: { uid: 'h-' + socket.data.hostId, name: socket.data.adminName, avatar: 'host', host: true },
        ...content,
      });
    }

    const u = me();
    if (!u || u.status !== 'active') return socket.emit('chat:error', { code: 'not_active' });
    if (room.status !== 'live') return socket.emit('chat:error', { code: room.status });
    if (isSuspended(u)) return socket.emit('chat:error', { code: 'suspended' });
    if (!allow(u, 'chat', 6, 5000)) return socket.emit('chat:error', { code: 'rate' });
    pushMessage({ from: pub(u), ...content });
  });

  socket.on('dm:send', (data) => {
    const u = me();
    data = data || {};
    if (!u || u.status !== 'active') return;
    const content = buildContent(data);
    const target = byUid.get(String(data.to || ''));
    if (!content || !target || target === u) return;
    const fail = (reason) => socket.emit('dm:failed', { to: target.uid, reason });

    if (room.status !== 'live') return fail(room.status);
    if (isSuspended(u)) return fail('suspended');
    if (!allow(u, 'dm', 8, 5000)) return fail('rate');
    if (target.status !== 'active' || !isOnline(target)) return fail('offline');
    if (u.blocks.has(target.uid)) return fail('you_blocked');
    if (target.blocks.has(u.uid)) return fail('not_receiving');

    const m = { id: ++msgSeq, ts: Date.now(), from: u.uid, to: target.uid, ...content };
    emitToUser(u, 'dm:message', m);
    emitToUser(target, 'dm:message', m);
  });

  socket.on('block:set', (data) => {
    const u = me();
    data = data || {};
    const t = byUid.get(String(data.uid || ''));
    if (!u || !t || t === u) return;
    if (data.blocked) u.blocks.add(t.uid);
    else u.blocks.delete(t.uid);
    sendYou(u);
  });

  /* ---------- Expositores ---------- */

  function becomeAdmin(token, info, cb) {
    socket.data.role = 'admin';
    socket.data.adminName = info.name;
    socket.data.hostId = info.hostId;
    socket.join('admins');
    cb({ ok: true, token, name: info.name });
    socket.emit('room:state', roomState());
    socket.emit('admin:snapshot', adminSnapshot());
    socket.emit('chat:history', messages.slice(-200));
  }

  // El ingreso de expositores se hace por 'join' (ver arriba); el panel /admin entra con el token.
  socket.on('admin:resume', (data, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    const token = String((data && data.token) || '');
    const info = adminTokens.get(token);
    if (!info) return cb({ ok: false });
    becomeAdmin(token, info, cb);
  });

  socket.on('admin:logout', (data) => {
    const token = String((data && data.token) || '');
    if (token && adminTokens.has(token)) adminTokens.delete(token);
    if (socket.data.role === 'admin') {
      socket.data.role = null;
      socket.leave('admins');
    }
  });

  const onAdmin = (ev, fn) =>
    socket.on(ev, (data) => {
      if (socket.data.role !== 'admin') return;
      try {
        fn(data || {});
      } catch (e) {
        console.error(ev, e);
      }
    });
  const target = (d) => byUid.get(String(d.uid || ''));

  onAdmin('room:start', () => {
    if (room.status === 'live') return;
    const prev = room.status;
    if (prev === 'ended') {
      messages = [];
      io.to('active').to('admins').emit('chat:history', []);
    }
    room.status = 'live';
    if (prev !== 'paused') room.startedAt = Date.now();
    room.endedAt = null;
    pushMessage({ system: true, text: prev === 'paused' ? '▶️ El chat se reanudó' : '🔴 ¡Arrancó la transmisión!' });
    scheduleBroadcast();
  });
  onAdmin('room:pause', () => {
    if (room.status !== 'live') return;
    room.status = 'paused';
    pushMessage({ system: true, text: '⏸️ Chat en pausa' });
    scheduleBroadcast();
  });
  onAdmin('room:end', () => {
    if (room.status !== 'live' && room.status !== 'paused') return;
    room.status = 'ended';
    room.endedAt = Date.now();
    pushMessage({ system: true, text: '⏹️ La transmisión finalizó. ¡Gracias por participar!' });
    scheduleBroadcast();
  });
  onAdmin('room:settings', (d) => {
    if (typeof d.title === 'string') {
      const t = cleanText(d.title, 60);
      if (t) room.title = t;
    }
    if (typeof d.requireApproval === 'boolean') {
      const was = room.requireApproval;
      room.requireApproval = d.requireApproval;
      if (was && !d.requireApproval) {
        for (const u of users.values()) if (u.status === 'pending') setStatus(u, 'active');
      }
    }
    scheduleBroadcast();
  });

  onAdmin('mod:approve', (d) => {
    const u = target(d);
    if (u && u.status === 'pending') setStatus(u, 'active');
  });
  onAdmin('mod:approveAll', () => {
    for (const u of users.values()) if (u.status === 'pending') setStatus(u, 'active');
  });
  onAdmin('mod:reject', (d) => {
    const u = target(d);
    if (u && u.status === 'pending') setStatus(u, 'kicked', 'rejected');
  });
  onAdmin('mod:kick', (d) => {
    const u = target(d);
    if (u && (u.status === 'active' || u.status === 'pending')) setStatus(u, 'kicked', 'kicked');
  });
  onAdmin('mod:ban', (d) => {
    const u = target(d);
    if (u && u.status !== 'banned') setStatus(u, 'banned');
  });
  onAdmin('mod:suspend', (d) => {
    const u = target(d);
    if (!u || u.status !== 'active') return;
    const min = Number(d.minutes);
    u.suspendedUntil = min > 0 && min <= 720 ? Date.now() + min * 60e3 : -1; // -1 = hasta restablecer
    sendYou(u);
    scheduleBroadcast();
  });
  onAdmin('mod:restore', (d) => {
    const u = target(d);
    if (!u) return;
    if (u.status === 'banned') setStatus(u, 'active');
    else if (u.suspendedUntil) {
      u.suspendedUntil = 0;
      sendYou(u);
      scheduleBroadcast();
    }
  });
  onAdmin('mod:delete', (d) => {
    const id = Number(d.id);
    const i = messages.findIndex((m) => m.id === id);
    if (i === -1) return;
    messages.splice(i, 1);
    io.to('active').to('admins').emit('chat:deleted', { id });
  });

  socket.on('disconnect', () => {
    const u = me();
    if (u) {
      u.socketIds.delete(socket.id);
      u.lastSeen = Date.now();
      scheduleBroadcast();
    }
  });
});

/* ------------------------------------------------------ Mantenimiento */

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const u of users.values()) {
    if (u.suspendedUntil > 0 && u.suspendedUntil <= now) {
      u.suspendedUntil = 0;
      sendYou(u);
      changed = true;
    }
    if (u.status === 'pending' && !isOnline(u) && now - u.lastSeen > 120e3) {
      u.status = 'kicked';
      changed = true;
    }
  }
  for (const [t, info] of adminTokens) if (now - info.at > 24 * 3600e3) adminTokens.delete(t);
  if (changed) scheduleBroadcast();
}, 5000).unref();

/* ---------------------------------------------------------- Keep-alive
 * El plan gratis de Render apaga el servicio tras ~15 min sin tráfico entrante.
 * Cada 10 minutos el servidor se pide a sí mismo /health por su URL pública: ese pedido
 * entra por el balanceador de Render y cuenta como visita, así nunca llega a dormirse.
 * Render define RENDER_EXTERNAL_URL solo; en otro hosting se puede usar KEEPALIVE_URL.
 */
const KEEPALIVE_URL = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
if (KEEPALIVE_URL && typeof fetch === 'function') {
  setInterval(() => {
    fetch(KEEPALIVE_URL + '/health', { signal: AbortSignal.timeout(20e3) })
      .then((r) => { if (!r.ok) console.warn('keep-alive: respuesta', r.status); })
      .catch((e) => console.warn('keep-alive falló:', e.message));
  }, 10 * 60e3).unref();
}

server.listen(PORT, () => {
  console.log(`\n  🎧  Modo Motivados corriendo en el puerto ${PORT}`);
  console.log(`      Ingreso (oyentes y expositores): http://localhost:${PORT}/`);
  console.log(`      Expositores registrados: ${[...ADMIN_NAMES.values()].join(', ')}`);
  if (KEEPALIVE_URL) console.log(`      Keep-alive activo: ${KEEPALIVE_URL}/health cada 10 min`);
  if (ADMIN_PASSWORD === DEFAULT_PASSWORD) {
    console.log('\n  ⚠️  Estás usando la contraseña por defecto. Definí ADMIN_PASSWORD antes de publicar.');
  }
  if (!process.env.ADMIN_NAMES) {
    console.log(`  ⚠️  ADMIN_NAMES no está definida: se usa el ejemplo "${DEFAULT_ADMIN_NAMES}".`);
  }
  console.log('');
});

module.exports = { server, io };
