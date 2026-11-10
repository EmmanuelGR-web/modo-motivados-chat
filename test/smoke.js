'use strict';
// Prueba de humo: levanta el servidor y simula expositor + oyentes con socket.io-client.
process.env.PORT = process.env.PORT || '3999';
process.env.ADMIN_PASSWORD = 'test-pass';
process.env.ADMIN_NAMES = 'Juan Pérez, María Gómez';
delete process.env.RENDER_EXTERNAL_URL;
delete process.env.KEEPALIVE_URL;
const assert = require('assert');
const { io } = require('socket.io-client');
require('../server');

const URL = 'http://localhost:' + process.env.PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const id = (n) => (n + '0'.repeat(16)).slice(0, 16) + 'abcd';
const emitAck = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
// ingreso único: un expositor entra por 'join' con su nombre registrado + contraseña, y el panel reanuda con el token
const adminJoin = (s, name, password, cid = 'adm') => emitAck(s, 'join', { clientId: id(cid), name, avatar: 0, password });

function client() {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  s.log = { you: [], chat: [], dm: [], dmFail: [], err: [], users: null, room: null, deleted: [] };
  s.on('you:state', (v) => (s.you = v, s.log.you.push(v)));
  s.on('chat:message', (m) => s.log.chat.push(m));
  s.on('dm:message', (m) => s.log.dm.push(m));
  s.on('dm:failed', (m) => s.log.dmFail.push(m));
  s.on('chat:error', (m) => s.log.err.push(m));
  s.on('chat:deleted', (m) => s.log.deleted.push(m));
  s.on('users:list', (l) => (s.log.users = l));
  s.on('room:state', (r) => (s.log.room = r));
  s.on('admin:snapshot', (x) => (s.snap = x));
  return new Promise((res) => s.on('connect', () => res(s)));
}
const test = async (name, fn) => { await fn(); console.log('  ✔', name); };

