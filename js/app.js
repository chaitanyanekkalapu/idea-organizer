// Idea Organizer UI. Four tabs (Home, Ask, Memories, Reminders) plus bottom
// sheets for capture, detail and edit. All data comes from DB, all "smart"
// output from Smart.analyze().
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const view = $('#view');

  const state = {
    tab: 'memories',
    notes: [],
    folder: 'All',
    query: '',
    filterTag: '',
    filterType: '',
    remTab: 'upcoming',
    askQuery: '',
    settings: { lang: 'en-IN', keepAudio: false },
  };

  // ---------- helpers -------------------------------------------------------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const time = d => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  const shortDate = ts => { const d = new Date(ts); return `${ord(d.getDate())} ${MON[d.getMonth()]}`; };
  const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const DAY_MS = 86400000;

  function dayLabel(ts) {
    const d = new Date(ts);
    const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY_MS);
    const name = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : DAY[d.getDay()];
    return `${name} <span>· ${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}</span>`;
  }

  function whenLabel(due) {
    if (!due) return 'No date';
    const d = new Date(due);
    const diff = Math.round((startOfDay(due) - startOfDay(Date.now())) / DAY_MS);
    const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday'
      : diff > 1 && diff < 7 ? DAY[d.getDay()] : `${ord(d.getDate())} ${MON[d.getMonth()]}`;
    return `${day}, ${time(d)}`;
  }

  const durLabel = sec => sec >= 60 ? `${Math.round(sec / 60)} min${Math.round(sec / 60) > 1 ? 's' : ''}` : `${Math.max(1, Math.round(sec))} sec`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, ms);
  }

  const blobUrls = new Map();
  async function blobUrl(id) {
    if (!blobUrls.has(id)) {
      const b = await DB.getBlob(id);
      if (!b) return '';
      blobUrls.set(id, URL.createObjectURL(b));
    }
    return blobUrls.get(id);
  }
  // Fill every <img data-blob> / <audio data-blob> / <a data-blob> after render.
  async function hydrateBlobs(root) {
    for (const el of $$('[data-blob]', root)) {
      const url = await blobUrl(el.dataset.blob);
      if (el.tagName === 'A') el.href = url; else el.src = url;
    }
  }

  const ICONS = {
    voice: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    photo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    filter: '<svg viewBox="0 0 24 24"><path d="M4 5h16l-6 8v5l-4 2v-7z"/></svg>',
    layers: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5z" fill="currentColor"/><path d="M3 13l9 5 9-5"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke-width:3"><path d="M5 12l5 5 9-10"/></svg>',
    cal: '<svg viewBox="0 0 24 24" style="width:18px;height:18px"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>',
  };

  // ---------- data ----------------------------------------------------------
  async function load() {
    state.notes = await DB.allNotes();
    state.settings.lang = await DB.getSetting('lang', 'en-IN');
    state.settings.keepAudio = await DB.getSetting('keepAudio', false);
  }

  function folders() {
    const counts = {};
    for (const n of state.notes) counts[n.folder || 'Inbox'] = (counts[n.folder || 'Inbox'] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }

  function allTags() {
    const counts = {};
    for (const n of state.notes) for (const t of n.tags || []) counts[t] = (counts[t] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  }

  function allReminders() {
    const out = [];
    for (const n of state.notes) for (const r of n.reminders || []) out.push({ ...r, note: n });
    return out;
  }

  async function saveNote(note) {
    note.updatedAt = Date.now();
    await DB.putNote(note);
    const i = state.notes.findIndex(n => n.id === note.id);
    if (i >= 0) state.notes[i] = note; else state.notes.unshift(note);
    state.notes.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---------- tabs ----------------------------------------------------------
  function setTab(tab) {
    state.tab = tab;
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    try { localStorage.setItem('tab', tab); } catch (e) {}
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    ({ home: renderHome, ask: renderAsk, memories: renderMemories, reminders: renderReminders })[state.tab]();
  }

  function cardHTML(n) {
    const rems = (n.reminders || []).filter(r => !r.done).length;
    const meta = [shortDate(n.createdAt), time(new Date(n.createdAt))];
    if (n.type === 'voice' && n.duration) meta.push(durLabel(n.duration));
    else if (n.type !== 'text') meta.push(n.type.charAt(0).toUpperCase() + n.type.slice(1));
    const img = (n.attachments || []).find(a => a.kind === 'image');
    return `<button class="card" data-open="${n.id}">
      <div class="meta">${meta.map(esc).join(' • ')}</div>
      <h3>${esc(n.title || 'Untitled memory')}</h3>
      ${rems || (n.tags || []).length ? `<div class="chips">${rems ? `<span class="chip">${plural(rems, 'Reminder')}</span>` : ''}${(n.tags || []).slice(0, 3).map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${n.summary ? `<p>${esc(n.summary)}</p>` : ''}
      ${img ? `<img class="thumb" alt="" data-blob="${img.blobId}">` : ''}
    </button>`;
  }

  function listHTML(notes) {
    let html = '';
    let lastDay = null;
    for (const n of notes) {
      const d = startOfDay(n.createdAt);
      if (d !== lastDay) { html += `<div class="day">${dayLabel(n.createdAt)}</div>`; lastDay = d; }
      html += cardHTML(n);
    }
    return html;
  }

  function bindCards(root = view) {
    $$('[data-open]', root).forEach(b => b.onclick = () => openDetail(b.dataset.open));
    hydrateBlobs(root);
  }

  // ---------- Home ----------------------------------------------------------
  function renderHome() {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const rems = allReminders().filter(r => !r.done);
    const weekAgo = Date.now() - 7 * DAY_MS;
    const due = rems.filter(r => r.due).sort((a, b) => a.due - b.due).slice(0, 3);
    view.innerHTML = `
      <div class="top"><h1>${greet}</h1><div class="grow"></div>
        <button class="round-btn" id="more" aria-label="More">${ICONS.dots}</button></div>
      <div class="stats">
        <div class="stat"><b>${state.notes.length}</b><span>Memories</span></div>
        <div class="stat"><b>${rems.length}</b><span>Open reminders</span></div>
        <div class="stat"><b>${state.notes.filter(n => n.createdAt > weekAgo).length}</b><span>This week</span></div>
      </div>
      <div class="hero">
        <button class="mic-big" id="bigmic" aria-label="Record a voice memory">${ICONS.voice}</button>
        <p>Tap to capture an idea by voice</p>
      </div>
      <div class="quick">
        <button data-cap="text">${ICONS.text}Type</button>
        <button data-cap="photo">${ICONS.photo}Photo</button>
        <button data-cap="link">${ICONS.link}Link</button>
        <button data-cap="file">${ICONS.file}File</button>
      </div>
      ${due.length ? `<div class="section-title">Coming up <button data-go="reminders">All reminders</button></div>
        ${due.map(remHTML).join('')}` : ''}
      <div class="section-title">Recent <button data-go="memories">See all</button></div>
      ${state.notes.length ? state.notes.slice(0, 3).map(cardHTML).join('') : emptyHTML('Your memories will show up here.')}
    `;
    $('#bigmic').onclick = () => openCapture('voice', true);
    $$('[data-cap]').forEach(b => b.onclick = () => openCapture(b.dataset.cap));
    $$('[data-go]').forEach(b => b.onclick = () => setTab(b.dataset.go));
    $('#more').onclick = openMoreMenu;
    bindReminders();
    bindCards();
  }

  function emptyHTML(msg) {
    return `<div class="empty">${ICONS.layers}<p>${esc(msg)}</p></div>`;
  }

  // ---------- Memories ------------------------------------------------------
  function filteredNotes() {
    const q = state.query.trim().toLowerCase();
    return state.notes.filter(n => {
      if (state.folder !== 'All' && (n.folder || 'Inbox') !== state.folder) return false;
      if (state.filterTag && !(n.tags || []).includes(state.filterTag)) return false;
      if (state.filterType && n.type !== state.filterType) return false;
      if (q) {
        const hay = [n.title, n.summary, n.body, (n.tags || []).join(' '), n.folder, (n.links || []).join(' ')].join(' ').toLowerCase();
        if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
      }
      return true;
    });
  }

  function renderMemories() {
    const list = filteredNotes();
    const filtering = state.filterTag || state.filterType;
    view.innerHTML = `
      <div class="top">
        <button class="folder-btn" id="folderBtn"><span class="ic">${ICONS.layers}</span>
          <h1>${esc(state.folder)} <small>${list.length}</small></h1>
          <svg viewBox="0 0 24 24" style="width:20px;color:var(--muted)"><path d="M6 9l6 6 6-6"/></svg></button>
        <div class="grow"></div>
        <button class="round-btn" id="more" aria-label="More">${ICONS.dots}</button>
      </div>
      <div class="search-row">
        <label class="search">${ICONS.search}<input id="q" type="search" placeholder="Find memories" value="${esc(state.query)}" autocomplete="off"></label>
        <button class="square-btn ${filtering ? 'on' : ''}" id="filterBtn" aria-label="Filter">${ICONS.filter}</button>
      </div>
      <div id="list">${list.length ? listHTML(list) : emptyHTML(state.notes.length ? 'Nothing matches. Try another word or clear the filter.' : 'No memories yet. Tap + to capture your first idea.')}</div>
    `;
    const q = $('#q');
    q.oninput = () => {
      state.query = q.value;
      const l = filteredNotes();
      $('#list').innerHTML = l.length ? listHTML(l) : emptyHTML('Nothing matches. Try another word.');
      $('.top h1 small').textContent = l.length;
      bindCards($('#list'));
    };
    $('#folderBtn').onclick = openFolderMenu;
    $('#filterBtn').onclick = openFilter;
    $('#more').onclick = openMoreMenu;
    bindCards();
  }

  function openFolderMenu() {
    const fs = folders();
    openSheet(`<h2>Folders</h2><div class="menu-list">
      <button data-f="All" class="${state.folder === 'All' ? 'on' : ''}">${ICONS.layers} All<span class="count">${state.notes.length}</span></button>
      ${fs.map(([f, c]) => `<button data-f="${esc(f)}" class="${state.folder === f ? 'on' : ''}">${ICONS.file} ${esc(f)}<span class="count">${c}</span></button>`).join('')}
    </div><p class="muted small">New notes are filed by topic automatically. Open a memory and tap Edit to move it.</p>`, body => {
      $$('[data-f]', body).forEach(b => b.onclick = () => { state.folder = b.dataset.f; closeSheet(); render(); });
    });
  }

  function openFilter() {
    const tags = allTags();
    const types = ['voice', 'text', 'photo', 'link', 'file'];
    openSheet(`<h2>Filter</h2>
      <label class="field">Type</label>
      <div class="chips">${types.map(t => `<button class="chip ${state.filterType === t ? '' : 'tag'}" data-type="${t}">${t}</button>`).join('')}</div>
      <label class="field">Tag</label>
      <div class="chips">${tags.length ? tags.map(t => `<button class="chip ${state.filterTag === t ? '' : 'tag'}" data-tag="${esc(t)}">${esc(t)}</button>`).join('') : '<span class="muted small">No tags yet</span>'}</div>
      <div class="row end"><button class="btn ghost" id="clr">Clear</button><button class="btn" id="done">Done</button></div>`, body => {
      $$('[data-type]', body).forEach(b => b.onclick = () => { state.filterType = state.filterType === b.dataset.type ? '' : b.dataset.type; openFilter(); });
      $$('[data-tag]', body).forEach(b => b.onclick = () => { state.filterTag = state.filterTag === b.dataset.tag ? '' : b.dataset.tag; openFilter(); });
      $('#clr', body).onclick = () => { state.filterTag = ''; state.filterType = ''; closeSheet(); render(); };
      $('#done', body).onclick = () => { closeSheet(); render(); };
    }, true);
  }

  // ---------- Reminders -----------------------------------------------------
  function remHTML(r) {
    const overdue = r.due && !r.done && r.due < Date.now();
    return `<div class="rem ${r.done ? 'done' : ''}">
      <button class="check" data-toggle="${r.note.id}|${r.id}" aria-label="${r.done ? 'Mark not done' : 'Mark done'}">${r.done ? ICONS.check : ''}</button>
      <div class="rem-body">
        <div class="rem-text">${esc(r.text)}</div>
        <div class="rem-when ${overdue ? 'overdue' : ''}">${overdue ? 'Overdue · ' : ''}${esc(whenLabel(r.due))}</div>
        <button class="rem-src" data-open="${r.note.id}">${esc(r.note.title || 'Open memory')}</button>
      </div>
      ${r.due && !r.done ? `<a class="icon-btn" href="${calendarUrl(r)}" target="_blank" rel="noopener" aria-label="Add to Google Calendar">${ICONS.cal}</a>` : ''}
    </div>`;
  }

  function calendarUrl(r) {
    const f = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const p = new URLSearchParams({ action: 'TEMPLATE', text: r.text, dates: `${f(r.due)}/${f(r.due + 30 * 60000)}`, details: r.note.title || '' });
    return 'https://calendar.google.com/calendar/render?' + p;
  }

  function bindReminders(root = view) {
    $$('[data-toggle]', root).forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const [nid, rid] = b.dataset.toggle.split('|');
      const note = state.notes.find(n => n.id === nid);
      const r = note && note.reminders.find(x => x.id === rid);
      if (!r) return;
      r.done = !r.done;
      await saveNote(note);
      if (r.done) toast('Done ✓');
      render();
    });
  }

  function renderReminders() {
    const all = allReminders();
    const open = all.filter(r => !r.done);
    const sets = {
      upcoming: open.filter(r => r.due).sort((a, b) => a.due - b.due),
      nodate: open.filter(r => !r.due).sort((a, b) => b.note.createdAt - a.note.createdAt),
      done: all.filter(r => r.done).sort((a, b) => b.note.createdAt - a.note.createdAt),
    };
    const list = sets[state.remTab];
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    view.innerHTML = `
      <div class="top"><h1>Reminders <small>${open.length}</small></h1><div class="grow"></div>
        ${perm === 'default' ? `<button class="btn small ghost" id="notif">${ICONS.bell} Alerts</button>` : ''}</div>
      <div class="seg">
        <button data-r="upcoming" class="${state.remTab === 'upcoming' ? 'on' : ''}">Scheduled ${sets.upcoming.length}</button>
        <button data-r="nodate" class="${state.remTab === 'nodate' ? 'on' : ''}">No date ${sets.nodate.length}</button>
        <button data-r="done" class="${state.remTab === 'done' ? 'on' : ''}">Done ${sets.done.length}</button>
      </div>
      ${list.length ? list.map(remHTML).join('') : emptyHTML(state.remTab === 'done' ? 'Nothing finished yet.' : 'No reminders here. Say things like "call Ravi tomorrow at 5" in a note.')}
      <p class="note-banner">Alerts show while the app is open. Tap the calendar icon to add a phone alarm through Google Calendar.</p>
    `;
    $$('[data-r]').forEach(b => b.onclick = () => { state.remTab = b.dataset.r; render(); });
    const nb = $('#notif');
    if (nb) nb.onclick = async () => { await Notification.requestPermission(); render(); };
    bindReminders();
    $$('[data-open]').forEach(b => b.onclick = () => openDetail(b.dataset.open));
  }

  // Fires notifications for reminders that came due while the app is open.
  async function checkDue() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    for (const n of state.notes) {
      let changed = false;
      for (const r of n.reminders || []) {
        if (r.done || r.notified || !r.due || r.due > now) continue;
        r.notified = true;
        changed = true;
        const opts = { body: r.text, tag: r.id, icon: 'icons/icon-192.png', data: { noteId: n.id } };
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          if (reg) reg.showNotification('Reminder', opts); else new Notification('Reminder', opts);
        } catch (e) { /* notifications are best effort */ }
      }
      if (changed) await saveNote(n);
    }
  }

  // ---------- Ask -----------------------------------------------------------
  function renderAsk() {
    const tags = allTags().slice(0, 3);
    const suggestions = [
      'Reminders this week',
      'What did I record yesterday?',
      ...tags.map(t => `What did I say about ${t}?`),
    ];
    view.innerHTML = `
      <div class="top"><h1>Ask</h1></div>
      <form class="ask-box" id="askForm">
        <input id="askQ" placeholder="Ask about your memories…" value="${esc(state.askQuery)}" autocomplete="off">
        <button class="btn" type="submit">Ask</button>
      </form>
      <div class="suggest">${suggestions.map(s => `<button type="button" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div id="answers"></div>
      <p class="note-banner">Searches your notes on this device. Written AI answers can be added later.</p>
    `;
    $('#askForm').onsubmit = e => { e.preventDefault(); state.askQuery = $('#askQ').value; answer(); };
    $$('[data-s]').forEach(b => b.onclick = () => { $('#askQ').value = state.askQuery = b.dataset.s; answer(); });
    if (state.askQuery) answer();
  }

  function dateRange(q) {
    const s = q.toLowerCase();
    const today = startOfDay(Date.now());
    if (/\byesterday\b|నిన్న/.test(s)) return [today - DAY_MS, today, 'yesterday'];
    if (/\btoday\b|ఈరోజు/.test(s)) return [today, today + DAY_MS, 'today'];
    if (/\btomorrow\b|రేపు/.test(s)) return [today + DAY_MS, today + 2 * DAY_MS, 'tomorrow'];
    if (/\blast week\b/.test(s)) return [today - 14 * DAY_MS, today - 7 * DAY_MS, 'last week'];
    if (/\bthis week\b|\bweek\b/.test(s)) return [today - 7 * DAY_MS, today + 8 * DAY_MS, 'this week'];
    if (/\bthis month\b|\bmonth\b/.test(s)) return [today - 30 * DAY_MS, today + 31 * DAY_MS, 'this month'];
    return null;
  }

  function highlight(text, qs) {
    let h = esc(text);
    for (const q of qs) {
      const stem = q.length > 4 ? q.slice(0, -1) : q;
      h = h.replace(new RegExp('(' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\p{L}\\p{M}]*)', 'giu'), '<mark>$1</mark>');
    }
    return h;
  }

  function answer() {
    const q = state.askQuery.trim();
    const out = $('#answers');
    if (!q) { out.innerHTML = ''; return; }
    const range = dateRange(q);
    let html = '';

    if (/remind|todo|to-do|task|due|pending|alarm/i.test(q)) {
      let rems = allReminders().filter(r => !r.done);
      if (range) rems = rems.filter(r => r.due && r.due >= Math.max(range[0], startOfDay(Date.now())) && r.due < range[1]);
      rems.sort((a, b) => (a.due || Infinity) - (b.due || Infinity));
      html = `<div class="answer"><div class="lead">${rems.length ? `${plural(rems.length, 'open reminder')}${range ? ' ' + range[2] : ''}` : `No open reminders${range ? ' ' + range[2] : ''}.`}</div>${rems.map(remHTML).join('')}</div>`;
      out.innerHTML = html;
      bindReminders(out);
      $$('[data-open]', out).forEach(b => b.onclick = () => openDetail(b.dataset.open));
      return;
    }

    let pool = state.notes;
    if (range && range[2] !== 'tomorrow') pool = pool.filter(n => n.createdAt >= range[0] && n.createdAt < range[1]);
    const qs = Smart.terms(q.replace(/\b(yesterday|today|tomorrow|this|last|week|month|record|recorded|wrote|write)\b/gi, ''));
    let hits;
    if (qs.length) hits = Smart.search(pool, q).slice(0, 8);
    else hits = pool.slice(0, 10).map(note => ({ note, snippet: note.summary || note.body || '' }));

    if (!hits.length) {
      html = `<div class="answer"><div class="lead">I couldn't find that in your memories${range ? ' from ' + range[2] : ''}. Try a different word.</div></div>`;
    } else {
      html = `<div class="answer"><div class="lead">Found in ${plural(hits.length, 'memory').replace('memorys', 'memories')}${range ? ' from ' + range[2] : ''}</div>
        ${hits.map(h => `<div class="hit"><button data-open="${h.note.id}">${esc(h.note.title || 'Untitled')}</button>
          <div class="small muted">${esc(shortDate(h.note.createdAt))} · ${esc(h.note.folder || 'Inbox')}</div>
          <div class="snip">${highlight(h.snippet, qs)}</div></div>`).join('')}</div>`;
    }
    out.innerHTML = html;
    $$('[data-open]', out).forEach(b => b.onclick = () => openDetail(b.dataset.open));
  }

  // ---------- Sheets --------------------------------------------------------
  let sheetCleanup = null;
  let sheetOpen = false;

  function openSheet(html, bind, replace) {
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
    const body = $('#sheet-body');
    body.innerHTML = html;
    $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    if (!sheetOpen && !replace) history.pushState({ sheet: true }, '');
    sheetOpen = true;
    if (bind) sheetCleanup = bind(body) || null;
    hydrateBlobs(body);
  }

  function closeSheet(fromPop) {
    if (!sheetOpen) return;
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
    $('#sheet').hidden = true;
    $('#sheet-body').innerHTML = '';
    document.body.style.overflow = '';
    sheetOpen = false;
    if (!fromPop && history.state && history.state.sheet) history.back();
  }

  window.addEventListener('popstate', () => closeSheet(true));
  $('#sheet').addEventListener('click', e => { if (e.target.dataset.close !== undefined) closeSheet(); });

  // ---------- Capture -------------------------------------------------------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isAndroid = /Android/i.test(navigator.userAgent);

  function folderOptions(selected) {
    const names = [...new Set(['Inbox', ...folders().map(f => f[0])])];
    return `<datalist id="folderList">${names.map(f => `<option value="${esc(f)}">`).join('')}</datalist>`;
  }

  function openCapture(type = 'voice', autostart = false, replace = false) {
    const types = [['voice', 'Voice'], ['text', 'Type'], ['photo', 'Photo'], ['link', 'Link'], ['file', 'File']];
    const lang = state.settings.lang;
    let inner = '';
    if (type === 'voice') {
      inner = `
        <div class="recorder">
          <div class="lang-toggle" role="group" aria-label="Language">
            <button data-lang="en-IN" class="${lang === 'en-IN' ? 'on' : ''}">English</button>
            <button data-lang="te-IN" class="${lang === 'te-IN' ? 'on' : ''}">తెలుగు</button>
          </div>
          <button class="rec-btn" id="rec" aria-label="Start recording">${ICONS.voice}</button>
          <div class="rec-time" id="recTime">0:00</div>
          <div class="rec-hint" id="recHint">${SR ? 'Tap to start. Speak naturally, then tap again to stop.' : 'Voice-to-text is not supported in this browser. Use Chrome, or type below.'}</div>
        </div>
        <label class="field" for="body">Transcript (you can edit it)</label>
        <textarea class="input" id="body" placeholder="Your words appear here…"></textarea>
        <div class="interim small" id="interim"></div>`;
    } else if (type === 'text') {
      inner = `<label class="field" for="body">Your note</label>
        <textarea class="input" id="body" placeholder="Write your idea. Mention dates like 'call Ravi tomorrow at 5' to get a reminder." autofocus></textarea>`;
    } else if (type === 'photo') {
      inner = `<label class="btn ghost" style="width:100%">${ICONS.photo} Choose or take photos<input id="file" type="file" accept="image/*" multiple hidden></label>
        <div id="preview"></div>
        <label class="field" for="body">Caption or notes (optional)</label>
        <textarea class="input" id="body" placeholder="What is this photo about?"></textarea>`;
    } else if (type === 'link') {
      inner = `<label class="field" for="url">Link</label>
        <input class="input" id="url" type="url" inputmode="url" placeholder="https://…">
        <label class="field" for="body">Why it matters (optional)</label>
        <textarea class="input" id="body" placeholder="Notes about this link"></textarea>`;
    } else {
      inner = `<label class="btn ghost" style="width:100%">${ICONS.file} Choose a file<input id="file" type="file" hidden></label>
        <div id="preview"></div>
        <label class="field" for="body">Notes (optional)</label>
        <textarea class="input" id="body" placeholder="What is this file for?"></textarea>`;
    }

    openSheet(`
      <div class="sheet-head"><h2>New memory</h2><button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
      <div class="capture-types">${types.map(([t, l]) => `<button data-type="${t}" class="${t === type ? 'on' : ''}">${ICONS[t]}${l}</button>`).join('')}</div>
      ${inner}
      <label class="field" for="folder">Folder (leave blank to auto-file)</label>
      <input class="input" id="folder" list="folderList" placeholder="Auto">
      ${folderOptions()}
      <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="save">Save memory</button></div>
    `, body => bindCapture(body, type, autostart), replace);
  }

  function bindCapture(body, type, autostart) {
    const files = [];
    let rec = null;
    $$('[data-type]', body).forEach(b => b.onclick = () => openCapture(b.dataset.type, false, true));
    $('[data-close]', body).onclick = () => closeSheet();
    $$('.row [data-close]', body).forEach(b => b.onclick = () => closeSheet());

    const fileInput = $('#file', body);
    if (fileInput) {
      fileInput.onchange = async () => {
        for (const f of fileInput.files) files.push(type === 'photo' ? await shrinkImage(f) : f);
        $('#preview', body).innerHTML = files.map(f => type === 'photo'
          ? `<img class="preview-img" alt="" src="${URL.createObjectURL(f)}">`
          : `<div class="attach">${ICONS.file}<span>${esc(f.name)} · ${(f.size / 1024).toFixed(0)} KB</span></div>`).join('');
      };
      if (type !== 'text') setTimeout(() => fileInput.click(), 50);
    }

    if (type === 'voice') rec = setupRecorder(body, autostart);

    $('#save', body).onclick = async () => {
      if (rec && rec.active()) await rec.stop();
      const text = $('#body', body).value.trim();
      const url = $('#url', body) ? $('#url', body).value.trim() : '';
      const audio = rec ? rec.audio() : null;
      if (!text && !files.length && !url && !audio) { toast('Nothing to save yet'); return; }
      if (url && !/^https?:\/\//i.test(url)) { toast('Links should start with https://'); return; }

      const now = Date.now();
      const smart = Smart.analyze(text, new Date(now));
      const attachments = [];
      for (const f of files) {
        attachments.push({ kind: type === 'photo' ? 'image' : 'file', name: f.name || 'photo.jpg', mime: f.type, size: f.size, blobId: await DB.putBlob(f) });
      }
      if (audio) attachments.push({ kind: 'audio', name: 'recording.webm', mime: audio.type, size: audio.size, blobId: await DB.putBlob(audio) });

      let title = smart.title;
      if (!text) {
        if (type === 'link') title = prettyUrl(url);
        else if (type === 'file' && files[0]) title = files[0].name;
        else if (type === 'photo') title = `Photo · ${shortDate(now)}`;
        else title = 'Voice memory';
      }
      const folderInput = $('#folder', body).value.trim();
      const note = {
        id: DB.uid(), createdAt: now, updatedAt: now, type,
        title, summary: smart.summary, body: text,
        folder: folderInput || smart.tags[0] || 'Inbox',
        tags: smart.tags, reminders: smart.reminders,
        links: url ? [url] : [], attachments,
        duration: rec ? rec.seconds() : 0,
        lang: type === 'voice' ? state.settings.lang : undefined,
      };
      await saveNote(note);
      closeSheet();
      render();
      toast(note.reminders.length ? `Saved with ${plural(note.reminders.length, 'reminder')}` : 'Memory saved');
      setTimeout(() => openDetail(note.id), 80);
    };

    return () => { if (rec) rec.abort(); };
  }

  function prettyUrl(u) {
    try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '')).slice(0, 70); } catch (e) { return u; }
  }

  // Downscale big photos so the phone's storage lasts.
  function shrinkImage(file, max = 1600) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 900000) { resolve(file); return; }
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => { b.name = file.name; resolve(b || file); }, 'image/jpeg', 0.85);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  // Speech-to-text with the browser's built-in recognizer, plus optional audio
  // capture. Android Chrome repeats results in continuous mode, so there we
  // run one-shot sessions and restart them until the user taps stop.
  function setupRecorder(body, autostart) {
    const btn = $('#rec', body);
    const ta = $('#body', body);
    const interim = $('#interim', body);
    const hint = $('#recHint', body);
    const timeEl = $('#recTime', body);
    let live = false, startedAt = 0, elapsed = 0, timer = null;
    let recog = null, media = null, chunks = [], audioBlob = null, stream = null;

    $$('[data-lang]', body).forEach(b => b.onclick = async () => {
      state.settings.lang = b.dataset.lang;
      await DB.setSetting('lang', b.dataset.lang);
      $$('[data-lang]', body).forEach(x => x.classList.toggle('on', x === b));
      if (live) { stop(); start(); }
    });

    function tick() {
      const s = Math.floor((elapsed + (live ? Date.now() - startedAt : 0)) / 1000);
      timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function append(t) {
      t = t.trim();
      if (!t) return;
      ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + ' ' : '') + t;
    }

    function newRecognizer() {
      const r = new SR();
      r.lang = state.settings.lang;
      r.continuous = !isAndroid;
      r.interimResults = true;
      r.onresult = e => {
        let inter = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) append(e.results[i][0].transcript);
          else inter += e.results[i][0].transcript;
        }
        interim.textContent = inter;
      };
      r.onerror = e => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { hint.textContent = 'Microphone permission was blocked. Allow it in the browser settings.'; stop(); }
        else if (e.error === 'network') { hint.textContent = 'Voice-to-text needs internet. You can still type.'; stop(); }
        else hint.textContent = 'Voice error: ' + e.error;
      };
      r.onend = () => {
        interim.textContent = '';
        if (live) { try { r.start(); } catch (err) { recog = newRecognizer(); try { recog.start(); } catch (e2) {} } }
      };
      return r;
    }

    async function start() {
      if (!SR && !state.settings.keepAudio) { toast('Voice-to-text needs Chrome. Type your note instead.'); ta.focus(); return; }
      live = true;
      startedAt = Date.now();
      btn.classList.add('live');
      btn.innerHTML = ICONS.stop;
      btn.setAttribute('aria-label', 'Stop recording');
      hint.textContent = 'Listening… tap to stop';
      timer = setInterval(tick, 500);
      if (state.settings.keepAudio && window.MediaRecorder) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          media = new MediaRecorder(stream);
          media.ondataavailable = e => e.data.size && chunks.push(e.data);
          media.start();
        } catch (e) { hint.textContent = 'Could not save audio; transcribing only.'; }
      }
      if (SR) { recog = newRecognizer(); try { recog.start(); } catch (e) {} }
    }

    function stop() {
      return new Promise(resolve => {
        if (!live) return resolve();
        live = false;
        elapsed += Date.now() - startedAt;
        clearInterval(timer);
        tick();
        btn.classList.remove('live');
        btn.innerHTML = ICONS.voice;
        btn.setAttribute('aria-label', 'Start recording');
        hint.textContent = 'Paused. Tap to continue, or Save.';
        if (recog) { try { recog.stop(); } catch (e) {} }
        if (media && media.state !== 'inactive') {
          media.onstop = () => {
            audioBlob = new Blob(chunks, { type: media.mimeType || 'audio/webm' });
            stream.getTracks().forEach(t => t.stop());
            resolve();
          };
          media.stop();
        } else resolve();
        // Give the recognizer a moment to deliver its last final result.
        setTimeout(() => { if (interim.textContent) { append(interim.textContent); interim.textContent = ''; } }, 600);
      });
    }

    btn.onclick = () => (live ? stop() : start());
    if (autostart && SR) setTimeout(start, 150);

    return {
      active: () => live,
      stop: async () => { await stop(); await new Promise(r => setTimeout(r, 650)); },
      abort: () => { live = false; clearInterval(timer); try { recog && recog.abort(); } catch (e) {} if (stream) stream.getTracks().forEach(t => t.stop()); },
      audio: () => audioBlob,
      seconds: () => Math.round(elapsed / 1000),
    };
  }

  // ---------- Detail --------------------------------------------------------
  function openDetail(id) {
    const n = state.notes.find(x => x.id === id);
    if (!n) return;
    const imgs = (n.attachments || []).filter(a => a.kind === 'image');
    const others = (n.attachments || []).filter(a => a.kind !== 'image');
    const rems = (n.reminders || []).map(r => ({ ...r, note: n }));
    const meta = [shortDate(n.createdAt), time(new Date(n.createdAt))];
    if (n.duration) meta.push(durLabel(n.duration));
    openSheet(`
      <div class="sheet-head"><div class="detail-meta" style="flex:1">${meta.map(esc).join(' • ')} · ${esc(n.folder || 'Inbox')}</div>
        <button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
      <div class="detail-title">${esc(n.title || 'Untitled memory')}</div>
      ${(n.tags || []).length ? `<div class="chips">${n.tags.map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${n.summary ? `<div class="detail-block"><h4>Summary</h4><p>${esc(n.summary)}</p></div>` : ''}
      ${rems.length ? `<div class="detail-block"><h4>Reminders</h4>${rems.map(remHTML).join('')}</div>` : ''}
      ${imgs.map(a => `<img class="preview-img" alt="${esc(a.name)}" data-blob="${a.blobId}">`).join('')}
      ${n.body ? `<div class="detail-block"><h4>${n.type === 'voice' ? 'Transcript' : 'Note'}</h4><p>${esc(n.body)}</p></div>` : ''}
      ${(n.links || []).length ? `<div class="detail-block links"><h4>Links</h4>${n.links.map(l => `<p><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a></p>`).join('')}</div>` : ''}
      ${others.map(a => a.kind === 'audio'
        ? `<div class="attach"><audio controls data-blob="${a.blobId}"></audio></div>`
        : `<div class="attach">${ICONS.file}<a data-blob="${a.blobId}" download="${esc(a.name)}">${esc(a.name)}</a></div>`).join('')}
      <div class="row end"><button class="btn danger" id="del">Delete</button><div class="grow"></div><button class="btn" id="edit">Edit</button></div>
    `, body => {
      $('[data-close]', body).onclick = () => closeSheet();
      $('#edit', body).onclick = () => openEdit(n.id);
      $('#del', body).onclick = async () => {
        if (!confirm('Delete this memory? This cannot be undone.')) return;
        await DB.deleteNote(n);
        state.notes = state.notes.filter(x => x.id !== n.id);
        closeSheet();
        render();
        toast('Deleted');
      };
      bindReminders(body);
      $$('.rem-src', body).forEach(b => b.remove());
      $$('[data-toggle]', body).forEach(b => b.addEventListener('click', () => setTimeout(() => openDetail(n.id), 50)));
    }, true);
  }

  // ---------- Edit ----------------------------------------------------------
  const toLocalInput = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  function remRowHTML(r) {
    return `<div class="detail-block" data-rem="${r.id}" style="padding:10px 12px;margin:8px 0">
      <input class="input" data-rtext value="${esc(r.text)}" placeholder="What to do">
      <div class="row" style="margin-top:8px"><input class="input grow" style="width:auto" type="datetime-local" data-rdue value="${toLocalInput(r.due)}">
      <button class="icon-btn" data-rdel aria-label="Remove reminder">${ICONS.close}</button></div></div>`;
  }

  function openEdit(id) {
    const n = state.notes.find(x => x.id === id);
    if (!n) return;
    const draft = JSON.parse(JSON.stringify(n.reminders || []));
    openSheet(`
      <div class="sheet-head"><h2>Edit memory</h2><button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
      <button class="btn ghost small" id="auto">✨ Re-read the note and refill title, summary, tags and reminders</button>
      <label class="field" for="eTitle">Title</label><input class="input" id="eTitle" value="${esc(n.title)}">
      <label class="field" for="eSum">Summary</label><textarea class="input" id="eSum" style="min-height:80px">${esc(n.summary)}</textarea>
      <label class="field" for="eBody">${n.type === 'voice' ? 'Transcript' : 'Note'}</label><textarea class="input" id="eBody">${esc(n.body)}</textarea>
      <label class="field" for="eFolder">Folder</label><input class="input" id="eFolder" list="folderList" value="${esc(n.folder || 'Inbox')}">${folderOptions()}
      <label class="field" for="eTags">Tags (comma separated)</label><input class="input" id="eTags" value="${esc((n.tags || []).join(', '))}">
      <label class="field">Reminders</label><div id="eRems">${draft.map(remRowHTML).join('')}</div>
      <button class="btn ghost small" id="addRem">+ Add reminder</button>
      <div class="row end"><button class="btn ghost" id="cancel">Cancel</button><button class="btn" id="saveEdit">Save</button></div>
    `, body => {
      const remsBox = $('#eRems', body);
      const bindRows = () => $$('[data-rdel]', remsBox).forEach(b => b.onclick = () => b.closest('[data-rem]').remove());
      bindRows();
      $('[data-close]', body).onclick = () => openDetail(n.id);
      $('#cancel', body).onclick = () => openDetail(n.id);
      $('#addRem', body).onclick = () => {
        remsBox.insertAdjacentHTML('beforeend', remRowHTML({ id: DB.uid(), text: '', due: null }));
        bindRows();
        $$('[data-rtext]', remsBox).pop().focus();
      };
      $('#auto', body).onclick = () => {
        const s = Smart.analyze($('#eBody', body).value, new Date(n.createdAt));
        if (!s.title) { toast('Add some text first'); return; }
        $('#eTitle', body).value = s.title;
        $('#eSum', body).value = s.summary;
        $('#eTags', body).value = s.tags.join(', ');
        const existing = $$('[data-rtext]', remsBox).map(i => i.value.toLowerCase());
        for (const r of s.reminders) if (!existing.includes(r.text.toLowerCase())) remsBox.insertAdjacentHTML('beforeend', remRowHTML(r));
        bindRows();
        toast('Refilled from the note text');
      };
      $('#saveEdit', body).onclick = async () => {
        const old = Object.fromEntries((n.reminders || []).map(r => [r.id, r]));
        n.title = $('#eTitle', body).value.trim() || 'Untitled memory';
        n.summary = $('#eSum', body).value.trim();
        n.body = $('#eBody', body).value.trim();
        n.folder = $('#eFolder', body).value.trim() || 'Inbox';
        n.tags = [...new Set($('#eTags', body).value.split(',').map(t => t.trim()).filter(Boolean))];
        n.reminders = $$('[data-rem]', remsBox).map(row => {
          const text = $('[data-rtext]', row).value.trim();
          const dueVal = $('[data-rdue]', row).value;
          const due = dueVal ? new Date(dueVal).getTime() : null;
          const prev = old[row.dataset.rem];
          return { id: row.dataset.rem, text, due, done: prev ? prev.done : false, notified: prev && prev.due === due ? prev.notified : false };
        }).filter(r => r.text);
        await saveNote(n);
        render();
        openDetail(n.id);
        toast('Saved');
      };
    }, true);
  }

  // ---------- More menu: backup, settings -----------------------------------
  function openMoreMenu() {
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    openSheet(`
      <h2>Settings</h2>
      <div class="menu-list">
        <button id="exp">${ICONS.file} Export backup<span class="count">${state.notes.length} notes</span></button>
        <button id="imp">${ICONS.file} Import backup<input type="file" id="impFile" accept="application/json,.json" hidden></button>
        <button id="ntf">${ICONS.bell} Reminder alerts<span class="count">${perm === 'granted' ? 'On' : perm === 'denied' ? 'Blocked' : perm === 'unsupported' ? 'Not supported' : 'Off'}</span></button>
        <button id="aud">${ICONS.voice} Keep audio of voice notes<span class="count">${state.settings.keepAudio ? 'On' : 'Off'}</span></button>
      </div>
      <hr class="sep">
      <p class="small muted"><b>AI upgrade:</b> not connected. Titles, summaries, tags and reminders come from the on-device rules engine.
      An AI key can be added later to upgrade them.</p>
      <p class="small muted"><b>Storage:</b> everything stays on this device. Export a backup regularly.</p>
      <div class="row end"><button class="btn danger small" id="wipe">Delete all data</button></div>
    `, body => {
      $('#exp', body).onclick = exportBackup;
      $('#imp', body).onclick = () => $('#impFile', body).click();
      $('#impFile', body).onchange = e => importBackup(e.target.files[0]);
      $('#ntf', body).onclick = async () => {
        if (perm === 'default') await Notification.requestPermission();
        else if (perm === 'denied') toast('Alerts are blocked. Allow notifications in the browser site settings.');
        openMoreMenu();
      };
      $('#aud', body).onclick = async () => {
        state.settings.keepAudio = !state.settings.keepAudio;
        await DB.setSetting('keepAudio', state.settings.keepAudio);
        if (state.settings.keepAudio && isAndroid) toast('Some Android phones cannot record audio and transcribe at once. Turn this off if transcripts stop working.', 5000);
        openMoreMenu();
      };
      $('#wipe', body).onclick = async () => {
        if (!confirm('Delete ALL memories and files on this device?')) return;
        if (!confirm('Really delete everything? Export a backup first if unsure.')) return;
        await DB.clearAll();
        state.notes = [];
        closeSheet();
        render();
        toast('All data deleted');
      };
    }, true);
  }

  const toDataUrl = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });

  async function exportBackup() {
    toast('Preparing backup…');
    const blobs = {};
    for (const { id, blob } of await DB.allBlobs()) blobs[id] = await toDataUrl(blob);
    const data = { app: 'idea-organizer', version: 1, exportedAt: Date.now(), notes: state.notes, blobs };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const d = new Date();
    a.download = `idea-organizer-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    a.click();
    toast('Backup downloaded');
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'idea-organizer' || !Array.isArray(data.notes)) throw new Error('not a backup');
      for (const [id, url] of Object.entries(data.blobs || {})) await DB.putBlobWithId(id, await (await fetch(url)).blob());
      const have = new Set(state.notes.map(n => n.id));
      let added = 0;
      for (const n of data.notes) { if (!have.has(n.id)) added++; await DB.putNote(n); }
      state.notes = await DB.allNotes();
      closeSheet();
      render();
      toast(`Imported ${plural(added, 'new memory').replace('memorys', 'memories')}`);
    } catch (e) {
      toast('That file is not an Idea Organizer backup');
    }
  }

  // ---------- boot ----------------------------------------------------------
  $$('.tabbar button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('#fab').onclick = () => openCapture(state.tab === 'home' ? 'text' : 'voice');

  (async () => {
    await load();
    let tab = 'memories';
    try { tab = localStorage.getItem('tab') || 'memories'; } catch (e) {}
    const shortcut = new URLSearchParams(location.search).get('new');
    setTab(['home', 'ask', 'memories', 'reminders'].includes(tab) ? tab : 'memories');
    if (shortcut) openCapture(shortcut, shortcut === 'voice');
    checkDue();
    setInterval(checkDue, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDue(); render(); } });
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.open) openDetail(e.data.open); });
    }
  })();
})();
