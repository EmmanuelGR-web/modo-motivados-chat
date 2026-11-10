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
    chatTab: 'room', // 'room' = chat de la sala; si no, uid del oyente de la conversación privada
    dms: new Map(), // uid -> { peer, msgs, unread, open }
  };
  try { A.token = localStorage.getItem('mm_admin_token'); } catch (e) { /* ignore */ }

  const msgsEl = $('#msgs');
  const input = $('#input');
  const byUid = () => new Map(A.users.map((u) => [u.uid, u]));

  /* ------------------------------------------------------------- Sesión
   * No hay formulario acá: el ingreso es único en "/" y el servidor detecta al expositor
   * por su nombre registrado + contraseña. Este panel solo reanuda la sesión con el token.
   */

  function clearSession() {
    try { localStorage.removeItem('mm_admin_token'); } catch (e) { /* ignore */ }
    A.token = null;
    A.ready = false;
  }
  function goToLogin(expired) {
    clearSession();
    try { if (expired) sessionStorage.setItem('mm_admin_expired', '1'); } catch (e) { /* ignore */ }
    location.replace('/');
  }
  function showPanel() {
    $('#screen-login').classList.add('hidden');
    $('#admin').classList.remove('hidden');
    A.ready = true;
    showMobilePanel(A.mobilePanel || 'panel-chat');
  }

  function onAuth(res) {
    if (!res || !res.ok) return goToLogin(true);
    A.token = res.token;
    A.name = res.name;
    A.hostUid = 'h-' + res.token.slice(0, 6);
    try { localStorage.setItem('mm_admin_name', res.name); } catch (e) { /* ignore */ }
    showPanel();
  }

  // sin token no hay nada que ver acá: directo al ingreso
  if (!A.token) location.replace('/');

  A.socket.on('connect', () => {
    if (A.token) A.socket.emit('admin:resume', { token: A.token }, onAuth);
  });

  $('#a-logout').addEventListener('click', async () => {
    if (!(await MM.confirm('¿Cerrar sesión?', 'Vas a volver a la pantalla de ingreso. La transmisión sigue igual.', 'Cerrar sesión'))) return;
    A.socket.emit('admin:logout', { token: A.token });
    clearSession();
    setTimeout(() => location.replace('/'), 150);
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
    $('#a-sound').checked = !!prefs.sound;
    $('#a-sound-ico').textContent = prefs.sound ? '🔔' : '🔕';
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
  $('#a-sound').addEventListener('change', (e) => {
    MM.sound.unlock();
    prefs.sound = e.target.checked;
    MM.prefs.save();
    renderTop();
    MM.toast(prefs.sound ? '🔔 Sonido del chat activado' : '🔕 Sonido del chat apagado');
  });

  $('#a-clear').addEventListener('click', async () => {
    const ok = await MM.confirm(
      '¿Limpiar el chat general?',
      'Se borran todos los mensajes de la sala para todos los oyentes. No se puede deshacer. (Los mensajes privados entre oyentes no se tocan.)',
      'Sí, limpiar'
    );
    if (ok) A.socket.emit('mod:clear');
  });

  /* ------------------------------------------------------------- Compartir */

  const listenerLink = location.origin + '/';
  const SHARE_TEXT = '🎧 Sumate al chat en vivo de Modo Motivados: ' + listenerLink;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(listenerLink);
    } catch (e) {
      const tmp = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      tmp.value = listenerLink;
      document.body.append(tmp);
      tmp.select();
      document.execCommand('copy');
      tmp.remove();
    }
    MM.toast('📋 Link copiado');
  }

  function sendWhatsApp() {
    window.open('https://wa.me/?text=' + encodeURIComponent(SHARE_TEXT), '_blank', 'noopener');
  }

  // En celular abre el menú de compartir del sistema con la imagen; en la compu (o si no se puede) la descarga.
  async function shareQR() {
    try {
      const blob = await (await fetch('/qr.png')).blob();
      const file = new File([blob], 'modo-motivados-qr.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Modo Motivados', text: SHARE_TEXT });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: file.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      MM.toast('⬇️ QR descargado como imagen');
    } catch (e) {
      if (e && e.name !== 'AbortError') MM.toast('No se pudo compartir el QR');
    }
  }

  function openShare() {
    const close = () => back.remove();
    const btn = (cls, text, fn) => h('button', { type: 'button', class: 'btn ' + cls, text, onclick: fn });
    const back = h(
      'div',
      { class: 'sheet-back center', onclick: (e) => e.target === back && close() },
      h(
        'div',
        { class: 'sheet share-sheet', role: 'dialog', 'aria-label': 'Compartir la sala' },
        h(
          'div',
          { class: 'sheet-head' },
          h('div', { class: 'sheet-title' }, h('strong', { text: '📤 Compartir la sala' }), h('small', { text: 'Escaneá el QR o mandá el link' })),
          h('button', { type: 'button', class: 'sheet-x', 'aria-label': 'Cerrar', text: '✕', onclick: close })
        ),
        h('div', { class: 'qr-box' }, h('img', { src: '/qr.svg', alt: 'Código QR del link de la sala', width: '260', height: '260' })),
        h('div', { class: 'share-link', text: listenerLink }),
        h(
          'div',
          { class: 'share-btns' },
          btn('btn-wsp', '💬 Enviar por WhatsApp', sendWhatsApp),
          btn('btn-primary', '🖼️ Compartir QR', shareQR),
          btn('btn-ghost', '📋 Copiar link', copyLink)
        )
      )
    );
    document.body.append(back);
  }
  $('#a-share').addEventListener('click', openShare);

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
      if (u.online) items.push({ icon: '💬', label: 'Enviar mensaje privado', onClick: () => openDM(uid) });
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
    if (A.chatTab === 'room') {
      if (!A.messages.length) msgsEl.append(h('div', { class: 'empty', text: 'Acá vas a ver el chat en vivo. Los mensajes de los oyentes aparecen al instante.' }));
      A.messages.forEach((m) => msgsEl.append(build(m)));
    } else {
      const c = A.dms.get(A.chatTab);
      if (!c.msgs.length) msgsEl.append(h('div', { class: 'empty', text: 'Conversación privada con ' + c.peer.name + '. No aparece en la sala 🔒' }));
      c.msgs.forEach((m) => msgsEl.append(buildDM(m)));
    }
    scrollBottom();
  }

  /* ---------------------------------------------- Mensajes privados (oyente ↔ expositor) */

  function buildDM(m) {
    const own = m.from === 'host';
    const kids = [];
    if (own && m.hostName && m.hostName !== A.name) kids.push(h('div', { class: 'b-name nc-host', text: m.hostName }));
    if (m.sticker) kids.push(MM.stickerEl(m.sticker));
    else kids.push(h('div', { class: 'b-text', text: m.text }));
    kids.push(h('div', { class: 'b-time', text: MM.fmtTime(m.ts) }));
    return h('div', { class: 'msg' + (own ? ' own' : ''), 'data-id': 'dm' + m.id },
      h('div', { class: 'bubble' + (m.sticker ? ' only-sticker' : '') }, kids));
  }

  function peerInfo(uid, fallback) {
    const u = byUid().get(uid);
    return u ? { uid, name: u.name, avatar: u.avatar } : fallback || { uid, name: 'Oyente', avatar: 0 };
  }
  const peerOnline = (uid) => { const u = byUid().get(uid); return !!(u && u.status === 'active' && u.online); };

  function ensureDM(uid, peer) {
    let c = A.dms.get(uid);
    if (!c) {
      c = { peer: peerInfo(uid, peer), msgs: [], unread: 0, open: true };
      A.dms.set(uid, c);
    }
    c.open = true;
    return c;
  }

  function openDM(uid) {
    ensureDM(uid);
    setTab(uid);
    showMobilePanel('panel-chat');
    input.focus();
  }

  function setTab(t) {
    A.chatTab = t;
    if (t !== 'room') A.dms.get(t).unread = 0;
    picker.close();
    $('#btn-emoji').textContent = '😊';
    renderTabs();
    renderMsgs();
  }

  function unreadDMs() {
    let n = 0;
    for (const c of A.dms.values()) n += c.unread;
    return n;
  }

  function renderTabs() {
    const nav = $('#a-tabs');
    const openDMs = [...A.dms].filter(([, c]) => c.open);
    nav.classList.toggle('hidden', !openDMs.length);
    nav.replaceChildren(
      h('button', { type: 'button', class: 'tab' + (A.chatTab === 'room' ? ' on' : ''), onclick: () => setTab('room') },
        h('span', { text: '🌐' }), h('span', { class: 't-name', text: 'Sala' }))
    );
    for (const [uid, c] of openDMs) {
      c.peer = peerInfo(uid, c.peer);
      nav.append(
        h('button', { type: 'button', class: 'tab' + (A.chatTab === uid ? ' on' : ''), onclick: () => setTab(uid) },
          MM.avatar(c.peer.avatar, 22),
          h('span', { class: 't-name', text: c.peer.name }),
          c.unread ? h('span', { class: 't-unread', text: c.unread }) : null,
          h('span', {
            class: 't-x', role: 'button', 'aria-label': 'Cerrar conversación', text: '✕',
            onclick: (e) => { e.stopPropagation(); c.open = false; if (A.chatTab === uid) setTab('room'); else renderTabs(); },
          })
        )
      );
    }
    // aviso y placeholder según la pestaña
    const banner = $('#a-banner');
    if (A.chatTab === 'room') {
      banner.classList.add('hidden');
      input.placeholder = 'Escribir como expositor…';
    } else {
      const c = A.dms.get(A.chatTab);
      banner.classList.remove('hidden');
      banner.textContent = peerOnline(A.chatTab)
        ? '🔒 Privado con ' + c.peer.name + ': no aparece en la sala.'
        : '⚪ ' + c.peer.name + ' no está conectado ahora.';
      input.placeholder = 'Mensaje privado a ' + c.peer.name + '…';
    }
    const badge = $('#nav-chat-badge');
    if (badge) {
      const n = unreadDMs();
      badge.textContent = n;
      badge.classList.toggle('hidden', !n);
    }
  }

  function sendContent(content) {
    if (A.chatTab !== 'room') return A.socket.emit('dm:send', { to: A.chatTab, ...content });
    if (A.room.status !== 'live' && A.room.status !== 'paused') return MM.toast('Iniciá la transmisión para poder escribir.');
    A.socket.emit('chat:send', content);
  }

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    MM.sound.unlock();
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    sendContent({ text });
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
    onSticker: (id) => sendContent({ sticker: id }),
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
    if (A.dms.size) renderTabs();
  });

  A.socket.on('chat:history', (list) => {
    A.messages = list;
    if (A.chatTab === 'room') renderMsgs();
  });
  A.socket.on('chat:message', (m) => {
    A.messages.push(m);
    if (A.messages.length > 400) A.messages.shift();
    if (A.chatTab !== 'room') {
      if (!m.system && !(m.from && m.from.host)) MM.sound.play('msg');
      return;
    }
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
  A.socket.on('dm:message', (m) => {
    const fromHost = m.from === 'host';
    const uid = fromHost ? m.to : m.from;
    const c = ensureDM(uid, m.peer);
    c.msgs.push(m);
    if (c.msgs.length > 300) c.msgs.shift();
    const viewing = A.chatTab === uid;
    if (viewing) {
      const empty = msgsEl.querySelector('.empty');
      if (empty) empty.remove();
      msgsEl.append(buildDM(m));
      scrollBottom();
    }
    if (!fromHost) {
      if (!viewing) {
        c.unread++;
        MM.toast('💬 ' + c.peer.name + ' te escribió por privado', 3000, 'dm-' + uid);
      }
      MM.sound.play('dm');
    }
    renderTabs();
  });
  A.socket.on('dm:failed', () => MM.toast('Esa persona ya no está en la sala.', 3000));
  A.socket.on('chat:error', ({ code }) => MM.toast(code === 'closed' ? 'Iniciá la transmisión para poder escribir.' : 'No se pudo enviar.'));

  document.addEventListener('pointerdown', () => MM.sound.unlock(), { once: true });
  MM.stickersReady.then(() => A.ready && renderMsgs());
})();
