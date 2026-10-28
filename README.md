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

**Voice.** Uses Chrome's built-in speech recognition (needs internet). Pick
English or తెలుగు before recording. Mixed Tenglish works best in English mode.

**Reminders.** Phrases such as "call Ravi tomorrow at 5", "send the chart on
Friday morning", "book the hall on 5th Nov", "in 2 hours", or Telugu రేపు / ఉదయం
become dated reminders. Alerts fire while the app is open; for a guaranteed
phone alarm tap the calendar icon to add it to Google Calendar.

**Backup.** Settings (⋯) → Export backup saves a `.json` file with all notes and
photos. Import it on another phone or after reinstalling.

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
