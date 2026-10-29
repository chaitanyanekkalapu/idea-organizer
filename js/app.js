// Idea Organizer UI. Four tabs (Home, Ask, Memories, Reminders) plus bottom
// sheets for capture, detail and edit. All data comes from DB, all "smart"
// output from Smart.analyze().

// If an older cached page didn't load drive.js, run without Drive sync.
if (typeof Drive === 'undefined') window.Drive = { configured: false, hasToken: () => false };

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
    settings: {},
    drive: { connected: false, email: '', folderId: '', lastSync: 0, auto: true, pending: false, deleted: {} },
  };

  // ---------- helpers -------------------------------------------------------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const time = d => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  const shortDate = ts => { const d = new Date(ts); return `${ord(d.getDate())} ${MON[d.getMonth()]}`; };
  // Full stamp shown on every memory: "Wed, 29 Oct 2026 · 10:38 AM".
  const dateStamp = (ts, sep = ' · ') => {
    const d = new Date(ts);
    return `${DAY[d.getDay()].slice(0, 3)}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}${sep}${time(d)}`;
  };
  // Changed more than a minute after it was saved.
  const wasEdited = n => !!n.updatedAt && n.updatedAt - n.createdAt > 60000;
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
    share: '<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>',
  };

  // ---------- data ----------------------------------------------------------
  async function load() {
    state.notes = await DB.allNotes();
    Object.assign(state.drive, await DB.getSetting('drive', {}));
    state.drive.deleted = await DB.getSetting('driveDeleted', {});
    state.settings.home = await DB.getSetting('home', { title: 'Ideas', sub: 'Idea Organizer' });
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
    scheduleSync();
  }

  // Deleting records a "deleted" marker so other devices (and Drive) drop the
  // memory too instead of bringing it back on the next sync.
  async function removeNote(note) {
    await DB.deleteNote(note);
    state.notes = state.notes.filter(x => x.id !== note.id);
    state.drive.deleted[note.id] = Date.now();
    await DB.setSetting('driveDeleted', state.drive.deleted);
    scheduleSync();
  }

  // ---------- Google Drive sync ---------------------------------------------
  // Two-way: pull what's in Drive, merge (newer edit wins, deletions win over
  // older edits), then push the merged result. Runs a few seconds after each
  // change while signed in, when the app opens, and on "Sync now".
  let syncTimer = null, syncing = false;

  async function saveDriveState() {
    const { connected, email, folderId, lastSync, auto } = state.drive;
    await DB.setSetting('drive', { connected, email, folderId, lastSync, auto });
  }

  function scheduleSync() {
    if (!Drive.configured || !state.drive.connected || !state.drive.auto) return;
    state.drive.pending = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(false), 6000);
  }

  function agoLabel(ts) {
    if (!ts) return 'never';
    const m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : shortDate(ts);
  }

  async function syncNow(interactive) {
    if (!Drive.configured || syncing) return;
    if (!Drive.hasToken()) {
      if (!interactive) { state.drive.pending = true; if (state.tab === 'home') render(); return; }
      try { await Drive.connect(''); } catch (e) { toast(e.message, 4000); return; }
    }
    syncing = true;
    const say = msg => { if (interactive) toast('☁️ ' + msg, 8000); };
    try {
      const remote = await Drive.pull({ folderId: state.drive.folderId, onProgress: say });
      state.drive.folderId = remote.folderId;

      const deleted = { ...remote.deleted, ...state.drive.deleted };
      for (const [id, t] of Object.entries(remote.deleted)) deleted[id] = Math.max(t, state.drive.deleted[id] || 0);
      const local = new Map(state.notes.map(n => [n.id, n]));
      let pulled = 0, removed = 0;

      for (const r of remote.notes) {
        if (deleted[r.id] && deleted[r.id] >= (r.updatedAt || 0)) continue;
        const l = local.get(r.id);
        if (l && (l.updatedAt || 0) >= (r.updatedAt || 0)) continue;
        for (const a of r.attachments || []) {
          if (await DB.getBlob(a.blobId)) continue;
          say(`Downloading ${a.name}…`);
          const b = await remote.fetchBlob(a.blobId);
          if (b) await DB.putBlobWithId(a.blobId, b);
        }
        await DB.putNote(r);
        local.set(r.id, r);
        pulled++;
      }
      for (const [id, t] of Object.entries(deleted)) {
        const l = local.get(id);
        if (l && (l.updatedAt || 0) <= t) { await DB.deleteNote(l); local.delete(id); removed++; }
      }
      state.notes = [...local.values()].sort((a, b) => b.createdAt - a.createdAt);
      state.drive.deleted = deleted;
      await DB.setSetting('driveDeleted', deleted);

      const res = await Drive.push({
        folderId: remote.folderId,
        files: remote.files,
        notes: state.notes,
        deleted,
        getBlob: id => DB.getBlob(id),
        readable: `# Idea Organizer\n\nBacked up ${fullDate(Date.now())} · ${state.notes.length} memories\n\n` + state.notes.map(noteMarkdown).join('\n\n---\n\n'),
        onProgress: say,
      });
      state.drive.lastSync = res.at;
      state.drive.pending = false;
      await saveDriveState();
      const parts = [];
      if (pulled) parts.push(`${pulled} from Drive`);
      if (removed) parts.push(`${removed} removed`);
      if (res.uploaded) parts.push(`${res.uploaded} file${res.uploaded > 1 ? 's' : ''} uploaded`);
      if (interactive || pulled || removed) toast('☁️ Synced with Google Drive' + (parts.length ? ' · ' + parts.join(', ') : ''), 3500);
      if (pulled || removed || state.tab === 'home') render();
    } catch (e) {
      state.drive.pending = true;
      if (e.code === 'auth') { if (interactive) toast('Please sign in to Google again'); }
      else if (interactive || navigator.onLine) toast('Drive sync failed: ' + e.message, 5000);
      if (state.tab === 'home') render();
    } finally {
      syncing = false;
    }
  }

  async function connectDrive() {
    try {
      await Drive.connect('consent');
      const me = await Drive.whoAmI().catch(() => null);
      state.drive.connected = true;
      state.drive.email = me ? me.emailAddress : '';
      state.drive.auto = true;
      await saveDriveState();
      toast('Connected to Google Drive. Syncing…');
      await syncNow(true);
    } catch (e) {
      toast(e.message, 4000);
    }
  }

  // ---------- tabs ----------------------------------------------------------
  function setTab(tab) {
    state.tab = tab;
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    // Home has its own shortcuts and Record tile, so the + button would only overlap them.
    $('#fab').hidden = tab === 'home';
    try { localStorage.setItem('tab', tab); } catch (e) {}
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    ({ home: renderHome, ask: renderAsk, memories: renderMemories, reminders: renderReminders })[state.tab]();
  }

  function cardHTML(n) {
    const rems = (n.reminders || []).filter(r => !r.done).length;
    const meta = [dateStamp(n.createdAt)];
    if (n.type === 'voice' && n.duration) meta.push(durLabel(n.duration));
    if ((n.attachments || []).some(a => a.kind === 'audio')) meta.push('🎧');
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
  // Home: soft-UI dashboard. Script greeting, date pill, a column of black
  // round shortcuts, a black clock dial, and two widget tiles.
  function homeClock() {
    const d = new Date();
    const h12 = d.getHours() % 12 || 12;
    return {
      day: DAY[d.getDay()],
      hh: String(h12).padStart(2, '0'),
      mm: String(d.getMinutes()).padStart(2, '0'),
      ap: d.getHours() < 12 ? 'AM' : 'PM',
      date: `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`,
    };
  }

  function tickHomeClock() {
    const dial = $('#dial');
    if (!dial) return;
    const c = homeClock();
    $('[data-c=hh]', dial).textContent = c.hh;
    $('[data-c=mm]', dial).firstChild.textContent = c.mm + ' ';
    $('[data-c=ap]', dial).textContent = c.ap;
    $('[data-c=day]', dial).textContent = c.day;
    $('[data-c=date]', dial).textContent = c.date;
  }
  setInterval(tickHomeClock, 15000);

  function renderHome() {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const rems = allReminders().filter(r => !r.done);
    const weekAgo = Date.now() - 7 * DAY_MS;
    const due = rems.filter(r => r.due).sort((a, b) => a.due - b.due).slice(0, 3);
    const c = homeClock();
    const shortcuts = [['text', 'Type', ICONS.text], ['photo', 'Photo', ICONS.photo], ['link', 'Link', ICONS.link], ['file', 'File', ICONS.file]];
    view.innerHTML = `
      <div class="home-head">
        <div class="hello">
          <div class="script">Hello!</div>
          <button class="brand-btn" id="editHome" aria-label="Edit Home title">
            <h1 class="brand" style="font-size:${brandSize(state.settings.home.title)}px">${esc(state.settings.home.title)}</h1>
            <div class="script sub">${esc(state.settings.home.sub)} ✎</div>
          </button>
          <p class="greet">${greet}!<br>Have a nice day!</p>
        </div>
        <div class="head-right">
          <div class="date-pill">${ICONS.cal}<span>${c.day}</span><i></i><span>${c.date}</span></div>
          <button class="round-btn" id="more" aria-label="Settings">${ICONS.dots}</button>
        </div>
      </div>
      <div class="home-grid">
        <div class="side-nav">
          ${shortcuts.map(([cap, label, ic]) => `<button data-cap="${cap}"><span class="ink-btn">${ic}</span><small>${label}</small></button>`).join('')}
        </div>
        <div class="dial-wrap">
          <div class="dial-ring"></div>
          <div class="dial" id="dial">
            <div class="script day" data-c="day">${c.day}</div>
            <div class="hh" data-c="hh">${c.hh}</div>
            <div class="mm" data-c="mm">${c.mm} <small data-c="ap">${c.ap}</small></div>
            <div class="dial-date" data-c="date">${c.date}</div>
            <div class="dial-foot">✦ ${state.notes.length} ${state.notes.length === 1 ? 'memory' : 'memories'}</div>
          </div>
        </div>
      </div>
      <div class="widgets">
        <button class="tile stat-tile" data-go="reminders">
          <span class="tile-ic">🔔</span>
          <b>${rems.length}</b>
          <span>Open reminders</span>
          <small>${plural(state.notes.filter(n => n.createdAt > weekAgo).length, 'idea')} this week</small>
        </button>
        <button class="tile rec-tile" id="bigmic" aria-label="Record a voice memory">
          <span class="rec-thumb">${ICONS.voice}</span>
          <span class="rec-text"><b>Record idea</b><small>Voice note</small></span>
          <span class="ink-btn sm">${ICONS.voice}</span>
        </button>
      </div>
      ${Drive.configured && state.drive.connected ? (state.drive.pending || !Drive.hasToken()
        ? `<button class="sync-chip warn" id="syncChip">☁️ Tap to sync with Google Drive<span>last ${esc(agoLabel(state.drive.lastSync))}</span></button>`
        : `<div class="sync-chip">☁️ Backed up to Google Drive<span>${esc(agoLabel(state.drive.lastSync))}</span></div>`)
        : Drive.configured ? `<button class="sync-chip warn" id="syncSetup">☁️ Back up to Google Drive<span>Set up</span></button>` : ''}
      ${due.length ? `<div class="section-title">Coming up <button data-go="reminders">All reminders</button></div>
        ${due.map(remHTML).join('')}` : ''}
      <div class="section-title">Recent <button data-go="memories">See all</button></div>
      ${state.notes.length ? state.notes.slice(0, 3).map(cardHTML).join('') : emptyHTML('Your memories will show up here.')}
      <div class="signature script">Designed with creativity ♡</div>
    `;
    $('#bigmic').onclick = () => openCapture('voice', true);
    $('#editHome').onclick = openHomeTitle;
    const chip = $('#syncChip');
    if (chip) chip.onclick = () => syncNow(true);
    const setup = $('#syncSetup');
    if (setup) setup.onclick = openMoreMenu;
    $$('[data-cap]').forEach(b => b.onclick = () => openCapture(b.dataset.cap));
    $$('[data-go]').forEach(b => b.onclick = () => setTab(b.dataset.go));
    $('#more').onclick = openMoreMenu;
    bindReminders();
    bindCards();
  }

  // Longer Home titles get a smaller font so a name stays on one line beside the date pill.
  const brandSize = t => { const n = [...(t || '')].length; return n <= 5 ? 52 : n <= 7 ? 42 : n <= 10 ? 34 : n <= 14 ? 27 : 23; };

  // The big Home heading and the script line under it, e.g. "Raj / Creative Designer".
  function openHomeTitle() {
    const h = state.settings.home;
    openSheet(`
      <div class="sheet-head"><h2>Home title</h2><button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
      <label class="field" for="homeTitle">Title</label>
      <input class="input" id="homeTitle" value="${esc(h.title)}" maxlength="24" placeholder="Ideas">
      <label class="field" for="homeSub">Subtitle (handwritten line)</label>
      <input class="input" id="homeSub" value="${esc(h.sub)}" maxlength="40" placeholder="Idea Organizer">
      <div class="row end"><button class="btn ghost" id="homeReset">Reset</button><button class="btn" id="homeSave">Save</button></div>
    `, body => {
      $('[data-close]', body).onclick = () => closeSheet();
      $('#homeReset', body).onclick = () => { $('#homeTitle', body).value = 'Ideas'; $('#homeSub', body).value = 'Idea Organizer'; };
      $('#homeSave', body).onclick = async () => {
        state.settings.home = { title: $('#homeTitle', body).value.trim() || 'Ideas', sub: $('#homeSub', body).value.trim() };
        await DB.setSetting('home', state.settings.home);
        closeSheet();
        render();
        toast('Home title saved');
      };
      $('#homeTitle', body).focus();
    });
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

  function viewTitle() {
    const parts = [state.folder === 'All' ? 'All memories' : state.folder];
    if (state.filterTag) parts.push(state.filterTag);
    if (state.filterType) parts.push(state.filterType);
    if (state.query.trim()) parts.push(`"${state.query.trim()}"`);
    return parts.join(' · ');
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
        <button class="round-btn" id="shareView" aria-label="Share or export these memories">${ICONS.share}</button>
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
    $('#shareView').onclick = () => openShare(filteredNotes(), viewTitle());
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

  function folderOptions(selected) {
    const names = [...new Set(['Inbox', ...folders().map(f => f[0])])];
    return `<datalist id="folderList">${names.map(f => `<option value="${esc(f)}">`).join('')}</datalist>`;
  }

  function openCapture(type = 'voice', autostart = false, replace = false) {
    const types = [['voice', 'Voice'], ['text', 'Type'], ['photo', 'Photo'], ['link', 'Link'], ['file', 'File']];
    let inner = '';
    if (type === 'voice') {
      inner = `
        <div class="recorder">
          <button class="rec-btn" id="rec" aria-label="Start recording">${ICONS.voice}</button>
          <div class="rec-time" id="recTime">0:00</div>
          <div class="meter" id="meter" aria-hidden="true">${'<i></i>'.repeat(28)}</div>
          <div class="rec-hint" id="recHint">Tap to record. Tap again to stop.</div>
          <div class="rec-alt">
            <label class="btn ghost small">📱 Phone recorder<input type="file" id="phoneRec" accept="audio/*" capture hidden></label>
            <label class="btn ghost small">📂 Import audio<input type="file" id="importRec" accept="audio/*,.m4a,.mp3,.aac,.wav,.ogg,.opus,.amr,.3gp" hidden></label>
            <button class="btn ghost small" id="pasteBtn" type="button">📋 Paste transcript</button>
          </div>
          <div class="rec-hint small">For a transcript, use NeoSapien: open the memory there → <b>Share</b> → <b>Idea Organizer</b>. Or copy its transcript and tap Paste.</div>
        </div>
        <div id="recAudio"></div>
        <label class="field" for="body">Notes / transcript (optional)</label>
        <textarea class="input" id="body" placeholder="Paste the NeoSapien transcript, or type key points…"></textarea>`;
    } else if (type === 'text') {
      inner = `<div class="row" style="justify-content:flex-end"><button class="btn ghost small" id="pasteBtn" type="button">📋 Paste</button></div>
        <label class="field" for="body">Your note</label>
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

    // Paste text copied from another app (e.g. a NeoSapien transcript).
    const pasteBtn = $('#pasteBtn', body);
    if (pasteBtn) pasteBtn.onclick = async () => {
      const ta = $('#body', body);
      try {
        const t = (await navigator.clipboard.readText()).trim();
        if (!t) { toast('Clipboard is empty. Copy the transcript first.'); return; }
        ta.value = [ta.value.trim(), t].filter(Boolean).join('\n\n');
        ta.dispatchEvent(new Event('input'));
        toast('Pasted');
      } catch (e) {
        ta.focus();
        toast('Long-press the box and choose Paste', 3500);
      }
    };

    $('#save', body).onclick = async () => {
      if (rec && rec.active()) await rec.stop();
      const text = $('#body', body).value.trim();
      const url = $('#url', body) ? $('#url', body).value.trim() : '';
      const clips = rec ? rec.audio() : [];
      if (!text && !files.length && !url && !clips.length) { toast('Nothing to save yet'); return; }
      if (url && !/^https?:\/\//i.test(url)) { toast('Links should start with https://'); return; }

      const now = Date.now();
      const smart = Smart.analyze(text, new Date(now));
      const attachments = [];
      for (const f of files) {
        attachments.push({ kind: type === 'photo' ? 'image' : 'file', name: f.name || 'photo.jpg', mime: f.type, size: f.size, blobId: await DB.putBlob(f) });
      }
      for (const [i, audio] of clips.entries()) {
        const ext = /mp4|m4a|aac/.test(audio.type) ? 'm4a' : /ogg/.test(audio.type) ? 'ogg' : 'webm';
        const d = new Date(now);
        const name = audio.name || `voice-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${clips.length > 1 ? '-' + (i + 1) : ''}.${ext}`;
        attachments.push({ kind: 'audio', name, mime: audio.type, size: audio.size, blobId: await DB.putBlob(audio) });
      }

      let title = smart.title;
      if (!text) {
        if (type === 'link') title = prettyUrl(url);
        else if (type === 'file' && files[0]) title = files[0].name;
        else if (type === 'photo') title = `Photo · ${shortDate(now)}`;
        else title = `Voice note · ${shortDate(now)}, ${time(new Date(now))}`;
      }
      const folderInput = $('#folder', body).value.trim();
      const note = {
        id: DB.uid(), createdAt: now, updatedAt: now, type,
        title, summary: smart.summary, body: text,
        folder: folderInput || smart.tags[0] || 'Inbox',
        tags: smart.tags, reminders: smart.reminders,
        links: url ? [url] : [], attachments,
        duration: rec ? rec.seconds() : 0,
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

  // Voice capture: an audio recorder. Transcripts come from NeoSapien (shared
  // in or pasted), so the mic is used only for recording.
  function pickAudioType() {
    for (const t of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  const audioDuration = blob => new Promise(resolve => {
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => resolve(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => resolve(0);
    a.src = URL.createObjectURL(blob);
  });

  function setupRecorder(body, autostart) {
    const btn = $('#rec', body);
    const hint = $('#recHint', body);
    const timeEl = $('#recTime', body);
    const bars = $$('#meter i', body);
    const audioBox = $('#recAudio', body);

    let live = false, startedAt = 0, elapsed = 0, timer = null;
    let stream = null, recorder = null, chunks = [], clips = [], audioType = '';
    let actx = null, analyser = null, raf = 0;

    function tick() {
      const s = Math.floor((elapsed + (live ? Date.now() - startedAt : 0)) / 1000);
      timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function renderClips() {
      audioBox.innerHTML = clips.map(c => `<div class="attach"><audio controls preload="metadata" src="${URL.createObjectURL(c)}"></audio></div>`).join('');
    }

    // Live level meter so you can see the mic is picking you up.
    function startMeter() {
      if (!stream || !window.AudioContext) return;
      try {
        actx = new AudioContext();
        if (actx.state === 'suspended') actx.resume().catch(() => {});
        analyser = actx.createAnalyser();
        analyser.fftSize = 512;
        actx.createMediaStreamSource(stream).connect(analyser);
      } catch (e) { return; }
      const data = new Uint8Array(analyser.fftSize);
      const levels = new Array(bars.length).fill(0);
      let last = 0;
      const loop = t => {
        raf = requestAnimationFrame(loop);
        if (t - last < 60) return;
        last = t;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        levels.shift();
        levels.push(Math.min(1, Math.sqrt(sum / data.length) * 6));
        bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.max(0.08, levels[i])})`; });
      };
      raf = requestAnimationFrame(loop);
    }

    function stopMeter() {
      cancelAnimationFrame(raf);
      bars.forEach(b => { b.style.transform = ''; });
      if (actx) { actx.close().catch(() => {}); actx = null; }
    }

    async function start() {
      if (!window.MediaRecorder || !navigator.mediaDevices) {
        hint.textContent = 'This browser can\'t record. Use 📱 Phone recorder instead.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        hint.textContent = e.name === 'NotAllowedError'
          ? 'Microphone is blocked. Tap the 🔒 next to the address (or App info → Permissions) and allow Microphone.'
          : 'Could not open the microphone. Close other recording apps, or use 📱 Phone recorder.';
        return;
      }
      audioType = pickAudioType();
      try {
        recorder = audioType ? new MediaRecorder(stream, { mimeType: audioType, audioBitsPerSecond: 96000 }) : new MediaRecorder(stream);
      } catch (e) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
        hint.textContent = 'Could not start recording. Use 📱 Phone recorder instead.';
        return;
      }
      chunks = [];
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.start(1000);
      live = true;
      startedAt = Date.now();
      timer = setInterval(tick, 250);
      btn.classList.add('live');
      btn.innerHTML = ICONS.stop;
      btn.setAttribute('aria-label', 'Stop recording');
      hint.textContent = 'Recording… tap to stop';
      startMeter();
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
        hint.textContent = 'Saved below. Tap to record more, or Save memory.';
        stopMeter();
        recorder.onstop = () => {
          if (chunks.length) clips.push(new Blob(chunks, { type: (recorder.mimeType || audioType || 'audio/webm').split(';')[0] }));
          chunks = [];
          recorder = null;
          if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
          renderClips();
          resolve();
        };
        try { recorder.requestData(); } catch (e) {}
        recorder.stop();
      });
    }

    // Recordings made by the phone's own recorder app, or imported files,
    // are kept exactly as they are.
    async function addRecordingFile(file) {
      if (live) await stop();
      clips.push(file);
      elapsed += (await audioDuration(file)) * 1000;
      tick();
      renderClips();
      hint.textContent = 'Recording added. Save memory when ready.';
    }

    for (const id of ['#phoneRec', '#importRec']) {
      const inp = $(id, body);
      if (inp) inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (f) addRecordingFile(f); };
    }

    btn.onclick = () => (live ? stop() : start());
    if (autostart) setTimeout(start, 120);

    return {
      active: () => live,
      stop,
      abort: () => {
        live = false;
        clearInterval(timer);
        stopMeter();
        if (recorder && recorder.state !== 'inactive') try { recorder.stop(); } catch (e) {}
        if (stream) stream.getTracks().forEach(t => t.stop());
      },
      audio: () => clips.slice(),
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
    const meta = [esc(n.folder || 'Inbox')];
    if (n.duration) meta.push(durLabel(n.duration));
    openSheet(`
      <div class="sheet-head"><div class="detail-meta" style="flex:1">${meta.join(' • ')}</div>
        <button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
      <div class="title-row" id="titleRow">
        <div class="detail-title">${esc(n.title || 'Untitled memory')}</div>
        <button class="icon-btn" id="editTitle" aria-label="Edit title">${ICONS.text}</button>
      </div>
      <div class="stamps">
        <span>📅 Saved ${esc(dateStamp(n.createdAt, ' at '))}</span>
        ${wasEdited(n) ? `<span>✏️ Edited ${esc(dateStamp(n.updatedAt, ' at '))}</span>` : ''}
      </div>
      ${(n.tags || []).length ? `<div class="chips">${n.tags.map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${n.summary ? `<div class="detail-block"><h4>Summary</h4><p>${esc(n.summary)}</p></div>` : ''}
      ${rems.length ? `<div class="detail-block"><h4>Reminders</h4>${rems.map(remHTML).join('')}</div>` : ''}
      ${imgs.map(a => `<img class="preview-img" alt="${esc(a.name)}" data-blob="${a.blobId}">`).join('')}
      ${n.body ? `<div class="detail-block"><h4>${n.type === 'voice' ? 'Transcript' : 'Note'}</h4><p>${esc(n.body)}</p></div>` : ''}
      ${(n.links || []).length ? `<div class="detail-block links"><h4>Links</h4>${n.links.map(l => `<p><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a></p>`).join('')}</div>` : ''}
      ${others.map(a => a.kind === 'audio'
        ? `<div class="detail-block"><h4>Recording</h4><audio controls preload="metadata" data-blob="${a.blobId}" style="width:100%"></audio>
            <a class="small" style="color:var(--accent)" data-blob="${a.blobId}" download="${esc(a.name)}">Download ${esc(a.name)}</a></div>`
        : `<div class="attach">${ICONS.file}<a data-blob="${a.blobId}" download="${esc(a.name)}">${esc(a.name)}</a></div>`).join('')}
      <div class="row end"><button class="btn danger" id="del">Delete</button><div class="grow"></div>
        <button class="btn ghost" id="share">Share</button><button class="btn" id="edit">Edit</button></div>
    `, body => {
      $('[data-close]', body).onclick = () => closeSheet();
      $('#edit', body).onclick = () => openEdit(n.id);
      $('#share', body).onclick = () => openShare([n], n.title);
      // Quick title edit: swap the heading for an input right where it is.
      const row = $('#titleRow', body);
      const editTitle = () => {
        row.innerHTML = `<input class="input title-input" id="titleInput" value="${esc(n.title || '')}" placeholder="Title" maxlength="140" enterkeyhint="done">
          <button class="icon-btn" id="titleCancel" aria-label="Cancel">${ICONS.close}</button>
          <button class="ink-btn sm" id="titleSave" aria-label="Save title">${ICONS.check}</button>`;
        const inp = $('#titleInput', row);
        inp.focus();
        inp.select();
        const save = async () => {
          const t = inp.value.trim();
          if (!t) { toast('Title can\'t be empty'); inp.focus(); return; }
          if (t !== n.title) { n.title = t; await saveNote(n); render(); toast('Title saved'); }
          openDetail(n.id);
        };
        $('#titleSave', row).onclick = save;
        $('#titleCancel', row).onclick = () => openDetail(n.id);
        inp.onkeydown = e => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          if (e.key === 'Escape') openDetail(n.id);
        };
      };
      $('#editTitle', body).onclick = editTitle;
      $('.detail-title', body).onclick = editTitle;
      $('#del', body).onclick = async () => {
        if (!confirm('Delete this memory? This cannot be undone.')) return;
        await removeNote(n);
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
        ${state.tab === 'memories' && filteredNotes().length !== state.notes.length
          ? `<button id="expView">${ICONS.file} Export / share this view<span class="count">${filteredNotes().length} notes</span></button>` : ''}
        <button id="exp">${ICONS.file} Export / share all<span class="count">${state.notes.length} notes</span></button>
        <button id="imp">${ICONS.file} Import backup<input type="file" id="impFile" accept="application/json,.json" hidden></button>
        <button id="ntf">${ICONS.bell} Reminder alerts<span class="count">${perm === 'granted' ? 'On' : perm === 'denied' ? 'Blocked' : perm === 'unsupported' ? 'Not supported' : 'Off'}</span></button>
      </div>
      <h2 style="margin-top:22px">☁️ Google Drive</h2>
      ${!Drive.configured
        ? `<p class="small muted">Drive sync needs a one-time Google setup (an OAuth Client ID) before it can be switched on.</p>`
        : !state.drive.connected
          ? `<p class="small muted">Back up all memories, photos and recordings to a folder in your Google Drive, and keep phones in sync.</p>
             <button class="btn" id="driveConnect" style="width:100%">Connect Google Drive</button>`
          : `<p class="small muted">Signed in${state.drive.email ? ' as <b>' + esc(state.drive.email) + '</b>' : ''} · last synced ${esc(agoLabel(state.drive.lastSync))}<br>
             Folder in Drive: <b>Idea Organizer Backup</b></p>
             <div class="menu-list">
               <button id="driveSync">☁️ Sync now<span class="count">${state.notes.length} notes</span></button>
               <button id="driveAuto">🔁 Auto sync after changes<span class="count">${state.drive.auto ? 'On' : 'Off'}</span></button>
               <button id="driveOff">⏏️ Disconnect Google Drive<span class="count">Keeps the backup</span></button>
             </div>`}
      <hr class="sep">
      <p class="small muted"><b>AI upgrade:</b> not connected. Titles, summaries, tags and reminders come from the on-device rules engine.
      An AI key can be added later to upgrade them.</p>
      <p class="small muted"><b>Storage:</b> memories are kept on this device${state.drive.connected ? ' and synced to your Google Drive' : '. Connect Google Drive, or export a backup regularly'}.</p>
      <div class="row end"><button class="btn danger small" id="wipe">Delete all data</button></div>
    `, body => {
      $('#exp', body).onclick = () => openShare(state.notes, 'All memories');
      const ev = $('#expView', body);
      if (ev) ev.onclick = () => openShare(filteredNotes(), viewTitle());
      $('#imp', body).onclick = () => $('#impFile', body).click();
      $('#impFile', body).onchange = e => importBackup(e.target.files[0]);
      $('#ntf', body).onclick = async () => {
        if (perm === 'default') await Notification.requestPermission();
        else if (perm === 'denied') toast('Alerts are blocked. Allow notifications in the browser site settings.');
        openMoreMenu();
      };
      const dc = $('#driveConnect', body);
      if (dc) dc.onclick = async () => { closeSheet(); await connectDrive(); render(); };
      const ds = $('#driveSync', body);
      if (ds) ds.onclick = async () => { closeSheet(); await syncNow(true); };
      const da = $('#driveAuto', body);
      if (da) da.onclick = async () => { state.drive.auto = !state.drive.auto; await saveDriveState(); openMoreMenu(); };
      const doff = $('#driveOff', body);
      if (doff) doff.onclick = async () => {
        if (!confirm('Stop syncing with Google Drive? Your backup stays in Drive.')) return;
        await Drive.disconnect();
        state.drive.connected = false;
        state.drive.email = '';
        await saveDriveState();
        openMoreMenu();
        render();
      };
      $('#wipe', body).onclick = async () => {
        if (!confirm(state.drive.connected
          ? 'Delete ALL memories and files on this device? Your Google Drive backup is kept, and the next sync will bring them back unless you disconnect Drive first.'
          : 'Delete ALL memories and files on this device?')) return;
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

  // ---------- Share / export ------------------------------------------------
  // Everything goes out through the phone's own share menu (navigator.share),
  // which lists WhatsApp, Google Drive, Dropbox, Box, Gmail and any other
  // installed app, so no per-service login is needed. Where sharing files
  // isn't supported, the file is downloaded instead.
  const FORMATS = {
    doc: { label: 'Word', ext: 'doc', mime: 'application/msword' },
    txt: { label: 'Text', ext: 'txt', mime: 'text/plain' },
    md: { label: 'Markdown', ext: 'md', mime: 'text/markdown' },
    csv: { label: 'Spreadsheet (CSV)', ext: 'csv', mime: 'text/csv', many: true },
    json: { label: 'Backup (re-importable)', ext: 'json', mime: 'application/json', many: true },
  };

  const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const slug = s => (s || 'memory').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'memory';
  const fullDate = ts => dateStamp(ts, ', ');
  const stampLine = n => `Saved ${dateStamp(n.createdAt, ' at ')}${wasEdited(n) ? ` · Edited ${dateStamp(n.updatedAt, ' at ')}` : ''}`;
  const extraTags = n => (n.tags || []).filter(t => t !== (n.folder || 'Inbox'));
  const remLine = r => `${r.text}${r.due ? ' (' + whenLabel(r.due) + ')' : ''}${r.done ? ' [done]' : ''}`;

  function noteText(n) {
    const out = [n.title || 'Untitled memory', stampLine(n), `${n.folder || 'Inbox'}${extraTags(n).length ? ' · ' + extraTags(n).join(', ') : ''}`];
    if (n.summary) out.push('', 'Summary:', n.summary);
    if ((n.reminders || []).length) out.push('', 'Reminders:', ...n.reminders.map(r => '• ' + remLine(r)));
    if (n.body && n.body !== n.summary) out.push('', n.type === 'voice' ? 'Transcript:' : 'Note:', n.body);
    if ((n.links || []).length) out.push('', 'Links:', ...n.links);
    const files = n.attachments || [];
    if (files.length) out.push('', 'Attachments: ' + files.map(a => a.name).join(', '));
    return out.join('\n');
  }

  function noteMarkdown(n) {
    const out = [`## ${n.title || 'Untitled memory'}`, `*${stampLine(n)} · ${n.folder || 'Inbox'}*${(n.tags || []).length ? '  \n' + n.tags.map(t => '#' + t.replace(/\s+/g, '')).join(' ') : ''}`];
    if (n.summary) out.push('', `**Summary:** ${n.summary}`);
    if ((n.reminders || []).length) out.push('', '**Reminders**', ...n.reminders.map(r => `- [${r.done ? 'x' : ' '}] ${r.text}${r.due ? ' — ' + whenLabel(r.due) : ''}`));
    if (n.body && n.body !== n.summary) out.push('', `**${n.type === 'voice' ? 'Transcript' : 'Note'}**`, '', n.body);
    if ((n.links || []).length) out.push('', ...n.links.map(l => `- <${l}>`));
    return out.join('\n');
  }

  function noteHTML(n) {
    const p = s => esc(s).replace(/\n/g, '<br>');
    return `<h2>${esc(n.title || 'Untitled memory')}</h2>
      <p class="m">${esc(stampLine(n))} · ${esc(n.folder || 'Inbox')}${extraTags(n).length ? ' · ' + esc(extraTags(n).join(', ')) : ''}</p>
      ${n.summary ? `<p><b>Summary:</b> ${p(n.summary)}</p>` : ''}
      ${(n.reminders || []).length ? `<p><b>Reminders</b></p><ul>${n.reminders.map(r => `<li>${r.done ? '☑' : '☐'} ${esc(remLine(r))}</li>`).join('')}</ul>` : ''}
      ${n.body && n.body !== n.summary ? `<p><b>${n.type === 'voice' ? 'Transcript' : 'Note'}</b></p><p>${p(n.body)}</p>` : ''}
      ${(n.links || []).length ? `<p>${n.links.map(l => `<a href="${esc(l)}">${esc(l)}</a>`).join('<br>')}</p>` : ''}`;
  }

  function docHTML(notes, title, images = {}) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{font-family:Calibri,Segoe UI,Arial,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111;line-height:1.45}
      h1{font-size:22px}h2{font-size:18px;margin:28px 0 4px;border-top:1px solid #ccc;padding-top:16px}.m{color:#666;font-size:13px;margin:0 0 8px}
      img{max-width:100%;max-height:420px;margin:8px 0}ul{padding-left:20px}</style></head><body>
      <h1>${esc(title)}</h1><p class="m">Exported ${esc(fullDate(Date.now()))} · ${plural(notes.length, 'memory').replace('memorys', 'memories')}</p>
      ${notes.map(n => noteHTML(n) + (n.attachments || []).filter(a => a.kind === 'image' && images[a.blobId]).map(a => `<img src="${images[a.blobId]}" alt="">`).join('')).join('')}
      </body></html>`;
  }

  function csvText(notes) {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Time', 'Title', 'Folder', 'Tags', 'Summary', 'Note / transcript', 'Reminders', 'Links', 'Type']];
    for (const n of notes) {
      const d = new Date(n.createdAt);
      rows.push([`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        time(d), n.title, n.folder, (n.tags || []).join(', '), n.summary, n.body,
        (n.reminders || []).map(remLine).join('; '), (n.links || []).join(' '), n.type]);
    }
    // The BOM makes Excel read Telugu and other non-English text correctly.
    return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  }

  async function imagesAsDataUrls(notes) {
    const out = {};
    for (const n of notes) for (const a of n.attachments || []) {
      if (a.kind !== 'image') continue;
      const b = await DB.getBlob(a.blobId);
      if (b) out[a.blobId] = await toDataUrl(b);
    }
    return out;
  }

  async function backupJSON(notes) {
    const blobs = {};
    for (const n of notes) for (const a of n.attachments || []) {
      const b = await DB.getBlob(a.blobId);
      if (b) blobs[a.blobId] = await toDataUrl(b);
    }
    return JSON.stringify({ app: 'idea-organizer', version: 1, exportedAt: Date.now(), notes, blobs });
  }

  async function buildFile(notes, fmt, title) {
    const f = FORMATS[fmt];
    const base = notes.length === 1 ? slug(notes[0].title) : `ideas-${slug(title)}-${stamp()}`;
    let content;
    if (fmt === 'doc') content = docHTML(notes, title, await imagesAsDataUrls(notes));
    else if (fmt === 'txt') content = notes.map(noteText).join('\n\n' + '─'.repeat(30) + '\n\n');
    else if (fmt === 'md') content = (notes.length > 1 ? `# ${title}\n\n` : '') + notes.map(noteMarkdown).join('\n\n---\n\n');
    else if (fmt === 'csv') content = csvText(notes);
    else content = await backupJSON(notes);
    const name = fmt === 'json' ? `idea-organizer-backup-${stamp()}.json` : `${base}.${f.ext}`;
    return new File([content], name, { type: f.mime });
  }

  async function attachmentFiles(notes) {
    const files = [];
    for (const n of notes) for (const a of n.attachments || []) {
      const b = await DB.getBlob(a.blobId);
      if (b) files.push(new File([b], a.name || 'photo.jpg', { type: a.mime || b.type }));
    }
    return files;
  }

  function download(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // Returns true when the share menu opened (or the user cancelled it).
  async function shareFiles(files, title, text) {
    const data = { files, title };
    if (text) data.text = text;
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share(data); return true; } catch (e) { return e.name === 'AbortError'; }
    }
    return false;
  }

  function printNotes(notes, title, images) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(docHTML(notes, title, images));
    frame.contentDocument.close();
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 60000);
    }, 400);
  }

  function openShare(notes, title) {
    if (!notes.length) { toast('Nothing to share'); return; }
    const one = notes.length === 1;
    let fmt = 'doc';
    const hasPhotos = notes.some(n => (n.attachments || []).some(a => a.kind === 'image'));
    const canFiles = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }));
    const fmtButtons = () => Object.entries(FORMATS).filter(([, f]) => !one || !f.many)
      .map(([k, f]) => `<button class="chip ${k === fmt ? '' : 'tag'}" data-fmt="${k}">${f.label}</button>`).join('');
    const SHARE_IC = '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>';
    const WA_IC = '<svg viewBox="0 0 24 24"><path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.4-2-1-1 .9a4 4 0 0 1-2-2l.9-1-1-2z" fill="currentColor" stroke="none"/></svg>';
    const MAIL_IC = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
    const COPY_IC = '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
    const PRINT_IC = '<svg viewBox="0 0 24 24"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>';
    const DL_IC = '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

    openSheet(`
      <div class="sheet-head"><h2>${one ? 'Share memory' : `Share ${notes.length} memories`}</h2>
        <button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
      ${one ? `<p class="muted small" style="margin-top:-8px">${esc(notes[0].title || 'Untitled memory')}</p>` : `<p class="muted small" style="margin-top:-8px">${esc(title)}</p>`}
      <div class="share-grid">
        <button id="shWa">${WA_IC}<span>WhatsApp</span></button>
        <button id="shApps">${SHARE_IC}<span>Drive, Dropbox, Box…</span></button>
        <button id="shMail">${MAIL_IC}<span>Email</span></button>
        <button id="shCopy">${COPY_IC}<span>Copy text</span></button>
      </div>
      <label class="field">File format for Drive / Dropbox / Box and downloads</label>
      <div class="chips" id="fmts">${fmtButtons()}</div>
      <div class="row" style="margin-top:16px">
        <button class="btn ghost grow" id="shPdf">${PRINT_IC} PDF / Print</button>
        <button class="btn ghost grow" id="shDl">${DL_IC} Download file</button>
      </div>
      <p class="note-banner" style="text-align:left">"Drive, Dropbox, Box…" opens your phone's share menu: pick Google Drive, Dropbox, Box, Gmail, Telegram or any installed app.
      ${hasPhotos ? 'Photos are sent along with the file.' : ''} ${canFiles ? '' : 'This browser can\'t share files, so it will download them instead.'}</p>
    `, body => {
      $('[data-close]', body).onclick = () => closeSheet();
      const bindFmts = () => $$('[data-fmt]', body).forEach(b => b.onclick = () => { fmt = b.dataset.fmt; $('#fmts', body).innerHTML = fmtButtons(); bindFmts(); });
      bindFmts();
      const plain = () => notes.map(noteText).join('\n\n────────\n\n');

      $('#shWa', body).onclick = async () => {
        let text = plain();
        // Photos can only reach WhatsApp through the share menu.
        if (hasPhotos && canFiles) {
          const files = await attachmentFiles(notes);
          if (await shareFiles(files, title, text.slice(0, 4000))) return;
        }
        if (text.length > 3500) text = text.slice(0, 3400) + '\n…(shortened, use "Drive, Dropbox, Box…" to send the full file)';
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
      };

      $('#shApps', body).onclick = async () => {
        const file = await buildFile(notes, fmt, title);
        const files = [file, ...(fmt === 'json' ? [] : await attachmentFiles(notes))];
        if (await shareFiles(files, file.name, one ? notes[0].title : '')) return;
        if (canFiles && await shareFiles([file], file.name)) return;
        download(file);
        toast(`Saved ${file.name}. Upload it from your Downloads folder.`, 4000);
      };

      $('#shMail', body).onclick = () => {
        let text = plain();
        if (text.length > 1800) text = text.slice(0, 1700) + '\n…(shortened)';
        location.href = `mailto:?subject=${encodeURIComponent(one ? notes[0].title : title)}&body=${encodeURIComponent(text)}`;
      };

      $('#shCopy', body).onclick = async () => {
        try { await navigator.clipboard.writeText(plain()); toast('Copied. Paste it anywhere.'); }
        catch (e) { toast('Copy was blocked by the browser'); }
      };

      $('#shPdf', body).onclick = async () => {
        toast('Opening print… choose "Save as PDF"', 3500);
        printNotes(notes, one ? notes[0].title : title, await imagesAsDataUrls(notes));
      };

      $('#shDl', body).onclick = async () => {
        const file = await buildFile(notes, fmt, title);
        download(file);
        toast(`Downloaded ${file.name}`);
      };
    }, true);
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
      scheduleSync();
      closeSheet();
      render();
      toast(`Imported ${plural(added, 'new memory').replace('memorys', 'memories')}`);
    } catch (e) {
      toast('That file is not an Idea Organizer backup');
    }
  }

  // ---------- Received shares (NeoSapien, WhatsApp, Recorder, …) ------------
  // The service worker parks shared text/files in the "share-inbox" cache;
  // this turns them into one memory. Shared text (e.g. a NeoSapien transcript
  // or summary) becomes the note, so titles, tags and reminders come from it.
  async function importShared() {
    if (!('caches' in window)) return;
    const cache = await caches.open('share-inbox');
    const metaRes = await cache.match('inbox/meta');
    if (!metaRes) return;
    const meta = await metaRes.json();
    const files = [];
    for (const f of meta.files || []) {
      const res = await cache.match(f.key);
      if (res) files.push(new File([await res.blob()], f.name, { type: f.type || res.headers.get('Content-Type') || '' }));
    }
    for (const key of await cache.keys()) await cache.delete(key);

    // Some apps put the link inside the text; keep it as a link too.
    let text = [meta.title && !String(meta.text || '').startsWith(meta.title) ? meta.title : '', meta.text].filter(Boolean).join('\n\n').trim();
    const links = [];
    if (meta.url) links.push(meta.url);
    for (const m of text.match(/https?:\/\/\S+/g) || []) if (!links.includes(m)) links.push(m);
    const now = Date.now();
    const attachments = [];
    let duration = 0;
    for (const f of files) {
      const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') || /\.(m4a|mp3|aac|wav|ogg|opus|amr|3gp)$/i.test(f.name) ? 'audio' : 'file';
      const blob = kind === 'image' ? await shrinkImage(f) : f;
      if (kind === 'audio') duration += await new Promise(r => { const a = new Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => r(isFinite(a.duration) ? a.duration : 0); a.onerror = () => r(0); a.src = URL.createObjectURL(f); });
      attachments.push({ kind, name: f.name, mime: f.type, size: f.size, blobId: await DB.putBlob(blob) });
      // A shared .txt is usually a transcript: read it into the note.
      if (kind === 'file' && /^text\/|\.(txt|md)$/i.test(f.type || f.name) && f.size < 500000) text = [text, (await f.text()).trim()].filter(Boolean).join('\n\n');
    }
    const s = Smart.analyze(text, new Date(now));
    const hasAudio = attachments.some(a => a.kind === 'audio');
    const type = hasAudio ? 'voice' : attachments.some(a => a.kind === 'image') ? 'photo' : !text && links.length ? 'link' : attachments.length && !text ? 'file' : 'text';
    let title = s.title;
    if (!text) title = type === 'link' ? prettyUrl(links[0]) : attachments[0] ? attachments[0].name : 'Shared memory';
    const note = {
      id: DB.uid(), createdAt: now, updatedAt: now, type,
      title, summary: s.summary, body: text,
      folder: s.tags[0] || 'Inbox', tags: [...new Set([...s.tags, 'Shared'])], reminders: s.reminders,
      links, attachments, duration: Math.round(duration), source: 'share',
    };
    if (!text && !attachments.length && !links.length) { toast('Nothing was shared'); return; }
    await saveNote(note);
    setTab('memories');
    toast(note.reminders.length ? `Added from share · ${plural(note.reminders.length, 'reminder')}` : 'Added from share');
    setTimeout(() => openDetail(note.id), 120);
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
    const shared = new URLSearchParams(location.search).get('shared');
    if (shared) {
      history.replaceState(null, '', location.pathname);
      if (shared === 'error') toast('Could not receive the shared item. Try sharing again.');
      else importShared();
    }
    checkDue();
    setInterval(checkDue, 30000);
    // Pick up changes made on other devices when the app opens or comes back.
    const syncIfStale = () => {
      if (Drive.configured && state.drive.connected && state.drive.auto && Date.now() - (state.drive.lastSync || 0) > 5 * 60000) syncNow(false);
    };
    syncIfStale();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDue(); render(); syncIfStale(); } });
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.open) openDetail(e.data.open); });
    }
  })();
})();
