/* Panel de expositores */
(function () {
  'use strict';

  const h = MM.h;
  const $ = (s) => document.querySelector(s);
  const prefs = MM.prefs.load();

  const A = {
    socket: io(),
    token: null,
    name: '',
    hostUid: null,
    room: { status: 'waiting', title: 'Modo Motivados', requireApproval: true, online: 0 },
    clockOffset: 0,
    users: [],
    messages: [],
    tab: 'active',
    search: '',
    pendingCount: 0,
    ready: false,
  };
  try { A.token = localStorage.getItem('mm_admin_token'); } catch (e) { /* ignore */ }

  const msgsEl = $('#msgs');
  const input = $('#input');
  const byUid = () => new Map(A.users.map((u) => [u.uid, u]));

  /* ---------------------------------------------------------------- Login */

  function showLogin(msg) {
    $('#screen-login').classList.remove('hidden');
    $('#admin').classList.add('hidden');
    $('#login-error').textContent = msg || '';
    A.ready = false;
  }
  function showPanel() {
    $('#screen-login').classList.add('hidden');
    $('#admin').classList.remove('hidden');
    A.ready = true;
    showMobilePanel(A.mobilePanel || 'panel-chat');
  }

  function onAuth(res, fromLogin) {
    if (!res || !res.ok) {
      try { localStorage.removeItem('mm_admin_token'); } catch (e) { /* ignore */ }
      A.token = null;
      const msg = !fromLogin ? '' :
        res && res.code === 'locked' ? 'Demasiados intentos. Esperá ' + res.retry + ' segundos.' : 'Contraseña incorrecta.';
      return showLogin(msg);
    }
    A.token = res.token;
    A.name = res.name;
    A.hostUid = 'h-' + res.token.slice(0, 6);
    try { localStorage.setItem('mm_admin_token', res.token); localStorage.setItem('mm_admin_name', res.name); } catch (e) { /* ignore */ }
    showPanel();
  }

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    MM.sound.unlock();
    const password = $('#a-pass').value;
    if (!password) return ($('#login-error').textContent = 'Escribí la contraseña.');
    A.socket.emit('admin:login', { name: $('#a-name').value, password }, (res) => {
      $('#a-pass').value = '';
      onAuth(res, true);
    });
  });
  try { $('#a-name').value = localStorage.getItem('mm_admin_name') || ''; } catch (e) { /* ignore */ }

  A.socket.on('connect', () => {
    if (A.token) A.socket.emit('admin:resume', { token: A.token }, (res) => onAuth(res, false));
    else showLogin();
  });

  /* ------------------------------------------------------------- Controles */

  const STATUS_TXT = { live: 'En vivo', paused: 'En pausa', waiting: 'En espera', ended: 'Finalizado' };

  function renderControls() {
    const st = A.room.status;
    const ctrl = $('#ctrl');
    ctrl.replaceChildren();
    const emit = (ev) => () => A.socket.emit(ev);
    if (st === 'waiting' || st === 'ended')
      ctrl.append(h('button', { class: 'btn btn-primary', type: 'button', text: st === 'ended' ? '▶️ Iniciar nueva transmisión' : '▶️ Iniciar transmisión', onclick: emit('room:start') }));
    if (st === 'live') ctrl.append(h('button', { class: 'btn btn-pink', type: 'button', text: '⏸️ Pausar chat', onclick: emit('room:pause') }));
    if (st === 'paused') ctrl.append(h('button', { class: 'btn btn-primary', type: 'button', text: '▶️ Reanudar', onclick: emit('room:start') }));
    if (st === 'live' || st === 'paused')
      ctrl.append(
        h('button', {
          class: 'btn btn-danger', type: 'button', text: '⏹️ Cortar',
          onclick: async () => {
            if (await MM.confirm('¿Cortar la transmisión?', 'El chat se cierra para todos los oyentes. Después podés iniciar una nueva (se borra el chat).', 'Sí, cortar')) A.socket.emit('room:end');
          },
        })
      );
  }

  function renderTop() {
    $('#a-title').textContent = A.room.title;
    const p = $('#a-pill');
    p.className = 'pill ' + A.room.status;
    p.textContent = STATUS_TXT[A.room.status] || '';
    $('#a-online').textContent = ' · ' + (A.room.online || 0) + ' oyentes conectados';
    $('#a-approval').checked = !!A.room.requireApproval;
    $('#a-sound').textContent = prefs.sound ? '🔔' : '🔕';
    $('#a-sound').classList.toggle('off', !prefs.sound);
    renderControls();
    tickTimer();
  }

  function tickTimer() {
    const t = $('#a-timer');
    const r = A.room;
    if ((r.status === 'live' || r.status === 'paused') && r.startedAt) {
      t.classList.remove('hidden');
      t.textContent = MM.fmtDuration(Date.now() + A.clockOffset - r.startedAt);
    } else t.classList.add('hidden');
  }
  setInterval(tickTimer, 1000);

  $('#a-approval').addEventListener('change', (e) => {
    A.socket.emit('room:settings', { requireApproval: e.target.checked });
    MM.toast(e.target.checked ? '🔒 Los oyentes esperan tu aprobación' : '🔓 Entrada libre: los pendientes entraron');
  });
  $('#a-rename').addEventListener('click', () => {
    const t = prompt('Título de la sala:', A.room.title);
    if (t && t.trim()) A.socket.emit('room:settings', { title: t.trim() });
  });
  $('#a-sound').addEventListener('click', () => {
    MM.sound.unlock();
    prefs.sound = !prefs.sound;
    MM.prefs.save();
    renderTop();
  });

  const listenerLink = location.origin + '/';
  $('#a-link').value = listenerLink;
  $('#a-link').addEventListener('focus', (e) => e.target.select());
  $('#a-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(listenerLink);
    } catch (e) {
      $('#a-link').select();
      document.execCommand('copy');
    }
    MM.toast('📋 Link copiado');
  });
  $('#a-wsp').addEventListener('click', () => {
    const text = '🎧 Sumate al chat en vivo: ' + listenerLink;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  });

  /* ----------------------------------------------------- Lista de personas */

  function fmtSuspension(u) {
    if (!u.suspendedUntil) return null;
    return u.suspendedUntil === -1 ? 'Suspendido hasta que lo restablezcas' : 'Suspendido hasta las ' + MM.fmtTime(u.suspendedUntil);
  }

  async function ask(title, text, ok, ev, uid) {
    if (await MM.confirm(title, text, ok)) A.socket.emit(ev, { uid });
  }

  function openUserActions(uid) {
    const u = byUid().get(uid);
    if (!u) return MM.toast('Esa persona ya no está en la lista.');
    const items = [];
    if (u.status === 'active') {
      items.push({ sep: 'Suspender temporalmente (no puede escribir)' });
      [[1, '1 minuto'], [5, '5 minutos'], [10, '10 minutos'], [30, '30 minutos'], [0, 'Hasta que lo restablezca']].forEach(([min, label]) =>
        items.push({ icon: '🔇', label, onClick: () => { A.socket.emit('mod:suspend', { uid, minutes: min }); MM.toast('🔇 ' + u.name + ' suspendido'); } })
      );
      if (u.suspendedUntil) items.push({ icon: '✅', label: 'Restablecer (levantar suspensión)', onClick: () => A.socket.emit('mod:restore', { uid }) });
      items.push(
        { sep: 'Sacar de la sala' },
        { icon: '🚪', danger: true, label: 'Expulsar (puede volver a pedir ingreso)', onClick: () => ask('¿Expulsar a ' + u.name + '?', 'Sale de la sala, pero puede volver a pedir ingreso.', 'Expulsar', 'mod:kick', uid) },
        { icon: '⛔', danger: true, label: 'Banear (no puede volver a entrar)', onClick: () => ask('¿Banear a ' + u.name + '?', 'No podrá entrar hasta que lo restablezcas desde la pestaña Baneados.', 'Banear', 'mod:ban', uid) }
      );
    } else if (u.status === 'pending') {
      items.push(
        { icon: '✅', label: 'Aceptar ingreso', onClick: () => A.socket.emit('mod:approve', { uid }) },
        { icon: '✖️', danger: true, label: 'Rechazar', onClick: () => A.socket.emit('mod:reject', { uid }) },
        { icon: '⛔', danger: true, label: 'Banear', onClick: () => ask('¿Banear a ' + u.name + '?', 'No podrá volver a entrar hasta que lo restablezcas.', 'Banear', 'mod:ban', uid) }
      );
    } else if (u.status === 'banned') {
      items.push({ icon: '♻️', label: 'Restablecer (levantar el ban)', onClick: () => { A.socket.emit('mod:restore', { uid }); MM.toast('♻️ ' + u.name + ' restablecido'); } });
    }
    MM.sheet({ title: u.name, subtitle: u.status === 'active' ? (u.online ? 'En línea' : 'Desconectado') : u.status === 'pending' ? 'Pide entrar' : 'Baneado', avatar: u.avatar, items });
  }

  function row(u, actions) {
    const sus = fmtSuspension(u);
    return h('div', { class: 'a-row' + (u.online || u.status !== 'active' ? '' : ' off') + (sus ? ' sus' : '') },
      MM.avatar(u.avatar, 40),
      h('div', { class: 'a-info' },
        h('b', { text: u.name }),
        sus ? h('small', { class: 'warn', text: '🔇 ' + sus }) : h('small', { text: u.status === 'active' ? (u.online ? '🟢 En línea' : '⚪ Desconectado') : u.status === 'pending' ? 'Pidió entrar a las ' + MM.fmtTime(u.joinedAt) : 'Baneado' })
      ),
      h('div', { class: 'a-actions' }, actions)
    );
  }

  function renderLists() {
    const by = { active: [], pending: [], banned: [] };
    A.users.forEach((u) => by[u.status] && by[u.status].push(u));
    $('#c-active').textContent = by.active.length;
    $('#c-pending').textContent = by.pending.length;
    $('#c-pending').classList.toggle('alert', by.pending.length > 0);
    $('#c-banned').textContent = by.banned.length;
    const nb = $('#nav-badge');
    nb.textContent = by.pending.length;
    nb.classList.toggle('hidden', !by.pending.length);

    document.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('on', b.dataset.tab === A.tab));

    const tools = $('#list-tools');
    const list = $('#a-list');
    list.replaceChildren();
    tools.replaceChildren();
    tools.classList.add('hidden');

    if (A.tab === 'active') {
      tools.classList.remove('hidden');
      tools.append(h('input', {
        class: 'field', placeholder: 'Buscar oyente…', value: A.search, 'aria-label': 'Buscar oyente',
        oninput: (e) => { A.search = e.target.value; renderLists(); const i = $('#list-tools input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); },
      }));
      const term = A.search.trim().toLowerCase();
      const arr = by.active
        .filter((u) => !term || u.name.toLowerCase().includes(term))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'es'));
      if (!arr.length) list.append(h('div', { class: 'empty', text: term ? 'Nadie con ese nombre.' : 'Todavía no hay oyentes en la sala.' }));
      arr.forEach((u) => list.append(row(u, h('button', { class: 'btn btn-sm', type: 'button', text: 'Acciones ▾', onclick: () => openUserActions(u.uid) }))));
    } else if (A.tab === 'pending') {
      if (by.pending.length) {
        tools.classList.remove('hidden');
        tools.append(h('button', { class: 'btn btn-primary btn-sm', style: { flex: 1 }, type: 'button', text: '✅ Aceptar a todos (' + by.pending.length + ')', onclick: () => A.socket.emit('mod:approveAll') }));
      }
      if (!by.pending.length) list.append(h('div', { class: 'empty', text: A.room.requireApproval ? 'No hay solicitudes pendientes.' : 'La aprobación está desactivada: todos entran directo.' }));
      by.pending.forEach((u) =>
        list.append(row(u, [
          h('button', { class: 'btn btn-sm btn-primary', type: 'button', 'aria-label': 'Aceptar', text: '✔', onclick: () => A.socket.emit('mod:approve', { uid: u.uid }) }),
          h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Más opciones', text: '⋯', onclick: () => openUserActions(u.uid) }),
        ]))
      );
    } else {
      if (!by.banned.length) list.append(h('div', { class: 'empty', text: 'No hay oyentes baneados.' }));
      by.banned.forEach((u) =>
        list.append(row(u, h('button', { class: 'btn btn-sm btn-pink', type: 'button', text: '♻️ Restablecer', onclick: () => openUserActions(u.uid) })))
      );
    }
    return by;
  }

  document.querySelectorAll('#seg button').forEach((b) =>
    b.addEventListener('click', () => { A.tab = b.dataset.tab; renderLists(); })
  );

  /* -------------------------------------------------------------- Mobile */

  function showMobilePanel(id) {
    A.mobilePanel = id;
    document.querySelectorAll('.admin-main .panel').forEach((p) => p.classList.toggle('show', p.id === id));
    document.querySelectorAll('#bottom-nav button').forEach((b) => b.classList.toggle('on', b.dataset.p === id));
    if (id === 'panel-chat') scrollBottom();
  }
  document.querySelectorAll('#bottom-nav button').forEach((b) => b.addEventListener('click', () => showMobilePanel(b.dataset.p)));

  /* ----------------------------------------------------------------- Chat */

  function scrollBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }
  const nearBottom = () => msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 90;

  function build(m) {
    if (m.system) return h('div', { class: 'msg system', 'data-id': m.id }, h('span', { class: 'sys', text: m.text }));
    const f = m.from;
    const own = f.uid === A.hostUid;
    const row = h('div', { class: 'msg' + (own ? ' own' : '') + (f.host ? ' host' : ''), 'data-id': m.id });
    row.append(
      f.host
        ? MM.avatar('host', 36)
        : h('button', { type: 'button', class: 'av-btn', 'aria-label': 'Acciones sobre ' + f.name, onclick: () => openUserActions(f.uid) }, MM.avatar(f.avatar, 36))
    );
    const nameEl = h('button', {
      type: 'button', class: 'b-name ' + (f.host ? 'nc-host' : 'nc' + MM.colorIdx(f.uid)),
      onclick: () => !f.host && openUserActions(f.uid),
    }, f.name, f.host ? h('span', { class: 'host-tag', text: own ? 'VOS' : 'EXPOSITOR' }) : null);
    const kids = [nameEl];
    if (m.sticker) kids.push(MM.stickerEl(m.sticker));
    else kids.push(h('div', { class: 'b-text', text: m.text }));
    kids.push(h('div', { class: 'b-time', text: MM.fmtTime(m.ts) }));
    row.append(h('div', { class: 'bubble' + (m.sticker ? ' only-sticker' : '') }, kids));
    row.append(h('button', {
      type: 'button', class: 'del', title: 'Borrar mensaje', 'aria-label': 'Borrar mensaje', text: '🗑',
      onclick: () => A.socket.emit('mod:delete', { id: m.id }),
    }));
    return row;
  }

  function renderMsgs() {
    msgsEl.replaceChildren();
    if (!A.messages.length) msgsEl.append(h('div', { class: 'empty', text: 'Acá vas a ver el chat en vivo. Los mensajes de los oyentes aparecen al instante.' }));
    A.messages.forEach((m) => msgsEl.append(build(m)));
    scrollBottom();
  }

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    MM.sound.unlock();
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (A.room.status !== 'live' && A.room.status !== 'paused') return MM.toast('Iniciá la transmisión para poder escribir.');
    A.socket.emit('chat:send', { text });
    input.value = '';
    input.focus();
  });

  const picker = MM.createPicker({
    onEmoji: (em) => {
      const s = input.selectionStart == null ? input.value.length : input.selectionStart;
      const e = input.selectionEnd == null ? s : input.selectionEnd;
      input.setRangeText(em, s, e, 'end');
      input.focus();
    },
    onSticker: (id) => {
      if (A.room.status !== 'live' && A.room.status !== 'paused') return MM.toast('Iniciá la transmisión para poder escribir.');
      A.socket.emit('chat:send', { sticker: id });
    },
  });
  $('#picker-slot').append(picker);
  $('#btn-emoji').addEventListener('click', () => {
    MM.sound.unlock();
    $('#btn-emoji').textContent = picker.toggle() ? '⌨️' : '😊';
  });

  /* -------------------------------------------------------------- Sockets */

  A.socket.on('room:state', (r) => {
    A.room = r;
    A.clockOffset = r.now - Date.now();
    renderTop();
  });

  A.socket.on('admin:snapshot', (snap) => {
    A.room = snap.room;
    A.clockOffset = snap.room.now - Date.now();
    const prevPending = A.pendingCount;
    A.users = snap.users;
    const pend = snap.users.filter((u) => u.status === 'pending');
    A.pendingCount = pend.length;
    if (A.ready && pend.length > prevPending) {
      MM.sound.play('alert');
      MM.toast('🙋 ' + pend[pend.length - 1].name + ' pide entrar' + (pend.length > 1 ? ' (' + pend.length + ' en espera)' : ''), 3500, 'pending');
    }
    renderTop();
    renderLists();
  });

  A.socket.on('chat:history', (list) => {
    A.messages = list;
    renderMsgs();
  });
  A.socket.on('chat:message', (m) => {
    A.messages.push(m);
    if (A.messages.length > 400) A.messages.shift();
    const empty = msgsEl.querySelector('.empty');
    if (empty) empty.remove();
    const stick = nearBottom() || (m.from && m.from.uid === A.hostUid);
    msgsEl.append(build(m));
    if (stick) scrollBottom();
    if (!m.system && !(m.from && m.from.host)) MM.sound.play('msg');
  });
  A.socket.on('chat:deleted', ({ id }) => {
    A.messages = A.messages.filter((m) => m.id !== id);
    const el = msgsEl.querySelector('[data-id="' + id + '"]');
    if (el) el.remove();
  });
  A.socket.on('chat:error', ({ code }) => MM.toast(code === 'closed' ? 'Iniciá la transmisión para poder escribir.' : 'No se pudo enviar.'));

  document.addEventListener('pointerdown', () => MM.sound.unlock(), { once: true });
  MM.stickersReady.then(() => A.ready && renderMsgs());
  if (!A.token) showLogin();
})();
