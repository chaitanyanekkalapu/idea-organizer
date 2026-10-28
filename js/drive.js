// Google Drive backup. Uses Google Identity Services for a sign-in token and
// the Drive v3 REST API with the drive.file scope, so the app can only see
// files it created. Layout in Drive:
//
//   Idea Organizer Backup/            (folder, appProperties.app = idea-organizer)
//     notes.json                      all memories (kind = notes)
//     notes.md                        readable copy (kind = readable)
//     <photo / recording / file>      one Drive file per attachment (kind = blob, blobId)
//
// Attachments upload once; later backups only send new ones plus notes.json.
const Drive = (() => {
  const CLIENT_ID = (window.IDEAS_CONFIG && window.IDEAS_CONFIG.googleClientId) || '';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER_NAME = 'Idea Organizer Backup';
  const APP_TAG = 'idea-organizer';

  let token = null, tokenExp = 0, tokenClient = null, gisPromise = null;
  try {
    const saved = JSON.parse(localStorage.getItem('driveToken') || 'null');
    if (saved && saved.exp > Date.now()) { token = saved.t; tokenExp = saved.exp; }
  } catch (e) {}

  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!gisPromise) {
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in. Check your internet.')); };
        document.head.appendChild(s);
      });
    }
    return gisPromise;
  }

  // prompt: 'consent' the first time, '' to refresh quietly afterwards.
  async function connect(prompt = '') {
    if (!CLIENT_ID) throw new Error('Google Drive backup is not set up yet.');
    await loadGis();
    if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} });
    return new Promise((resolve, reject) => {
      tokenClient.callback = r => {
        if (r.error) { reject(new Error(r.error_description || r.error)); return; }
        token = r.access_token;
        tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        try { localStorage.setItem('driveToken', JSON.stringify({ t: token, exp: tokenExp })); } catch (e) {}
        resolve(token);
      };
      tokenClient.error_callback = e => reject(new Error(e && e.type === 'popup_closed' ? 'Sign-in was closed.' : (e && e.message) || 'Sign-in failed.'));
      tokenClient.requestAccessToken({ prompt });
    });
  }

  const hasToken = () => !!token && Date.now() < tokenExp - 60000;

  function forget() {
    token = null;
    tokenExp = 0;
    try { localStorage.removeItem('driveToken'); } catch (e) {}
  }

  async function disconnect() {
    if (token && window.google && google.accounts) { try { google.accounts.oauth2.revoke(token, () => {}); } catch (e) {} }
    forget();
  }

  async function api(url, opts = {}) {
    if (!hasToken()) { const e = new Error('Not signed in to Google'); e.code = 'auth'; throw e; }
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
    if (res.status === 401) { forget(); const e = new Error('Google sign-in expired'); e.code = 'auth'; throw e; }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) {}
      throw new Error('Google Drive: ' + msg);
    }
    return res;
  }

  const q = s => encodeURIComponent(s);

  async function whoAmI() {
    const r = await api(`${API}/about?fields=user(emailAddress,displayName)`);
    return (await r.json()).user;
  }

  async function ensureFolder(knownId) {
    if (knownId) {
      try {
        const r = await api(`${API}/files/${knownId}?fields=id,trashed`);
        const f = await r.json();
        if (!f.trashed) return f.id;
      } catch (e) { if (e.code === 'auth') throw e; }
    }
    const query = `mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='app' and value='${APP_TAG}' }`;
    const found = await (await api(`${API}/files?q=${q(query)}&fields=files(id)&spaces=drive`)).json();
    if (found.files && found.files[0]) return found.files[0].id;
    const created = await (await api(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', appProperties: { app: APP_TAG } }),
    })).json();
    return created.id;
  }

  async function listFolder(folderId) {
    const out = [];
    let pageToken = '';
    do {
      const url = `${API}/files?q=${q(`'${folderId}' in parents and trashed=false`)}&pageSize=1000&fields=nextPageToken,files(id,name,appProperties)` + (pageToken ? `&pageToken=${pageToken}` : '');
      const j = await (await api(url)).json();
      out.push(...(j.files || []));
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  // Multipart upload: metadata + content in one request (create or replace).
  async function upload(meta, blob, fileId) {
    const boundary = 'ideas' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(meta),
      `\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    const url = fileId ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`;
    const r = await api(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    return (await r.json()).id;
  }

  async function download(fileId) {
    return (await api(`${API}/files/${fileId}?alt=media`)).blob();
  }

  // Uploads the merged state. notes: all memories; deleted: {noteId: time};
  // getBlob(id) → Blob; readable: markdown string; files: listing from pull().
  async function push({ folderId, files, notes, deleted, getBlob, readable, onProgress = () => {} }) {
    const byKind = k => files.find(f => f.appProperties && f.appProperties.kind === k);
    const blobFiles = files.filter(f => f.appProperties && f.appProperties.kind === 'blob');
    const have = new Set(blobFiles.map(f => f.appProperties.blobId));

    const todo = [];
    for (const n of notes) for (const a of n.attachments || []) if (!have.has(a.blobId)) todo.push(a);
    let done = 0;
    for (const a of todo) {
      onProgress(`Uploading ${++done} of ${todo.length}: ${a.name}`);
      const blob = await getBlob(a.blobId);
      if (!blob) continue;
      const name = (a.name || a.blobId).replace(/[\\/]/g, '_');
      await upload({ name, parents: [folderId], appProperties: { app: APP_TAG, kind: 'blob', blobId: a.blobId } }, blob.type ? blob : new Blob([blob], { type: a.mime || '' }));
      have.add(a.blobId);
    }

    // Files of deleted memories go to Drive's trash (recoverable for 30 days).
    const used = new Set(notes.flatMap(n => (n.attachments || []).map(a => a.blobId)));
    for (const f of blobFiles) {
      if (used.has(f.appProperties.blobId)) continue;
      await api(`${API}/files/${f.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    }

    onProgress('Saving notes…');
    const data = { app: APP_TAG, version: 1, savedAt: Date.now(), notes, deleted };
    const notesFile = byKind('notes');
    await upload({ name: 'notes.json', mimeType: 'application/json', ...(notesFile ? {} : { parents: [folderId] }), appProperties: { app: APP_TAG, kind: 'notes' } },
      new Blob([JSON.stringify(data)], { type: 'application/json' }), notesFile && notesFile.id);
    if (readable) {
      const mdFile = byKind('readable');
      await upload({ name: 'notes.md', ...(mdFile ? {} : { parents: [folderId] }), appProperties: { app: APP_TAG, kind: 'readable' } },
        new Blob([readable], { type: 'text/markdown' }), mdFile && mdFile.id);
    }
    return { folderId, uploaded: todo.length, at: Date.now() };
  }

  // Reads what's in Drive: notes, deletions and a fetcher for attachments.
  async function pull({ folderId, onProgress = () => {} }) {
    folderId = await ensureFolder(folderId);
    onProgress('Checking Google Drive…');
    const files = await listFolder(folderId);
    const notesFile = files.find(f => f.appProperties && f.appProperties.kind === 'notes');
    const data = notesFile ? JSON.parse(await (await download(notesFile.id)).text()) : {};
    const blobFiles = new Map(files.filter(f => f.appProperties && f.appProperties.kind === 'blob').map(f => [f.appProperties.blobId, f.id]));
    return {
      folderId,
      files,
      exists: !!notesFile,
      notes: data.notes || [],
      deleted: data.deleted || {},
      fetchBlob: async id => (blobFiles.has(id) ? download(blobFiles.get(id)) : null),
    };
  }

  return { configured: !!CLIENT_ID, connect, hasToken, disconnect, whoAmI, pull, push };
})();
