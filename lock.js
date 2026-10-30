// Écran du mot de passe de la version en ligne de Genre Radar. La page, son script et les données y sont
// chiffrés : le mot de passe donne, par PBKDF2-SHA256, une clé AES-256-CTR et une clé HMAC-SHA256.
// Chaque fichier chiffré : nonce (16 octets) + données gzip chiffrées + HMAC du tout (32 octets).
(() => {
  const LOCK = window.GENRE_RADAR_LOCK;
  const STORE = 'genre-radar-key';
  const form = document.getElementById('site-lock');
  const input = form.elements.password;
  const remember = form.elements.remember;
  const button = form.querySelector('button');
  const status = form.querySelector('.site-lock-status');

  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));

  async function keysFrom(raw) {
    return {
      raw,
      enc: await crypto.subtle.importKey('raw', raw.slice(0, 32), 'AES-CTR', false, ['decrypt']),
      mac: await crypto.subtle.importKey('raw', raw.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']),
    };
  }

  async function derive(password) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromB64(LOCK.salt), iterations: LOCK.iterations, hash: 'SHA-256' }, base, 512);
    return keysFrom(new Uint8Array(bits));
  }

  async function open(keys, file) {
    // no-cache : le navigateur redemande si le fichier a changé (réponse courte s'il n'a pas changé), sinon
    // GitHub Pages laisse servir l'ancienne version jusqu'à 10 minutes après une mise à jour.
    const r = await fetch(file, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    const buf = new Uint8Array(await r.arrayBuffer());
    const end = buf.length - 32;
    if (!(await crypto.subtle.verify('HMAC', keys.mac, buf.subarray(end), buf.subarray(0, end)))) throw new Error('wrong-password');
    const zipped = await crypto.subtle.decrypt({ name: 'AES-CTR', counter: buf.subarray(0, 16), length: 64 }, keys.enc, buf.subarray(16, end));
    return new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('could not load ' + src));
      document.body.appendChild(s);
    });
  }

  async function unlock(keys) {
    const app = JSON.parse(await open(keys, 'app.bin'));
    window.GENRE_RADAR_SOURCES = app.sources;
    window.GENRE_RADAR_PARAMS = app.params;
    window.GENRE_RADAR_READ = (file) => open(keys, file);
    await loadScript('dash-shim.js');
    form.remove();
    document.getElementById('dash-root').innerHTML = app.html;
    const url = URL.createObjectURL(new Blob([app.js], { type: 'text/javascript' }));
    await loadScript(url);
    URL.revokeObjectURL(url);
    // Les fichiers de données se téléchargent déchiffrés, en CSV.
    document.addEventListener('click', async (e) => {
      const a = e.target.closest('a[data-locked-file]');
      if (!a) return;
      e.preventDefault();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([await open(keys, a.dataset.lockedFile)], { type: 'text/csv' }));
      link.download = a.dataset.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    status.classList.remove('is-error');
    status.textContent = 'Opening…';
    try {
      const keys = await derive(input.value);
      await unlock(keys);
      if (remember.checked) try { localStorage.setItem(STORE, toB64(keys.raw)); } catch (_) { /* pas de stockage */ }
    } catch (err) {
      button.disabled = false;
      status.classList.add('is-error');
      status.textContent = err.message === 'wrong-password' ? 'Wrong password.' : 'Could not open the site: ' + err.message;
      input.select();
    }
  });

  // Une clé gardée sur cet appareil ouvre le site directement ; si le mot de passe a changé, on l'oublie.
  (async () => {
    let saved = null;
    try { saved = localStorage.getItem(STORE); } catch (_) { /* pas de stockage */ }
    if (saved) {
      try { await unlock(await keysFrom(fromB64(saved))); return; } catch (err) {
        if (err.message === 'wrong-password') try { localStorage.removeItem(STORE); } catch (_) { /* pas de stockage */ }
      }
    }
    form.hidden = false;
    input.focus();
  })();
})();