(async () => {
  await sleep(300);
  const admin = await client();
  const ana = await client();
  const beto = await client();
  const cami = await client();
  let adminToken = null;

  await test('ingreso único: un nombre de expositor pide contraseña; incorrecta falla, correcta da rol admin', async () => {
    // sin contraseña: el servidor pide la clave (no entra como oyente)
    assert.strictEqual((await adminJoin(admin, 'Juan Pérez')).code, 'need_password');
    // sin distinguir mayúsculas ni acentos
    assert.strictEqual((await adminJoin(admin, 'juan perez')).code, 'need_password');
    assert.strictEqual((await adminJoin(admin, 'Juan Pérez', 'mala')).code, 'bad_password');
    const r = await adminJoin(admin, 'juan perez', 'test-pass');
    adminToken = r.token;
    assert.ok(r.ok && r.role === 'admin' && r.token);
    assert.strictEqual(r.name, 'Juan Pérez'); // se muestra como está registrado
    // el panel (/admin) toma el rol de expositor reanudando con ese token
    assert.strictEqual((await emitAck(admin, 'admin:resume', { token: r.token })).ok, true);
    // un oyente común nunca recibe rol admin ni pedido de contraseña
    const plain = await client();
    const p = await emitAck(plain, 'join', { clientId: id('plain'), name: 'Juan', avatar: 0, password: 'test-pass' });
    assert.ok(p.ok && !p.role && p.you.status === 'pending');
    plain.close();
    // el viejo login separado ya no existe
    const old = await new Promise((res) => { admin.emit('admin:login', { name: 'X', password: 'test-pass' }, res); setTimeout(() => res('sin respuesta'), 300); });
    assert.strictEqual(old, 'sin respuesta');
    // un oyente no puede usar comandos de admin
    ana.emit('room:start');
    await sleep(150);
    assert.strictEqual(admin.log.room.status, 'waiting');
  });

  await test('oyentes piden ingreso y quedan pendientes (aprobación activa)', async () => {
    for (const [s, n, a] of [[ana, 'Ana', 1], [beto, 'Beto', 2], [cami, 'Cami', 3]]) {
      const r = await emitAck(s, 'join', { clientId: id(n), name: n, avatar: a });
      assert.ok(r.ok); assert.strictEqual(r.you.status, 'pending');
    }
    await sleep(300);
    assert.strictEqual(admin.snap.users.filter((u) => u.status === 'pending').length, 4); // + 'Juan' de la prueba anterior
  });

  await test('nombres: repetido y reservado se rechazan', async () => {
    const dup = await client();
    assert.strictEqual((await emitAck(dup, 'join', { clientId: id('dup'), name: 'ana', avatar: 0 })).code, 'name_taken');
    assert.strictEqual((await emitAck(dup, 'join', { clientId: id('dup'), name: 'Admin', avatar: 0 })).code, 'name_reserved');
    assert.strictEqual((await emitAck(dup, 'join', { clientId: id('dup'), name: 'A', avatar: 0 })).code, 'name_short');
    dup.close();
  });

  await test('aprobar a uno, aprobar a todos', async () => {
    const uid = (n) => admin.snap.users.find((u) => u.name === n).uid;
    admin.emit('mod:approve', { uid: uid('Ana') });
    await sleep(250);
    assert.strictEqual(ana.you.status, 'active');
    assert.strictEqual(beto.you.status, 'pending');
    admin.emit('mod:approveAll');
    await sleep(250);
    assert.strictEqual(beto.you.status, 'active');
    assert.strictEqual(cami.you.status, 'active');
  });

  await test('chat cerrado hasta que el expositor inicia', async () => {
    ana.emit('chat:send', { text: 'hola?' });
    await sleep(150);
    assert.strictEqual(ana.log.err.at(-1).code, 'waiting');
    admin.emit('room:start');
    await sleep(250);
    assert.strictEqual(ana.log.room.status, 'live');
  });

  await test('mensajes públicos, stickers y validación', async () => {
    ana.emit('chat:send', { text: '  <b>hola</b>   a todos  ' });
    beto.emit('chat:send', { sticker: 'bravo' });
    beto.emit('chat:send', { sticker: 'no-existe' });
    admin.emit('chat:send', { text: 'Bienvenidos!' });
    await sleep(300);
    const texts = cami.log.chat.filter((m) => !m.system);
    assert.strictEqual(texts.length, 3);
    assert.strictEqual(texts[0].text, '<b>hola</b> a todos'); // el servidor no interpreta HTML; el cliente usa textContent
    assert.strictEqual(texts[1].sticker, 'bravo');
    assert.ok(texts[2].from.host);
  });

  await test('antispam: ráfaga de mensajes se limita', async () => {
    for (let i = 0; i < 10; i++) cami.emit('chat:send', { text: 'spam ' + i });
    await sleep(300);
    assert.ok(cami.log.err.some((e) => e.code === 'rate'));
  });

  await test('mensajes privados: llegan solo a emisor y receptor', async () => {
    const anaUid = ana.you.uid, betoUid = beto.you.uid;
    ana.emit('dm:send', { to: betoUid, text: 'psst' });
    await sleep(250);
    assert.strictEqual(beto.log.dm.length, 1);
    assert.strictEqual(ana.log.dm.length, 1); // eco al emisor
    assert.strictEqual(cami.log.dm.length, 0);
    assert.strictEqual(admin.log.dm.length, 0);
    assert.strictEqual(beto.log.dm[0].from, anaUid);
  });

  await test('bloqueo: impide DMs en ambos sentidos', async () => {
    beto.emit('block:set', { uid: ana.you.uid, blocked: true });
    await sleep(200);
    assert.ok(beto.you.blocked.includes(ana.you.uid));
    ana.emit('dm:send', { to: beto.you.uid, text: 'sigo?' });
    beto.emit('dm:send', { to: ana.you.uid, text: 'no podés' });
    await sleep(250);
    assert.strictEqual(ana.log.dmFail.at(-1).reason, 'not_receiving');
    assert.strictEqual(beto.log.dmFail.at(-1).reason, 'you_blocked');
    assert.strictEqual(beto.log.dm.length, 1);
    // desbloquear
    beto.emit('block:set', { uid: ana.you.uid, blocked: false });
    await sleep(150);
    ana.emit('dm:send', { to: beto.you.uid, text: 'ya?' });
    await sleep(200);
    assert.strictEqual(beto.log.dm.length, 2);
  });

  await test('suspender: no puede escribir (público ni privado) hasta restablecer', async () => {
    const uid = ana.you.uid;
    admin.emit('mod:suspend', { uid, minutes: 5 });
    await sleep(200);
    assert.ok(ana.you.suspendedUntil > Date.now());
    const before = cami.log.chat.length;
    ana.emit('chat:send', { text: 'no debería' });
    ana.emit('dm:send', { to: beto.you.uid, text: 'tampoco' });
    await sleep(250);
    assert.strictEqual(cami.log.chat.length, before);
    assert.strictEqual(ana.log.err.at(-1).code, 'suspended');
    assert.strictEqual(ana.log.dmFail.at(-1).reason, 'suspended');
    admin.emit('mod:restore', { uid });
    await sleep(200);
    assert.strictEqual(ana.you.suspendedUntil, 0);
    ana.emit('chat:send', { text: 'ya puedo' });
    await sleep(200);
    assert.ok(cami.log.chat.some((m) => m.text === 'ya puedo'));
  });

  await test('pausa: nadie escribe; reanudar vuelve a habilitar', async () => {
    admin.emit('room:pause');
    await sleep(200);
    beto.emit('chat:send', { text: 'en pausa' });
    await sleep(150);
    assert.strictEqual(beto.log.err.at(-1).code, 'paused');
    admin.emit('room:start');
    await sleep(200);
    assert.strictEqual(beto.log.room.status, 'live');
  });

  await test('borrar mensaje (expositor)', async () => {
    const m = cami.log.chat.find((x) => x.text === 'ya puedo');
    admin.emit('mod:delete', { id: m.id });
    await sleep(200);
    assert.ok(cami.log.deleted.some((d) => d.id === m.id));
  });

  await test('expulsar: sale de la sala, puede volver a pedir ingreso', async () => {
    admin.emit('mod:kick', { uid: cami.you.uid });
    await sleep(250);
    assert.strictEqual(cami.you.status, 'kicked');
    cami.emit('chat:send', { text: 'fuera' });
    await sleep(150);
    assert.strictEqual(cami.log.err.at(-1).code, 'not_active');
    const r = await emitAck(cami, 'join', { clientId: id('Cami'), name: 'Cami', avatar: 3 });
    assert.strictEqual(r.you.status, 'pending');
    admin.emit('mod:approve', { uid: cami.you.uid });
    await sleep(200);
    assert.strictEqual(cami.you.status, 'active');
  });

  await test('banear: no puede entrar (ni con otro nombre en el mismo navegador); restablecer lo devuelve', async () => {
    admin.emit('mod:ban', { uid: beto.you.uid });
    await sleep(250);
    assert.strictEqual(beto.you.status, 'banned');
    const r = await emitAck(beto, 'join', { clientId: id('Beto'), name: 'Otro Nombre', avatar: 2 });
    assert.strictEqual(r.you.status, 'banned');
    beto.emit('chat:send', { text: 'baneado' });
    await sleep(150);
    assert.strictEqual(beto.log.err.at(-1).code, 'not_active');
    assert.ok(admin.snap.users.some((u) => u.status === 'banned' && u.name === 'Beto'));
    // el nombre baneado queda reservado
    const evader = await client();
    assert.strictEqual((await emitAck(evader, 'join', { clientId: id('evader'), name: 'Beto', avatar: 2 })).code, 'name_taken');
    evader.close();
    admin.emit('mod:restore', { uid: beto.you.uid });
    await sleep(250);
    assert.strictEqual(beto.you.status, 'active'); // vuelve solo, sin recargar
  });

  await test('desactivar aprobación admite directo a los nuevos', async () => {
    admin.emit('room:settings', { requireApproval: false });
    await sleep(150);
    const d = await client();
    const r = await emitAck(d, 'join', { clientId: id('Dani'), name: 'Dani', avatar: 5 });
    assert.strictEqual(r.you.status, 'active');
    d.close();
  });

  await test('cortar: chat cerrado; iniciar de nuevo limpia el chat', async () => {
    admin.emit('room:end');
    await sleep(200);
    assert.strictEqual(ana.log.room.status, 'ended');
    ana.emit('chat:send', { text: 'tarde' });
    await sleep(150);
    assert.strictEqual(ana.log.err.at(-1).code, 'ended');
    // no se guarda nada: al cortar, el servidor ya no tiene el chat en memoria
    const peek = await client();
    let hist = null;
    peek.on('chat:history', (l) => (hist = l));
    await emitAck(peek, 'admin:resume', { token: adminToken });
    await sleep(200);
    assert.deepStrictEqual(hist, []);
    peek.close();
    admin.emit('room:start');
    await sleep(250);
    assert.strictEqual(ana.log.room.status, 'live');
  });

  await test('limpiar chat: borra el chat general para todos (solo expositor)', async () => {
    admin.emit('room:start');
    await sleep(150);
    ana.emit('chat:send', { text: 'mensaje antes de limpiar' });
    await sleep(200);
    // un oyente no puede limpiar
    beto.emit('mod:clear');
    await sleep(150);
    assert.ok(beto.log.chat.some((m) => m.text === 'mensaje antes de limpiar'));
    let hist = null;
    beto.once('chat:history', (l) => (hist = l));
    admin.emit('mod:clear');
    await sleep(250);
    assert.deepStrictEqual(hist, []);
    assert.ok(beto.log.chat.at(-1).system && /limpiado/.test(beto.log.chat.at(-1).text));
    // al reconectarse (otra pestaña de Beto) no vuelven los mensajes viejos
    const late = await client();
    let lateHist = null;
    late.on('chat:history', (l) => (lateHist = l));
    await emitAck(late, 'join', { clientId: id('Beto'), name: 'Beto', avatar: 2 });
    await sleep(200);
    assert.ok(lateHist && !lateHist.some((m) => m.text === 'mensaje antes de limpiar'));
    late.close();
  });

  await test('privados con el expositor: oyente → expositor y respuesta; los demás no los ven', async () => {
    // los oyentes saben que hay un expositor conectado para escribirle
    assert.ok(ana.log.room.hostsOnline >= 1);
    assert.strictEqual(ana.log.room.hostLabel, 'Expositores'); // hay 2 nombres registrados
    const adminDm = admin.log.dm.length, betoDm = beto.log.dm.length;
    ana.emit('dm:send', { to: 'host', text: 'consulta para el expositor' });
    await sleep(200);
    const got = admin.log.dm.at(-1);
    assert.strictEqual(admin.log.dm.length, adminDm + 1);
    assert.ok(got.text === 'consulta para el expositor' && got.to === 'host' && got.peer.name === 'Ana');
    assert.strictEqual(ana.log.dm.at(-1).text, 'consulta para el expositor'); // le llega su propia copia
    // el expositor responde por privado
    admin.emit('dm:send', { to: ana.you.uid, text: 'respuesta privada' });
    await sleep(200);
    const rep = ana.log.dm.at(-1);
    assert.ok(rep.text === 'respuesta privada' && rep.from === 'host' && rep.to === ana.you.uid);
    assert.strictEqual(beto.log.dm.length, betoDm); // Beto no ve nada de esto
    // stickers ilustrados nuevos (paquetes Modo Motivados y El grupo)
    ana.emit('dm:send', { to: 'host', sticker: 'gr02' });
    ana.emit('chat:send', { sticker: 'mm01' });
    await sleep(200);
    assert.strictEqual(admin.log.dm.at(-1).sticker, 'gr02');
    assert.strictEqual(beto.log.chat.at(-1).sticker, 'mm01');
    // los privados entre oyentes siguen sin llegarle al expositor
    beto.emit('dm:send', { to: cami.you.uid, text: 'solo entre oyentes' });
    await sleep(200);
    assert.ok(!admin.log.dm.some((m) => m.text === 'solo entre oyentes'));
    // un oyente no puede hacerse pasar por expositor mandando como 'host'
    const before = cami.log.dm.length;
    beto.emit('dm:send', { to: cami.you.uid, text: 'x', from: 'host' });
    await sleep(150);
    assert.ok(cami.log.dm.slice(before).every((m) => m.from === beto.you.uid));
  });

  await test('seguridad: otro sitio no puede conectarse; cabeceras de seguridad presentes', async () => {
    // conexión desde un origen ajeno (como haría una página maliciosa) → rechazada
    const evil = io(URL, { transports: ['polling'], forceNew: true, reconnection: false, extraHeaders: { Origin: 'https://sitio-malicioso.example' } });
    const res = await new Promise((r) => { evil.on('connect', () => r('conectó')); evil.on('connect_error', () => r('rechazada')); setTimeout(() => r('timeout'), 3000); });
    evil.close();
    assert.strictEqual(res, 'rechazada');
    // desde la propia página → aceptada
    const same = io(URL, { transports: ['polling'], forceNew: true, reconnection: false, extraHeaders: { Origin: URL } });
    const ok = await new Promise((r) => { same.on('connect', () => r('conectó')); same.on('connect_error', () => r('rechazada')); setTimeout(() => r('timeout'), 3000); });
    same.close();
    assert.strictEqual(ok, 'conectó');
    const h = (await fetch(URL + '/')).headers;
    assert.match(h.get('permissions-policy'), /camera=\(\)/);
    assert.match(h.get('content-security-policy'), /script-src 'self'/);
  });

  await test('QR del link: /qr.svg y /qr.png responden con imagen', async () => {
    const svg = await fetch(URL + '/qr.svg');
    assert.strictEqual(svg.status, 200);
    assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await svg.text(), /^<svg/);
    const png = await fetch(URL + '/qr.png');
    assert.strictEqual(png.status, 200);
    assert.strictEqual(png.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await png.arrayBuffer());
    assert.strictEqual(buf.slice(1, 4).toString(), 'PNG');
  });

  await test('sesión de expositor se puede reanudar con token; token falso no', async () => {
    const r = await adminJoin(admin, 'María Gómez', 'test-pass', 'adm2');
    const other = await client();
    assert.strictEqual((await emitAck(other, 'admin:resume', { token: 'falso' })).ok, false);
    assert.strictEqual((await emitAck(other, 'admin:resume', { token: r.token })).ok, true);
    // cerrar sesión invalida el token
    other.emit('admin:logout', { token: r.token });
    await sleep(100);
    assert.strictEqual((await emitAck(other, 'admin:resume', { token: r.token })).ok, false);
    other.close();
  });

  await test('bloqueo de fuerza bruta tras 5 intentos fallidos', async () => {
    const x = await client();
    for (let i = 0; i < 5; i++) await adminJoin(x, 'Juan Pérez', 'nope' + i, 'brute');
    const r = await adminJoin(x, 'Juan Pérez', 'test-pass', 'brute');
    assert.strictEqual(r.code, 'locked');
    x.close();
  });

  console.log('\nTodas las pruebas pasaron ✅');
  process.exit(0);
})().catch((e) => { console.error('\n❌ Falló:', e); process.exit(1); });
