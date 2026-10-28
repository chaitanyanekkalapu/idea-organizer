# Idea Organizer

A phone web app (PWA) for capturing ideas by voice, text, photo, link or file.
It auto-writes a title, summary and tags, pulls reminders out of what you say,
and lets you search everything from the Ask tab. No AI service and no account:
all data stays on the phone.

## What it does

| Tab | What you get |
|---|---|
| Home | Big record button, quick Type/Photo/Link/File buttons, upcoming reminders, recent memories |
| Ask | Search your notes in plain words: "what did I say about Medical?", "reminders this week", "what did I record yesterday?" |
| Memories | All notes grouped by day, folder picker, search box, filter by type or tag |
| Reminders | Scheduled / No date / Done, tick to complete, one tap to add to Google Calendar |

**Voice.** A plain audio recorder (no built-in speech-to-text: the phone
couldn't record and transcribe at the same time). Record in the app, use
📱 Phone recorder to record with the phone's own recorder app, or 📂 Import
audio. Transcripts come from NeoSapien (see below) or 📋 Paste.

**Reminders.** Phrases such as "call Ravi tomorrow at 5", "send the chart on
Friday morning", "book the hall on 5th Nov", "in 2 hours", or Telugu రేపు / ఉదయం
become dated reminders. Alerts fire while the app is open; for a guaranteed
phone alarm tap the calendar icon to add it to Google Calendar.

**From NeoSapien (or any app).** Idea Organizer is a share destination once
installed to the home screen. In NeoSapien open a memory → Share → Idea
Organizer: the shared transcript/summary (and audio, if sent) becomes a new
memory with titles, tags and reminders. Or copy the text and tap 📋 Paste.

**Share / export.** Tap **Share** on a memory, or the share icon on the
Memories screen to send the whole current view (folder, tag or search):

- **WhatsApp:** sends the text (and photos, through the share menu)
- **Drive, Dropbox, Box…:** opens the phone's share menu with a file; pick
  Google Drive, Dropbox, Box, Gmail, Telegram or any installed app
- **Email**, **Copy text**, **PDF / Print** (choose "Save as PDF")
- **Download file** in Word, Text, Markdown, Spreadsheet (CSV) or
  Backup (`.json`, re-importable)

**Backup.** Share → Backup (re-importable) → Drive/Dropbox keeps a copy of all
notes and photos. Settings (⋯) → Import backup restores it.

## Google Drive backup & sync

Settings (⋯) → **Connect Google Drive**. Everything (memories, photos,
recordings, files) syncs to a **Idea Organizer Backup** folder in your Drive,
plus a readable `notes.md`. Sync is two-way: open the app on another phone,
connect the same Google account, and everything comes down. Deleting a memory
syncs too (its files go to Drive's trash). The app uses the `drive.file`
permission, so it can only see files it created.

**One-time setup: create the OAuth Client ID** (Google requires one per app):

1. Go to https://console.cloud.google.com/ → create a project, e.g. "Idea Organizer".
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding /
   Audience): app name "Idea Organizer", your email as support and developer
   contact, User type **External**. Under **Audience → Test users** add the
   Gmail account(s) you'll back up to. (Testing mode is fine for personal use.)
4. **Data access → Add or remove scopes** → add `.../auth/drive.file`.
5. **Clients (Credentials) → Create client → OAuth client ID** → type
   **Web application**. Under **Authorized JavaScript origins** add
   `https://chaitanyanekkalapu.github.io` (and `http://localhost:8790` for local
   testing). No redirect URIs needed. Create.
6. Copy the **Client ID** (`…apps.googleusercontent.com`) into
   `js/config.js` → `googleClientId`, then publish.

In Testing mode Google may ask you to sign in again about once a week; the
Home screen shows "Tap to sync with Google Drive" when that's needed.

## Run on this PC

```bash
python -m http.server 8790 --directory C:\idea-organizer
```

Then open http://localhost:8790.

## Put it on your phone

The microphone and "Add to Home screen" only work over HTTPS, so the folder has
to be hosted. Any static host works; two free options:

- **GitHub Pages:** push this folder to a GitHub repo, then Settings → Pages →
  deploy from the `main` branch.
- **Netlify Drop:** drag the folder onto https://app.netlify.com/drop.

Open the URL in Chrome on the phone → menu → **Add to Home screen**.

When you change any file, bump `VERSION` in `sw.js` so phones fetch the new copy.

## Files

- `index.html`, `styles.css`: layout and dark-green theme
- `js/db.js`: IndexedDB storage (notes, photos/audio/files, settings)
- `js/smart.js`: rules engine for titles, summaries, tags, reminders and search
- `js/app.js`: screens, capture, voice recording, edit, backup
- `sw.js`, `manifest.webmanifest`, `icons/`: install and offline support

## Adding AI later

All the "smart" output comes from `Smart.analyze(text)` in `js/smart.js`, which
returns `{ title, summary, tags, reminders }`. Swap that function for a Claude
API call (through a small server so the key isn't in the page) and every screen
upgrades without other changes. The Ask tab can do the same with `Smart.search`.
