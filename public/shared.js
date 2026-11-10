/* Utilidades compartidas entre la vista de oyentes y el panel de expositores */
(function () {
  'use strict';

  const MM = (window.MM = {});

  /* ---------- Mini helper para crear DOM sin innerHTML ---------- */
  MM.h = function (tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  };
  const h = MM.h;

  /* ---------- Avatares estilo Kahoot ---------- */
  // [emoji, color 1, color 2, nombre para generar apodos]
  MM.AVATARS = [
    ['🦊', '#ffb347', '#ff5a1f', 'Zorro'],
    ['🐼', '#f4f7fb', '#8aa0b8', 'Panda'],
    ['🐸', '#d4ff4d', '#2bd97c', 'Rana'],
    ['🐯', '#ffd34d', '#ff8a1f', 'Tigre'],
    ['🦄', '#ff8ae8', '#8a5cff', 'Unicornio'],
    ['🐙', '#ff6bd6', '#7a2bff', 'Pulpo'],
    ['🦁', '#ffe07a', '#d98a1f', 'León'],
    ['🐵', '#d9a066', '#8a4f1f', 'Mono'],
    ['🐰', '#ffc2e8', '#ff6bb0', 'Conejo'],
    ['🐨', '#b9c7d6', '#5f7a96', 'Koala'],
    ['🐮', '#7af0e6', '#1fa8b8', 'Vaca'],
    ['🐷', '#ffc2d1', '#ff6b8f', 'Chancho'],
    ['🦉', '#c3a6ff', '#6a3fd9', 'Búho'],
    ['🐲', '#9dffb0', '#00b8d9', 'Dragón'],
    ['🐧', '#7ad8ff', '#2b6bff', 'Pingüino'],
    ['🦖', '#c8ff5c', '#3fb83f', 'Dino'],
  ];
  const ADJ = ['Veloz', 'Crack', 'Genio', 'Épico', 'Feliz', 'Astuto', 'Pro', 'Capo', 'Turbo', 'Nitro', 'Neón', 'Ninja'];

  MM.randomIdentity = function () {
    const avatar = Math.floor(Math.random() * MM.AVATARS.length);
    const name = MM.AVATARS[avatar][3] + ' ' + ADJ[Math.floor(Math.random() * ADJ.length)];
    return { avatar, name };
  };

  MM.avatar = function (idx, size) {
    size = size || 40;
    const isHost = idx === 'host';
    const a = isHost ? ['👑', '#ffe27a', '#ff9d2e'] : MM.AVATARS[idx] || MM.AVATARS[0];
    return h(
      'span',
      {
        class: 'avatar' + (isHost ? ' host' : ''),
        style: {
          width: size + 'px',
          height: size + 'px',
          fontSize: Math.round(size * 0.56) + 'px',
          background: `linear-gradient(145deg, ${a[1]}, ${a[2]})`,
        },
        'aria-hidden': 'true',
      },
      a[0]
    );
  };

  const NEON = ['#00e5ff', '#b6ff00', '#ff2bd6', '#ffd34d', '#8ab4ff', '#ff8a5c', '#7dffb3', '#d28bff'];
  MM.colorFor = function (key) {
    let n = 0;
    for (const ch of String(key)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return NEON[n % NEON.length];
  };

  MM.colorIdx = function (key) {
    let n = 0;
    for (const ch of String(key)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return n % NEON.length;
  };

  /* ---------- Tema claro / oscuro ---------- */
  MM.theme = {
    get() {
      return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    },
    apply(t) {
      document.documentElement.setAttribute('data-theme', t);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t === 'light' ? '#f4f1ff' : '#05010f');
      document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
        const toLight = t === 'dark';
        b.textContent = toLight ? '☀️' : '🌙';
        b.title = b.dataset.label = toLight ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
        b.setAttribute('aria-label', b.title);
      });
    },
    set(t) {
      this.apply(t);
      try { localStorage.setItem('mm_theme', t); } catch (e) { /* ignore */ }
    },
    toggle() {
      this.set(this.get() === 'dark' ? 'light' : 'dark');
    },
    init() {
      this.apply(this.get());
      document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => this.toggle()));
      // si el usuario nunca eligió, seguir los cambios del sistema
      if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: light)');
        const follow = (e) => {
          let saved = null;
          try { saved = localStorage.getItem('mm_theme'); } catch (err) { /* ignore */ }
          if (saved !== 'light' && saved !== 'dark') this.apply(e.matches ? 'light' : 'dark');
        };
        if (mq.addEventListener) mq.addEventListener('change', follow);
      }
    },
  };
  document.addEventListener('DOMContentLoaded', () => MM.theme.init());

  MM.fmtTime = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  MM.fmtDuration = function (ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return (hh ? hh + ':' : '') + mm + ':' + ss;
  };

  /* ---------- Preferencias locales ---------- */
  MM.prefs = {
    _d: null,
    load() {
      if (this._d) return this._d;
      try {
        this._d = JSON.parse(localStorage.getItem('mm_prefs') || '{}');
      } catch (e) {
        this._d = {};
      }
      this._d.sound = this._d.sound !== false;
      this._d.muted = Array.isArray(this._d.muted) ? this._d.muted : [];
      this._d.recent = Array.isArray(this._d.recent) ? this._d.recent : [];
      return this._d;
    },
    save() {
      try {
        localStorage.setItem('mm_prefs', JSON.stringify(this._d));
      } catch (e) {
        /* sin storage: no pasa nada */
      }
    },
  };

  /* ---------- Sonidos de notificación (WebAudio, sin archivos) ---------- */
  MM.sound = {
    ctx: null,
    last: 0,
    unlock() {
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) {
        /* navegador sin audio */
      }
    },
    tone(freq, start, dur, type, vol) {
      const c = this.ctx;
      const t0 = c.currentTime + start;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },
    play(kind) {
      if (!MM.prefs.load().sound || !this.ctx || this.ctx.state !== 'running') return;
      const now = Date.now();
      if (now - this.last < 350) return; // evita ráfagas
      this.last = now;
      if (kind === 'dm') {
        // doble "plin" al estilo Messenger
        this.tone(1046, 0, 0.18, 'sine', 0.2);
        this.tone(1568, 0.11, 0.3, 'sine', 0.2);
      } else if (kind === 'alert') {
        this.tone(660, 0, 0.14, 'triangle', 0.2);
        this.tone(880, 0.13, 0.14, 'triangle', 0.2);
        this.tone(1320, 0.26, 0.26, 'triangle', 0.2);
      } else {
        // "pop" suave
        this.tone(880, 0, 0.12, 'sine', 0.14);
        this.tone(1318, 0.05, 0.14, 'sine', 0.1);
      }
    },
  };

  /* ---------- Stickers ---------- */
  MM.stickers = [];
  MM.stickerMap = {};
  MM.stickersReady = fetch('/stickers.json')
    .then((r) => r.json())
    .then((list) => {
      MM.stickers = list;
      list.forEach((s) => (MM.stickerMap[s.id] = s));
    })
    .catch(() => {});

  MM.stickerEl = function (id, small) {
    const s = MM.stickerMap[id] || { emoji: '❔', text: '', c1: '#444', c2: '#222' };
    return h(
      'span',
      { class: 'sticker' + (small ? ' sm' : ''), style: { background: `linear-gradient(145deg, ${s.c1}, ${s.c2})` } },
      h('span', { class: 'st-emoji', text: s.emoji }),
      h('span', { class: 'st-text', text: s.text })
    );
  };

  /* ---------- Emojis (set Unicode estándar, el mismo que usa WhatsApp) ---------- */
  const E = {
    '😀': '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 👽 👾 🤖 🎃',
    '👍': '👋 🤚 🖐️ ✋ 🖖 👌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👅 👄 🙋 🙆 🙅 🤷 🤦 🙇 💃 🕺',
    '❤️': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💯 💢 💥 💫 💦 💨 🔥 ⭐ 🌟 ✨ ⚡ 🎉 🎊 👑 💎',
    '🐶': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦎 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐘 🦒 🐑 🐐 🐕 🐈 🌵 🌲 🌴 🌱 🌿 🍀 🌸 🌹 🌻 🌞 🌝 🌈 ☁️ ⛄ 🌊',
    '🍕': '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🌽 🥕 🥔 🍞 🥐 🧀 🥚 🍳 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🍝 🍜 🍣 🍤 🍦 🍩 🍪 🎂 🍰 🍫 🍬 🍭 ☕ 🍵 🧉 🍺 🍻 🥂 🍷 🥤',
    '⚽': '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🥊 🎮 🕹️ 🎲 🎯 🎳 🎸 🎹 🎧 🎤 🎬 🎨 🏆 🥇 🥈 🥉 🏅 🚀 ✈️ 🚗 🚲',
    '💡': '💻 🖥️ ⌨️ 🖱️ 📱 ☎️ 📷 📺 📚 📖 📝 ✏️ 📌 📎 ✂️ 🔒 🔑 💡 🔋 🔌 ⏰ ⌛ 💰 💳 🎁 🎈 🔔 📢 📣 🔍 ⚙️ 🧰',
    '✅': '✅ ❌ ⭕ ❗ ❓ ‼️ ⚠️ 🚫 ➕ ➖ ➡️ ⬅️ ⬆️ ⬇️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ ▶️ ⏸️ ⏹️ 🔁 💬 💭 🆗 🆒 🆕 🔝',
  };

  /**
   * Panel de emojis + stickers.
   * opts: { onEmoji(emoji), onSticker(id) }
   */
  MM.createPicker = function (opts) {
    const root = h('div', { class: 'picker hidden' });
    const tabs = h('div', { class: 'picker-tabs' });
    const body = h('div', { class: 'picker-body' });
    root.append(tabs, body);

    let mode = 'emoji';
    let cat = '😀';

    const bEmoji = h('button', { type: 'button', class: 'ptab on', text: '😀 Emojis' });
    const bSticker = h('button', { type: 'button', class: 'ptab', text: '🏷️ Stickers' });
    tabs.append(bEmoji, bSticker);

    function render() {
      body.replaceChildren();
      bEmoji.classList.toggle('on', mode === 'emoji');
      bSticker.classList.toggle('on', mode === 'sticker');
      if (mode === 'sticker') {
        const grid = h('div', { class: 'sticker-grid' });
        MM.stickers.forEach((s) =>
          grid.append(
            h(
              'button',
              {
                type: 'button',
                class: 'sticker-btn',
                title: s.text,
                onclick: () => {
                  opts.onSticker && opts.onSticker(s.id);
                  root.classList.add('hidden');
                },
              },
              MM.stickerEl(s.id, true)
            )
          )
        );
        body.append(grid);
        return;
      }
      const cats = h('div', { class: 'emoji-cats' });
      const recent = MM.prefs.load().recent;
      const keys = (recent.length ? ['🕘'] : []).concat(Object.keys(E));
      keys.forEach((k) =>
        cats.append(
          h('button', {
            type: 'button',
            class: 'ecat' + (k === cat ? ' on' : ''),
            text: k,
            onclick: () => {
              cat = k;
              render();
            },
          })
        )
      );
      const list = cat === '🕘' ? recent : (E[cat] || E['😀']).split(' ');
      const grid = h('div', { class: 'emoji-grid' });
      list.forEach((em) =>
        grid.append(
          h('button', {
            type: 'button',
            class: 'emoji-btn',
            text: em,
            onclick: () => {
              const p = MM.prefs.load();
              p.recent = [em].concat(p.recent.filter((x) => x !== em)).slice(0, 24);
              MM.prefs.save();
              opts.onEmoji && opts.onEmoji(em);
            },
          })
        )
      );
      body.append(cats, grid);
    }

    bEmoji.onclick = () => ((mode = 'emoji'), render());
    bSticker.onclick = () => ((mode = 'sticker'), render());

    root.toggle = function () {
      const open = root.classList.toggle('hidden') === false;
      if (open) {
        if (cat === '🕘' && !MM.prefs.load().recent.length) cat = '😀';
        render();
      }
      return open;
    };
    root.close = () => root.classList.add('hidden');
    MM.stickersReady.then(() => {
      if (mode === 'sticker') render();
    });
    return root;
  };

  /* ---------- Toasts, hojas de acciones y confirmaciones ---------- */
  MM.toast = function (msg, ms, key) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = h('div', { id: 'toasts', 'aria-live': 'polite' });
      document.body.append(box);
    }
    // con "key" un aviso nuevo reemplaza al anterior del mismo tipo (evita apilar)
    if (key) box.querySelectorAll('[data-key="' + key + '"]').forEach((e) => e.remove());
    const t = h('div', { class: 'toast', text: msg, 'data-key': key || null });
    box.append(t);
    setTimeout(() => t.classList.add('out'), ms || 2800);
    setTimeout(() => t.remove(), (ms || 2800) + 400);
  };

  MM.sheet = function (cfg) {
    const close = () => back.remove();
    const items = cfg.items.map((it) =>
      it.sep
        ? h('div', { class: 'sheet-sep', text: it.sep })
        : h(
            'button',
            {
              type: 'button',
              class: 'sheet-item' + (it.danger ? ' danger' : ''),
              onclick: () => {
                close();
                it.onClick && it.onClick();
              },
            },
            h('span', { class: 'si-ico', text: it.icon || '' }),
            h('span', { class: 'si-label', text: it.label })
          )
    );
    const back = h(
      'div',
      { class: 'sheet-back', onclick: (e) => e.target === back && close() },
      h(
        'div',
        { class: 'sheet', role: 'dialog' },
        h(
          'div',
          { class: 'sheet-head' },
          cfg.avatar !== undefined ? MM.avatar(cfg.avatar, 44) : null,
          h('div', { class: 'sheet-title' }, h('strong', { text: cfg.title }), cfg.subtitle ? h('small', { text: cfg.subtitle }) : null),
          h('button', { type: 'button', class: 'sheet-x', 'aria-label': 'Cerrar', text: '✕', onclick: close })
        ),
        h('div', { class: 'sheet-items' }, items)
      )
    );
    document.body.append(back);
    return close;
  };

  MM.confirm = function (title, text, okLabel) {
    return new Promise((resolve) => {
      const done = (v) => {
        back.remove();
        resolve(v);
      };
      const back = h(
        'div',
        { class: 'sheet-back center', onclick: (e) => e.target === back && done(false) },
        h(
          'div',
          { class: 'sheet confirm', role: 'alertdialog' },
          h('h3', { text: title }),
          h('p', { text }),
          h(
            'div',
            { class: 'confirm-btns' },
            h('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancelar', onclick: () => done(false) }),
            h('button', { type: 'button', class: 'btn btn-danger', text: okLabel || 'Confirmar', onclick: () => done(true) })
          )
        )
      );
      document.body.append(back);
    });
  };

  MM.clientId = function () {
    let id = null;
    try {
      id = localStorage.getItem('mm_client');
    } catch (e) {
      /* ignore */
    }
    if (!id) {
      const a = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(a);
      id = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
      try {
        localStorage.setItem('mm_client', id);
      } catch (e) {
        /* ignore */
      }
    }
    return id;
  };
})();
