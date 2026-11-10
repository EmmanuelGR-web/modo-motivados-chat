/* Aplica el tema guardado (o el del sistema) antes de pintar, para evitar parpadeos */
(function () {
  var t = null;
  try { t = localStorage.getItem('mm_theme'); } catch (e) { /* sin storage */ }
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
