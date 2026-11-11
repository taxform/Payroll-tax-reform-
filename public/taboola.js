/* Taboola conversion support.
 * Remembers the Taboola click ID (?tblci=...) for 30 days, copies it into a hidden
 * "tblci" field on every form so the server can report leads, and exposes
 * window.taboolaConversion(event) for browser-triggered conversions (calculator use). */
(function () {
  var KEY = 'tblci', DAYS = 30;
  var valid = function (v) { return typeof v === 'string' && /^[A-Za-z0-9_\-.~%=]{8,512}$/.test(v); };

  function read() {
    var m = document.cookie.match(/(?:^|;\s*)tblci=([^;]+)/);
    if (m && valid(m[1])) return m[1];
    try { var s = localStorage.getItem(KEY); if (valid(s)) return s; } catch (e) {}
    return null;
  }

  var fromUrl = new URLSearchParams(location.search).get(KEY);
  if (valid(fromUrl)) {
    document.cookie = KEY + '=' + fromUrl + '; Max-Age=' + DAYS * 86400 + '; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    try { localStorage.setItem(KEY, fromUrl); } catch (e) {}
  }

  function fill(form) {
    var id = read();
    if (!id || !form || form.nodeName !== 'FORM') return;
    var field = form.querySelector('input[name="tblci"]');
    if (!field) { field = document.createElement('input'); field.type = 'hidden'; field.name = 'tblci'; form.appendChild(field); }
    field.value = id;
  }

  // Capture phase so the value is set before any page script serializes the form.
  document.addEventListener('submit', function (e) { fill(e.target); }, true);
  document.addEventListener('DOMContentLoaded', function () { document.querySelectorAll('form').forEach(fill); });

  window.taboolaConversion = function (event) {
    var id = read();
    if (!id) return;
    var once = 'tblci-sent-' + event;
    try { if (sessionStorage.getItem(once)) return; sessionStorage.setItem(once, '1'); } catch (e) {}
    fetch('/api/taboola/conversion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: event, clickId: id }),
      keepalive: true
    }).catch(function () {});
  };
})();
