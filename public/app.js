/* Vista del oyente */
(function () {
  'use strict';

  const h = MM.h;
  const $ = (s) => document.querySelector(s);
  const prefs = MM.prefs.load();

  const S = {
    socket: io(),
    me: null, // estado propio que manda el servidor
    profile: null, // { name, avatar } guardado en este dispositivo
    changing: false, // el usuario está eligiendo otro nombre/avatar
    room: { status: 'waiting', title: 'Modo Motivados', online: 0 },
    users: [],
    known: new Map(), // uid -> { uid, name, avatar }
    messages: [],
    dms: new Map(), // uid -> { peer, msgs, unread, open }
    tab: 'room',
    muted: new Set(prefs.muted),
    inApp: false,
    avatarSel: 0,
    prevStatus: null,
  };

  try {
    S.profile = JSON.parse(localStorage.getItem('mm_profile') || 'null');
    if (!S.profile || typeof S.profile.name !== 'string') S.profile = null;
  } catch (e) {
    S.profile = null;
  }

  const msgsEl = $('#msgs');
  const input = $('#input');

  /* ================================================================
     Pantallas
     ================================================================ */

  function showScreen(id) {
    for (const s of ['screen-login', 'screen-state', 'app']) $('#' + s).classList.toggle('hidden', s !== id);
    S.inApp = id === 'app';
  }

  function setState(cfg) {
    showScreen('screen-state');
    const ic = $('#st-icon');
    ic.textContent = cfg.icon;
    ic.classList.toggle('pulse', !!cfg.pulse);
    $('#st-title').textContent = cfg.title;
    $('#st-text').textContent = cfg.text;
    const b = $('#st-btn');
    b.classList.toggle('hidden', !cfg.btn);
    if (cfg.btn) {
      b.textContent = cfg.btn.label;
      b.onclick = cfg.btn.onClick;
    }
  }

  function render() {
    const me = S.me;
    if (S.changing || (!S.profile && !me)) return showScreen('screen-login');
    if (!me) return setState({ icon: '⚡', pulse: true, title: 'Conectando…', text: 'Un segundito, te estamos metiendo a la sala.' });

    if (me.status === 'pending')
      return setState({
        icon: '⏳', pulse: true,
        title: 'Esperando aprobación',
        text: 'Un expositor tiene que dejarte entrar. Quedate en esta pantalla: apenas te acepten, entrás solo.',
      });
    if (me.status === 'banned')
      return setState({
        icon: '⛔',
        title: 'No podés entrar a esta sala',
        text: 'Un expositor te bloqueó. Si te restablecen, vas a entrar automáticamente.',
      });
    if (me.status === 'kicked') {
      const rejected = me.reason === 'rejected';
      return setState({
        icon: rejected ? '🙅' : '🚪',
        title: rejected ? 'Solicitud rechazada' : 'Te sacaron de la sala',
        text: rejected
          ? 'El expositor no aprobó tu ingreso. Podés volver a intentarlo.'
          : 'Un expositor te expulsó de la sala. Si fue un error, podés volver a pedir ingreso.',
        btn: { label: 'Volver a pedir ingreso', onClick: doJoin },
      });
    }

    // activo
    if (S.room.status === 'waiting')
      return setState({
        icon: '📡', pulse: true,
        title: 'Ya estás adentro',
        text: 'La transmisión todavía no empezó. Dejá esta pantalla abierta: el chat se abre solo cuando los expositores den inicio.',
      });
    if (S.room.status === 'ended')
      return setState({ icon: '🏁', title: '¡Terminó la transmisión!', text: 'Gracias por participar. El chat se cerró.' });

    const wasInApp = S.inApp;
    showScreen('app');
    renderTop();
    renderTabs();
    renderUsers();
    updateComposer();
    if (!wasInApp) renderMsgs(true);
  }

  /* ================================================================
     Ingreso
     ================================================================ */

  function buildAvatarGrid() {
    const grid = $('#avatar-grid');
    grid.replaceChildren();
    MM.AVATARS.forEach((_, i) => {
      grid.append(
        h('button', {
          type: 'button', role: 'radio', class: 'av-opt' + (i === S.avatarSel ? ' on' : ''),
          'aria-checked': String(i === S.avatarSel), 'aria-label': 'Avatar ' + MM.AVATARS[i][3],
          onclick: () => { S.avatarSel = i; buildAvatarGrid(); },
        }, MM.avatar(i, 64))
      );
    });
  }

  const ERR = {
    name_short: 'El nombre tiene que tener al menos 2 caracteres.',
    name_reserved: 'Ese nombre está reservado. Probá con otro.',
    name_taken: 'Ya hay alguien con ese nombre. Elegí otro.',
    bad_client: 'No pudimos identificar tu navegador. Recargá la página.',
    need_password: 'Escribí la contraseña para continuar.',
    bad_password: 'Contraseña incorrecta.',
  };
  const ADMIN_STEP = new Set(['need_password', 'bad_password', 'locked']);

  /* El campo de contraseña solo aparece cuando el servidor reconoce el nombre de un expositor */
  function showPass(show) {
    $('#pass-wrap').classList.toggle('hidden', !show);
    $('#login-btn').textContent = show ? 'Entrar' : 'Entrar al chat';
    if (!show) { $('#pass').value = ''; setEye(false); }
  }

  /* 👁️ mostrar / ocultar la contraseña */
  function setEye(on) {
    $('#pass').type = on ? 'text' : 'password';
    const b = $('#btn-eye');
    b.textContent = on ? '🙈' : '👁️';
    b.title = on ? 'Ocultar contraseña' : 'Mostrar contraseña';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(on));
  }
  $('#btn-eye').addEventListener('click', () => {
    setEye($('#pass').type === 'password');
    $('#pass').focus();
  });

  function doJoin(password) {
    if (!S.profile) return;
    const data = { clientId: MM.clientId(), name: S.profile.name, avatar: S.profile.avatar };
    if (typeof password === 'string' && password) data.password = password;
    S.socket.emit('join', data, (res) => {
      // Expositor: guardamos la sesión y pasamos al panel
      if (res && res.ok && res.role === 'admin') {
        try {
          localStorage.setItem('mm_admin_token', res.token);
          localStorage.setItem('mm_admin_name', res.name);
          localStorage.removeItem('mm_profile');
        } catch (e) { /* ignore */ }
        return location.replace('/admin');
      }
      if (!res || !res.ok) {
        const prev = S.profile;
        const code = res && res.code;
        S.profile = null; S.me = null; S.changing = true;
        try { localStorage.removeItem('mm_profile'); } catch (e) { /* ignore */ }
        if (prev) { $('#name').value = prev.name; S.avatarSel = prev.avatar; buildAvatarGrid(); }
        showPass(ADMIN_STEP.has(code));
        $('#login-error').textContent =
          code === 'locked' ? 'Demasiados intentos. Esperá ' + res.retry + ' segundos.' :
          ERR[code] || 'No pudimos entrar. Probá de nuevo.';
        render();
        if (ADMIN_STEP.has(code)) $('#pass').focus();
        return;
      }
      S.changing = false;
      S.me = res.you;
      try { localStorage.setItem('mm_profile', JSON.stringify(S.profile)); } catch (e) { /* ignore */ }
      render();
    });
  }

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    MM.sound.unlock();
    const name = $('#name').value.replace(/\s+/g, ' ').trim();
    if (name.length < 2) {
      $('#login-error').textContent = ERR.name_short;
      return $('#name').focus();
    }
    const askingPass = !$('#pass-wrap').classList.contains('hidden');
    const password = askingPass ? $('#pass').value : '';
    if (askingPass && !password) {
      $('#login-error').textContent = ERR.need_password;
      return $('#pass').focus();
    }
    $('#login-error').textContent = '';
    $('#pass').value = '';
    S.profile = { name, avatar: S.avatarSel };
    doJoin(password);
  });

  // si cambia el nombre, la contraseña deja de aplicar
  $('#name').addEventListener('input', () => {
    if (!$('#pass-wrap').classList.contains('hidden')) {
      showPass(false);
      $('#login-error').textContent = '';
    }
  });

  // el panel nos manda acá cuando la sesión de expositor venció (p. ej. el servidor se reinició)
  try {
    if (sessionStorage.getItem('mm_admin_expired')) {
      sessionStorage.removeItem('mm_admin_expired');
      S.changing = true;
      S.profile = null;
      $('#name').value = localStorage.getItem('mm_admin_name') || '';
      showPass(true);
      $('#login-error').textContent = 'Tu sesión de expositor terminó. Volvé a escribir la contraseña.';
    }
  } catch (e) { /* ignore */ }

  $('#btn-random').addEventListener('click', () => {
    const r = MM.randomIdentity();
    $('#name').value = r.name;
    showPass(false);
    S.avatarSel = r.avatar;
    buildAvatarGrid();
  });

  function changeProfile() {
    const prev = S.profile || (S.me && { name: S.me.name, avatar: S.me.avatar });
    S.profile = null; S.changing = true;
    try { localStorage.removeItem('mm_profile'); } catch (e) { /* ignore */ }
    if (prev) { $('#name').value = prev.name; S.avatarSel = prev.avatar; buildAvatarGrid(); }
    $('#login-error').textContent = '';
    render();
  }
  $('#st-leave').addEventListener('click', changeProfile);

  /* ================================================================
     Barra superior, usuarios y menús
     ================================================================ */

  const STATUS_TXT = { live: 'En vivo', paused: 'En pausa', waiting: 'En espera', ended: 'Finalizado' };

  function renderTop() {
    $('#room-title').textContent = S.room.title;
    const p = $('#room-pill');
    p.className = 'pill ' + S.room.status;
    p.textContent = STATUS_TXT[S.room.status] || '';
    $('#room-online').textContent = S.room.online ? '· 👥 ' + S.room.online : '';
    $('#room-online').title = S.room.online + ' en la sala';
    const s = $('#btn-sound');
    s.textContent = prefs.sound ? '🔔' : '🔕';
    s.classList.toggle('off', !prefs.sound);
    const m = $('#btn-me');
    m.replaceChildren(MM.avatar(S.me ? S.me.avatar : 0, 30));
  }

  function learn(p) {
    if (p && p.uid && !p.host) S.known.set(p.uid, { uid: p.uid, name: p.name, avatar: p.avatar });
  }

  // El expositor (o el equipo de expositores) aparece como un contacto fijo para mensajes privados
  const HOST = 'host';
  const hostPeer = () => ({ uid: HOST, name: S.room.hostLabel || 'Expositor', avatar: 'host', host: true });
  const hostOnline = () => (S.room.hostsOnline || 0) > 0;
  const peerOf = (uid) => (uid === HOST ? hostPeer() : S.known.get(uid));
  const isOnlinePeer = (uid) => (uid === HOST ? hostOnline() : S.users.some((u) => u.uid === uid));

  const isBlocked = (uid) => !!(S.me && S.me.blocked.includes(uid));
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function renderUsers() {
    const term = norm($('#users-search').value.trim());
    const list = S.users.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
    $('#users-count').textContent = '(' + list.length + ')';
    const box = $('#users-list');
    box.replaceChildren();
    const shown = list.filter((u) => !term || norm(u.name).includes(term));
    const hp = hostPeer();
    if (hostOnline() && (!term || norm(hp.name).includes(term) || 'expositor'.includes(term))) {
      box.append(
        h('button', { type: 'button', class: 'user-row host-row', title: 'Enviar mensaje privado al expositor', onclick: () => openDM(HOST) },
          MM.avatar('host', 36),
          h('span', { class: 'u-name', text: hp.name }),
          h('span', { class: 'host-tag', text: 'EXPOSITOR' }),
          h('span', { class: 'u-flag', title: 'Mensaje privado', text: '💬' })
        )
      );
    }
    if (!shown.length) box.append(h('div', { class: 'empty', text: term ? 'Nadie con ese nombre.' : 'Todavía no hay nadie más.' }));
    shown.forEach((u) => {
      const mine = S.me && u.uid === S.me.uid;
      box.append(
        h('button', {
          type: 'button', class: 'user-row', disabled: mine || null,
          onclick: () => { if (!mine) openUserMenu(u.uid); },
        },
          MM.avatar(u.avatar, 36),
          h('span', { class: 'u-name', text: u.name + (mine ? ' (vos)' : '') }),
          S.muted.has(u.uid) ? h('span', { class: 'u-flag', title: 'Silenciado', text: '🔇' }) : null,
          isBlocked(u.uid) ? h('span', { class: 'u-flag', title: 'Bloqueado', text: '🚫' }) : null
        )
      );
    });
  }
  $('#users-search').addEventListener('input', renderUsers);

  const openDrawer = () => $('#users-col').classList.add('open');
  const closeDrawer = () => $('#users-col').classList.remove('open');
  $('#btn-users').addEventListener('click', openDrawer);
  $('#users-close').addEventListener('click', closeDrawer);

  function toggleMute(uid) {
    if (S.muted.has(uid)) S.muted.delete(uid);
    else S.muted.add(uid);
    prefs.muted = [...S.muted];
    MM.prefs.save();
    renderUsers();
    if (S.tab === 'room') renderMsgs();
  }

  function toggleBlock(uid) {
    S.socket.emit('block:set', { uid, blocked: !isBlocked(uid) });
  }

  function openUserMenu(uid) {
    if (uid === HOST) return openDM(HOST);
    const p = S.known.get(uid);
    if (!p || (S.me && uid === S.me.uid)) return;
    const online = S.users.some((u) => u.uid === uid);
    const blocked = isBlocked(uid);
    const muted = S.muted.has(uid);
    MM.sheet({
      title: p.name,
      subtitle: online ? 'En la sala' : 'Ya no está en la sala',
      avatar: p.avatar,
      items: [
        { icon: '💬', label: 'Enviar mensaje privado', onClick: () => (blocked ? MM.toast('Primero desbloquealo para escribirle.') : openDM(uid)) },
        { icon: muted ? '🔊' : '🔇', label: muted ? 'Dejar de silenciar sus mensajes' : 'Silenciar sus mensajes en la sala', onClick: () => toggleMute(uid) },
        { icon: blocked ? '✅' : '🚫', danger: !blocked, label: blocked ? 'Desbloquear (volver a recibir privados)' : 'Bloquear (no recibir ni enviar privados)', onClick: () => toggleBlock(uid) },
      ],
    });
  }

  function openMeMenu() {
    const items = [
      { icon: prefs.sound ? '🔕' : '🔔', label: prefs.sound ? 'Silenciar sonidos de notificación' : 'Activar sonidos de notificación', onClick: toggleSound },
    ];
    const mutedList = [...S.muted].map((u) => S.known.get(u) || { uid: u, name: 'Usuario', avatar: 0 });
    const blockedList = (S.me ? S.me.blocked : []).map((u) => S.known.get(u) || { uid: u, name: 'Usuario', avatar: 0 });
    if (mutedList.length || blockedList.length) {
      items.push({ sep: 'Silenciados y bloqueados' });
      mutedList.forEach((u) => items.push({ icon: '🔊', label: 'Dejar de silenciar a ' + u.name, onClick: () => toggleMute(u.uid) }));
      blockedList.forEach((u) => items.push({ icon: '✅', label: 'Desbloquear a ' + u.name, onClick: () => toggleBlock(u.uid) }));
    }
    items.push({ sep: 'Perfil' }, { icon: '✏️', label: 'Cambiar nombre o avatar', onClick: changeProfile });
    MM.sheet({ title: S.me.name, subtitle: 'Tu perfil', avatar: S.me.avatar, items });
  }
  $('#btn-me').addEventListener('click', openMeMenu);

  function toggleSound() {
    MM.sound.unlock();
    prefs.sound = !prefs.sound;
    MM.prefs.save();
    renderTop();
    MM.toast(prefs.sound ? '🔔 Sonidos activados' : '🔕 Sonidos silenciados', 1800);
    if (prefs.sound) MM.sound.play('msg');
  }
  $('#btn-sound').addEventListener('click', toggleSound);

  /* ================================================================
     Pestañas y conversaciones privadas
     ================================================================ */

  function ensureDM(uid) {
    let c = S.dms.get(uid);
    if (!c) {
      c = { peer: peerOf(uid) || { uid, name: 'Usuario', avatar: 0 }, msgs: [], unread: 0, open: true };
      S.dms.set(uid, c);
    }
    c.open = true;
    return c;
  }

  function openDM(uid) {
    ensureDM(uid);
    closeDrawer();
    setTab(uid);
    input.focus();
  }

  function setTab(t) {
    S.tab = t;
    if (t !== 'room') S.dms.get(t).unread = 0;
    $('#picker-slot .picker') && $('#picker-slot .picker').classList.add('hidden');
    renderTabs();
    renderMsgs(true);
    updateComposer();
    updateTitle();
  }

  function renderTabs() {
    const nav = $('#tabs');
    nav.replaceChildren(
      h('button', { type: 'button', class: 'tab' + (S.tab === 'room' ? ' on' : ''), onclick: () => setTab('room') }, h('span', { text: '🌐' }), h('span', { class: 't-name', text: 'Sala' }))
    );
    for (const [uid, c] of S.dms) {
      if (!c.open) continue;
      c.peer = peerOf(uid) || c.peer;
      nav.append(
        h('button', { type: 'button', class: 'tab' + (S.tab === uid ? ' on' : ''), onclick: () => setTab(uid) },
          MM.avatar(c.peer.avatar, 22),
          h('span', { class: 't-name', text: c.peer.name }),
          c.unread ? h('span', { class: 't-unread', text: c.unread }) : null,
          h('span', {
            class: 't-x', role: 'button', 'aria-label': 'Cerrar conversación', text: '✕',
            onclick: (e) => { e.stopPropagation(); c.open = false; if (S.tab === uid) setTab('room'); else renderTabs(); },
          })
        )
      );
    }
    const head = $('#dm-head');
    if (S.tab === 'room') head.classList.add('hidden');
    else {
      const c = S.dms.get(S.tab);
      head.classList.remove('hidden');
      head.replaceChildren(
        MM.avatar(c.peer.avatar, 34),
        h('span', { class: 'dh-name', text: c.peer.name }),
        S.tab === HOST
          ? h('span', { class: 'host-tag', text: 'EXPOSITOR' })
          : h('button', { type: 'button', class: 'btn btn-sm', text: '⋯ Opciones', onclick: () => openUserMenu(S.tab) })
      );
    }
  }

  function totalUnread() {
    let n = 0;
    for (const c of S.dms.values()) n += c.unread;
    return n;
  }
  function updateTitle() {
    const n = totalUnread();
    document.title = (n ? '(' + n + ') ' : '') + 'Modo Motivados · Chat en vivo';
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.tab !== 'room' && S.dms.get(S.tab)) {
      S.dms.get(S.tab).unread = 0;
      renderTabs();
    }
    updateTitle();
  });

  /* ================================================================
     Mensajes
     ================================================================ */

  let EMOJI_ONLY = null, EMOJI_ANY = null;
  try {
    EMOJI_ONLY = new RegExp('^(?:\\p{Extended_Pictographic}|\\uFE0F|\\u200D|\\s)+$', 'u');
    EMOJI_ANY = new RegExp('\\p{Extended_Pictographic}', 'gu');
  } catch (e) { /* navegador viejo: sin emojis grandes */ }
  const isBigEmoji = (t) => !!EMOJI_ONLY && EMOJI_ONLY.test(t) && (t.match(EMOJI_ANY) || []).length <= 3;

  function bubbleBody(m, extra) {
    const only = !!m.sticker;
    const kids = [];
    if (extra) kids.push(extra);
    if (m.sticker) kids.push(MM.stickerEl(m.sticker));
    else kids.push(h('div', { class: 'b-text' + (isBigEmoji(m.text) ? ' big-emoji' : ''), text: m.text }));
    kids.push(h('div', { class: 'b-time', text: MM.fmtTime(m.ts) }));
    return h('div', { class: 'bubble' + (only ? ' only-sticker' : '') }, kids);
  }

  function buildPublic(m) {
    if (m.system) return h('div', { class: 'msg system', 'data-id': m.id }, h('span', { class: 'sys', text: m.text }));
    const f = m.from;
    const own = S.me && f.uid === S.me.uid;
    const host = !!f.host;
    learn(f);
    const row = h('div', { class: 'msg' + (own ? ' own' : '') + (host ? ' host' : ''), 'data-id': m.id });

    if (!own && !host && !m._show && S.muted.has(f.uid)) {
      row.classList.add('muted');
      const body = h('div', { class: 'bubble' },
        h('div', { class: 'b-text' }, 'Mensaje de ' + f.name + ' silenciado ',
          h('button', { type: 'button', class: 'link', text: 'ver', onclick: () => { const full = buildPublic({ ...m, _show: true }); row.replaceWith(full); } })
        )
      );
      row.append(body);
      return row;
    }

    if (!own && !host) {
      row.append(h('button', { type: 'button', class: 'av-btn', 'aria-label': 'Opciones de ' + f.name, onclick: () => openUserMenu(f.uid) }, MM.avatar(f.avatar, 36)));
    } else if (host) {
      row.append(h('button', { type: 'button', class: 'av-btn', 'aria-label': 'Mensaje privado al expositor', onclick: () => openDM(HOST) }, MM.avatar('host', 36)));
    }

    const nameBtn = own
      ? null
      : h('button', {
          type: 'button', class: 'b-name ' + (host ? 'nc-host' : 'nc' + MM.colorIdx(f.uid)),
          onclick: () => (host ? openDM(HOST) : openUserMenu(f.uid)),
        }, f.name, host ? h('span', { class: 'host-tag', text: 'EXPOSITOR' }) : null);
    row.append(bubbleBody(m, nameBtn));
    return row;
  }

  function buildDM(m) {
    const own = S.me && m.from === S.me.uid;
    return h('div', { class: 'msg' + (own ? ' own' : ''), 'data-id': m.id }, bubbleBody(m, null));
  }

  function nearBottom() {
    return msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 90;
  }
  function scrollBottom() {
    msgsEl.scrollTop = msgsEl.scrollHeight;
    $('#jump').classList.add('hidden');
  }
  msgsEl.addEventListener('scroll', () => nearBottom() && $('#jump').classList.add('hidden'));
  $('#jump').addEventListener('click', scrollBottom);

  function renderMsgs(forceBottom) {
    const stick = forceBottom || nearBottom();
    msgsEl.replaceChildren();
    if (S.tab === 'room') {
      if (!S.messages.length) msgsEl.append(h('div', { class: 'empty', text: 'Todavía no hay mensajes. ¡Rompé el hielo! 🧊' }));
      S.messages.forEach((m) => msgsEl.append(buildPublic(m)));
    } else {
      const c = S.dms.get(S.tab);
      if (!c.msgs.length)
        msgsEl.append(h('div', { class: 'empty', text: S.tab === HOST
          ? 'Escribile al expositor por privado: tu mensaje no aparece en la sala 🔒'
          : 'Conversación privada con ' + c.peer.name + '. Solo la ven ustedes dos 🔒' }));
      c.msgs.forEach((m) => msgsEl.append(buildDM(m)));
    }
    if (stick) scrollBottom();
  }

  function appendMsg(el, forceStick) {
    const empty = msgsEl.querySelector('.empty');
    if (empty) empty.remove();
    const stick = forceStick || nearBottom();
    msgsEl.append(el);
    if (stick) scrollBottom();
    else $('#jump').classList.remove('hidden');
  }

  /* ---------- Composer ---------- */

  const isSuspended = () => !!(S.me && S.me.suspendedUntil);

  function updateComposer() {
    if (!S.inApp) return;
    const banner = $('#banner');
    const composer = $('#composer');
    const note = $('#composer-note');
    let b = null;
    let canType = true;
    note.classList.add('hidden');
    composer.classList.remove('hidden');

    if (isSuspended()) {
      const t = S.me.suspendedUntil === -1 ? 'hasta que un expositor te restablezca' : 'hasta las ' + MM.fmtTime(S.me.suspendedUntil);
      b = { cls: 'bad', text: '🔇 Estás suspendido temporalmente (' + t + '). Por ahora no podés escribir.' };
      canType = false;
    } else if (S.room.status === 'paused') {
      b = { cls: 'warn', text: '⏸️ El chat está en pausa. Vuelve cuando los expositores lo reanuden.' };
      canType = false;
    }

    if (S.tab !== 'room') {
      const c = S.dms.get(S.tab);
      const online = isOnlinePeer(S.tab);
      if (isBlocked(S.tab)) {
        composer.classList.add('hidden');
        note.classList.remove('hidden');
        note.replaceChildren(
          h('span', { text: '🚫 Bloqueaste a ' + c.peer.name + '. No pueden escribirse.' }),
          h('button', { type: 'button', class: 'btn btn-sm', text: 'Desbloquear', onclick: () => toggleBlock(S.tab) })
        );
        b = null;
      } else if (!online && canType) {
        b = { cls: 'info', text: S.tab === HOST ? 'El expositor no está conectado ahora.' : c.peer.name + ' no está en la sala ahora.' };
        canType = false;
      } else if (!b) {
        b = { cls: 'info', text: S.tab === HOST ? '🔒 Mensaje privado al expositor: no aparece en la sala.' : '🔒 Mensaje privado: solo lo ven ustedes dos.' };
      }
    }

    banner.classList.toggle('hidden', !b);
    if (b) {
      banner.className = 'banner ' + b.cls;
      banner.textContent = b.text;
    }
    composer.classList.toggle('disabled', !canType);
    input.disabled = !canType;
    input.placeholder = canType ? (S.tab === 'room' ? 'Escribí un mensaje…' : 'Mensaje privado a ' + S.dms.get(S.tab).peer.name + '…') : 'No podés escribir ahora';
  }

  function send(content) {
    if (!S.me || S.me.status !== 'active' || S.room.status !== 'live' || isSuspended()) return;
    if (S.tab === 'room') S.socket.emit('chat:send', content);
    else S.socket.emit('dm:send', { to: S.tab, ...content });
  }

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    MM.sound.unlock();
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    send({ text });
    input.value = '';
    input.focus();
  });

  const picker = MM.createPicker({
    onEmoji: (em) => {
      const s = input.selectionStart == null ? input.value.length : input.selectionStart;
      const e = input.selectionEnd == null ? s : input.selectionEnd;
      if (input.value.length + em.length <= 500) {
        input.setRangeText(em, s, e, 'end');
        input.focus();
      }
    },
    onSticker: (id) => send({ sticker: id }),
  });
  $('#picker-slot').append(picker);
  $('#btn-emoji').addEventListener('click', () => {
    MM.sound.unlock();
    const open = picker.toggle();
    $('#btn-emoji').textContent = open ? '⌨️' : '😊';
  });
  picker.addEventListener('click', () => {});

  /* ================================================================
     Sockets
     ================================================================ */

  const sk = S.socket;
  let connEl = null;

  sk.on('connect', () => {
    if (connEl) { connEl.remove(); connEl = null; }
    if (S.profile) doJoin();
    else render();
  });
  sk.on('disconnect', () => {
    if (!connEl) { connEl = h('div', { class: 'conn', text: '📶 Reconectando…' }); document.body.append(connEl); }
  });

  sk.on('room:state', (r) => {
    S.room = r;
    render();
  });

  sk.on('users:list', (list) => {
    S.users = list;
    list.forEach(learn);
    if (!S.inApp) return;
    renderUsers();
    renderTabs();
    updateComposer();
  });

  sk.on('you:state', (you) => {
    const prev = S.me;
    S.me = you;
    S.prevStatus = prev && prev.status;
    if (prev && prev.status === 'active') {
      if (you.status === 'kicked') MM.toast(you.reason === 'rejected' ? 'Tu solicitud fue rechazada' : '🚪 Un expositor te sacó de la sala', 4000);
      if (you.status === 'banned') MM.toast('⛔ Fuiste bloqueado de la sala', 4000);
      if (!prev.suspendedUntil && you.suspendedUntil) MM.toast('🔇 Un expositor te suspendió temporalmente', 4000);
      if (prev.suspendedUntil && !you.suspendedUntil) MM.toast('✅ Ya podés volver a escribir', 3500);
    }
    if (prev && prev.status !== 'active' && you.status === 'active') {
      MM.sound.play('alert');
      MM.toast('✅ ¡Entraste a la sala!', 3000);
    }
    if (prev && prev.blocked.length !== you.blocked.length) {
      const added = you.blocked.find((u) => !prev.blocked.includes(u));
      const rem = prev.blocked.find((u) => !you.blocked.includes(u));
      const who = S.known.get(added || rem);
      if (who) MM.toast(added ? '🚫 Bloqueaste a ' + who.name : '✅ Desbloqueaste a ' + who.name, 2400);
    }
    render();
  });

  sk.on('chat:history', (list) => {
    S.messages = list;
    if (S.inApp && S.tab === 'room') renderMsgs(true);
  });

  sk.on('chat:message', (m) => {
    S.messages.push(m);
    if (S.messages.length > 400) S.messages.shift();
    const own = S.me && m.from && m.from.uid === S.me.uid;
    if (S.inApp && S.tab === 'room') appendMsg(buildPublic(m), own);
    if (!m.system && !own && !(m.from && S.muted.has(m.from.uid) && !m.from.host)) MM.sound.play('msg');
  });

  sk.on('chat:deleted', ({ id }) => {
    S.messages = S.messages.filter((m) => m.id !== id);
    const el = msgsEl.querySelector('[data-id="' + id + '"]');
    if (el && S.tab === 'room') el.remove();
  });

  sk.on('chat:error', ({ code }) => {
    const t = {
      rate: 'Vas muy rápido, esperá un segundito 😅',
      suspended: '🔇 Estás suspendido: no podés escribir ahora.',
      paused: '⏸️ El chat está en pausa.',
      waiting: 'El chat todavía no se abrió.',
      ended: 'La transmisión ya terminó.',
    }[code];
    MM.toast(t || 'No se pudo enviar el mensaje.');
  });

  sk.on('dm:message', (m) => {
    if (!S.me) return;
    const mine = m.from === S.me.uid;
    const peerUid = mine ? m.to : m.from;
    const c = ensureDM(peerUid);
    c.msgs.push(m);
    if (c.msgs.length > 300) c.msgs.shift();
    const viewing = S.tab === peerUid && !document.hidden;
    if (S.inApp && S.tab === peerUid) appendMsg(buildDM(m), mine);
    if (!mine) {
      if (!viewing) {
        c.unread++;
        if (S.tab !== peerUid) MM.toast('💬 ' + c.peer.name + ' te escribió', 2200);
        if (navigator.vibrate) navigator.vibrate(60);
      }
      MM.sound.play('dm');
    }
    if (S.inApp) renderTabs();
    updateTitle();
  });

  sk.on('dm:failed', ({ to, reason }) => {
    if (to === HOST && reason === 'offline') return MM.toast('El expositor no está conectado ahora.', 3500);
    const t = {
      you_blocked: 'Tenés bloqueado a este usuario. Desbloquealo para escribirle.',
      not_receiving: 'Este usuario no está recibiendo mensajes tuyos.',
      offline: 'Esa persona ya no está en la sala.',
      paused: '⏸️ El chat está en pausa.',
      suspended: '🔇 Estás suspendido: no podés escribir ahora.',
      rate: 'Vas muy rápido, esperá un segundito 😅',
    }[reason];
    MM.toast(t || 'No se pudo entregar el mensaje.', 3500);
  });

  /* ================================================================
     Inicio
     ================================================================ */

  document.addEventListener('pointerdown', () => MM.sound.unlock(), { once: true });
  if (S.profile) S.avatarSel = S.profile.avatar;
  else {
    const r = MM.randomIdentity();
    S.avatarSel = r.avatar;
  }
  if (S.profile) $('#name').value = S.profile.name;
  buildAvatarGrid();
  MM.stickersReady.then(() => S.inApp && renderMsgs());
  render();
})();
