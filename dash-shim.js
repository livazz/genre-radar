// Remplaçant autonome du moteur de tableaux de bord de Claude, pour publier Genre Radar comme un site
// statique (GitHub Pages). Il fournit le même objet `dash` que radar.js utilise : sources chargées
// depuis des fichiers CSV, calculs, dessins, filtres et liens.
(() => {
  const SOURCES = window.GENRE_RADAR_SOURCES || {};
  const datasets = new Map();   // id -> {status, data, message, columns}
  const calcs = new Map();      // id -> {inputs, fn, cacheKey, result}
  const draws = new Map();      // name -> fn
  const onDataFns = [];
  let params = Object.assign({}, window.GENRE_RADAR_PARAMS || {});
  const defaults = Object.assign({}, params);
  let scheduled = false;
  let drawing = false;

  function fetchText(file) {
    return fetch(file).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.text(); });
  }

  function load(id) {
    const src = SOURCES[id];
    if (!src) { datasets.set(id, { status: 'missing', data: [], message: 'Unknown source ' + id }); return; }
    datasets.set(id, { status: 'loading', data: [] });
    // La version en ligne fournit GENRE_RADAR_READ, qui déchiffre les fichiers (voir lock.js).
    (window.GENRE_RADAR_READ || fetchText)(src.file)
      .then((text) => {
        const rows = d3.csvParse(text);
        datasets.set(id, { status: 'ok', data: rows, columns: rows.columns });
        schedule();
      })
      .catch((e) => { console.error('Genre Radar: could not load ' + id, e); datasets.set(id, { status: 'error', data: [], message: String(e.message || e) }); schedule(); });
  }

  function data(id) {
    if (calcs.has(id)) return calcData(id);
    if (!datasets.has(id)) load(id);
    const d = datasets.get(id);
    return { status: d.status, data: d.data, columns: d.columns || [], message: d.message, refreshing: false, meta: [] };
  }

  function calcData(id) {
    const c = calcs.get(id);
    const inputs = c.inputs.map((i) => data(i));
    const bad = inputs.find((d) => d.status !== 'ok');
    if (bad) return { status: bad.status === 'loading' ? 'loading' : 'error', data: [], message: bad.message };
    const key = inputs.map((d) => d.data);
    if (!c.cacheKey || c.cacheKey.some((k, i) => k !== key[i])) {
      try {
        c.result = c.fn(...inputs.map((d) => d.data));
        c.error = null;
      } catch (e) {
        c.result = [];
        c.error = String(e);
      }
      c.cacheKey = key;
    }
    return c.error ? { status: 'error', data: [], message: c.error } : { status: 'ok', data: c.result, columns: [], meta: [] };
  }

  function visible(el) {
    return !el.closest('[hidden]');
  }

  function runDraw(name) {
    const fn = draws.get(name);
    if (!fn) return;
    for (const el of document.querySelectorAll(`[data-draw="${CSS.escape(name)}"]`)) {
      if (!visible(el)) continue;
      try { fn(el); } catch (e) { console.error('Drawing ' + name + ' failed', e); }
    }
  }

  function redraw() {
    scheduled = false;
    drawing = true;
    try {
      for (const fn of onDataFns) { try { fn(); } catch (e) { console.error(e); } }
      for (const name of draws.keys()) runDraw(name);
    } finally {
      drawing = false;
    }
  }

  // Un minuteur plutôt que requestAnimationFrame, que certains navigateurs suspendent (onglet en arrière-plan,
  // fenêtre masquée) : la page se redessinerait alors jamais.
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(redraw, 16);
  }

  window.dash = {
    data,
    calc(id, spec) { calcs.set(id, { inputs: spec.inputs || [], fn: spec.fn, title: spec.title, description: spec.description }); },
    loader() {},
    draw(name, fn) {
      if (typeof fn === 'function') { draws.set(name, fn); schedule(); return; }
      if (fn && typeof fn === 'object' && fn.update) { draws.set(name, (el) => fn.update(el, fn.mount ? fn.mount(el) : null)); schedule(); return; }
      if (drawing || !scheduled) runDraw(name);
    },
    onData(fn) { onDataFns.push(fn); schedule(); },
    params() { return Object.assign({}, params); },
    setParams(p) {
      for (const [k, v] of Object.entries(p)) params[k] = v;
      schedule();
    },
    resetParams() { params = Object.assign({}, defaults); schedule(); },
    setLink(name) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* lien non mis à jour */ } },
    refresh() { schedule(); },
    // Recharger une source qui a échoué.
    retry(id) { datasets.delete(id); for (const c of calcs.values()) c.cacheKey = null; schedule(); },
    colors: ['#3b82f6', '#22a35a', '#8b5cf6', '#eab308', '#f97316', '#e11d48', '#14b8a6', '#94a3b8'],
  };

  // Une section qui s'affiche, ou une largeur qui change, redessine ce qui est devenu visible.
  // On ignore les écritures qui ne changent rien (la page remet souvent hidden à la même valeur).
  new MutationObserver((records) => {
    if (records.some((r) => r.oldValue !== r.target.getAttribute('hidden'))) schedule();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true, subtree: true });
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; schedule(); } });
})();
