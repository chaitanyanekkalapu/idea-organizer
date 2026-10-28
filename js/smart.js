// Rules engine: builds a title, summary, tags and reminders from a note's text
// without any AI. analyze() is the single entry point, so a Claude-backed
// version can replace it later without touching the rest of the app.
const Smart = (() => {
  const STOP = new Set(('a an the and or but if so of to in on at for from by with about as is are was were be been being ' +
    'i me my we our you your he she it its they them their this that these those there here then than ' +
    'do does did done have has had will would shall should can could may might must not no yes okay ok ' +
    'um uh hmm like just really very also actually basically right well yeah ya na anyway one thing things ' +
    'what which who whom when where why how all any some more most other into over up down out again ' +
    'get got go going gonna want wanna need note self today tomorrow').split(' '));

  const FILLER = /^(?:(?:um+|uh+|hmm+|so|okay|ok|right|well|yeah|alright|basically|note to self|self note|quick note|remember|reminder)[\s,.:-]+)+/i;

  // Topic dictionary. Each folder gets a tag when enough of its words appear.
  const TOPICS = {
    Medical: ['doctor', 'dr', 'patient', 'patients', 'medicine', 'medicines', 'medical', 'remedy', 'remedies', 'treatment',
      'symptom', 'symptoms', 'menopause', 'hot flashes', 'bp', 'sugar', 'diabetes', 'hospital', 'clinic', 'health',
      'tablet', 'dose', 'diet', 'vegetarian', 'nutrition', 'pain', 'thyroid', 'ayurveda', 'homeopathy',
      'డాక్టర్', 'మందు', 'మందులు', 'ఆసుపత్రి', 'ఆరోగ్యం', 'వైద్యం', 'నొప్పి'],
    Hypnotherapy: ['hypnosis', 'hypnotherapy', 'hypnotic', 'trance', 'induction', 'elman', 'subconscious', 'suggestion',
      'nlp', 'regression', 'deepener', 'relaxation', 'hypnotherapist', 'హిప్నాసిస్', 'హిప్నోథెరపీ'],
    Training: ['training', 'curriculum', 'course', 'workshop', 'module', 'syllabus', 'class', 'lesson', 'teach',
      'students', 'batch', 'certification', 'learn', 'learning', 'masterclass', 'శిక్షణ', 'క్లాస్'],
    Work: ['meeting', 'client', 'project', 'deadline', 'invoice', 'proposal', 'team', 'office', 'presentation',
      'agenda', 'discussion', 'discuss', 'call', 'email', 'report', 'మీటింగ్'],
    Content: ['video', 'reel', 'reels', 'youtube', 'instagram', 'content', 'script', 'thumbnail',
      'podcast', 'shoot', 'caption', 'channel'],
    Finance: ['money', 'payment', 'pay', 'bank', 'rupees', 'rs', 'budget', 'loan', 'emi', 'tax', 'gst', 'salary',
      'invest', 'fees', 'డబ్బు', 'బ్యాంక్'],
    Family: ['mom', 'dad', 'amma', 'nanna', 'wife', 'husband', 'son', 'daughter', 'kids', 'family', 'brother', 'sister',
      'birthday', 'anniversary', 'అమ్మ', 'నాన్న', 'కుటుంబం'],
    Shopping: ['buy', 'groceries', 'grocery', 'shop', 'shopping', 'amazon', 'flipkart', 'purchase',
      'కొనాలి', 'కొను'],
    Ideas: ['idea', 'ideas', 'concept', 'what if', 'maybe', 'brainstorm', 'plan', 'vision', 'startup', 'app', 'ఆలోచన'],
  };

  const WEAK = new Set(['Work', 'Ideas', 'Content']);

  const ACTION =/\b(remind(?: me)?|remember to|don'?t forget|call|phone|meet|meeting with|buy|send|email|book|schedule|follow[ -]?up|submit|pay|visit|pick up|collect|prepare|finish|complete|discuss|ask|check|order|todo|to-do|need to|have to|must|should)\b|గుర్తు|చేయాలి|కాల్ చేయ|కొనాలి|పంపాలి/i;

  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  const words = t => (t.toLowerCase().match(/[\p{L}\p{M}\p{N}']+/gu) || []);

  function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  // Speech transcripts rarely have punctuation, so long unpunctuated runs are
  // cut into ~18-word pieces to give the summary something to rank.
  function sentences(text) {
    // Line breaks end a sentence too (titles, lists), so split on them before
    // clean() flattens whitespace.
    const parts = (text || '').split(/\n+/).map(clean).filter(Boolean)
      .flatMap(line => line.split(/(?<=[.!?।])\s+/)).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const w = p.split(' ');
      if (w.length <= 28) { out.push(p); continue; }
      for (let i = 0; i < w.length; i += 18) out.push(w.slice(i, i + 18).join(' '));
    }
    return out;
  }

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  function makeTitle(text) {
    let first = (sentences(text)[0] || '').replace(FILLER, '').replace(/[.!?,;:]+$/, '');
    if (!first) return 'Untitled memory';
    const w = first.split(' ');
    if (w.length > 9) first = w.slice(0, 9).join(' ') + '…';
    return cap(first);
  }

  function makeSummary(text) {
    const sents = sentences(text);
    if (sents.length <= 2) {
      const s = clean(text).replace(FILLER, '');
      return cap(s.length > 220 ? s.slice(0, 217).replace(/\s\S*$/, '') + '…' : s);
    }
    const freq = {};
    for (const w of words(text)) if (!STOP.has(w) && w.length > 2) freq[w] = (freq[w] || 0) + 1;
    const scored = sents.map((s, i) => {
      const ws = words(s).filter(w => !STOP.has(w));
      const score = ws.reduce((n, w) => n + (freq[w] || 0), 0) / Math.max(4, ws.length) + (i === 0 ? 0.6 : 0);
      return { s, i, score };
    });
    const top = scored.sort((a, b) => b.score - a.score).slice(0, 2).sort((a, b) => a.i - b.i);
    let sum = top.map(x => x.s.replace(/[.!?]?$/, '.')).join(' ');
    if (sum.length > 260) sum = sum.slice(0, 257).replace(/\s\S*$/, '') + '…';
    return cap(sum);
  }

  function makeTags(text) {
    const lower = ' ' + text.toLowerCase() + ' ';
    const ws = new Set(words(text));
    const tags = [];
    for (const [topic, keys] of Object.entries(TOPICS)) {
      let hits = 0;
      for (const k of keys) {
        if (k.includes(' ') ? lower.includes(k) : ws.has(k)) hits++;
      }
      // Broad topics need two clues so one stray word doesn't tag a note.
      if (hits >= (WEAK.has(topic) ? 2 : 1)) tags.push({ topic, hits });
    }
    const hash = (text.match(/#[\p{L}\p{N}_]+/gu) || []).map(h => cap(h.slice(1)));
    const ranked = tags.sort((a, b) => b.hits - a.hits).slice(0, 3).map(t => t.topic);
    return [...new Set([...hash, ...ranked])];
  }

  // ---- Date / time parsing ------------------------------------------------
  function at(d, h, m = 0) { const x = new Date(d); x.setHours(h, m, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function parseTime(t) {
    let m = t.match(/\b(\d{1,2})(?::|\.)(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/i) ||
            t.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/i) ||
            t.match(/\bat\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th|\/|-|min|hour|day|week))/i);
    if (m) {
      let h = +m[1];
      let min = m[2] && /^\d+$/.test(m[2]) ? +m[2] : 0;
      const ap = (m[3] || (m[2] && !/^\d+$/.test(m[2]) ? m[2] : '') || '').toLowerCase().replace(/\./g, '');
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (!ap && h >= 1 && h <= 7) h += 12; // "at 5" almost always means 5 pm
      if (h < 24 && min < 60) return { h, m: min };
    }
    if (/\bnoon\b/i.test(t)) return { h: 12, m: 0 };
    if (/\bmorning\b|ఉదయం/i.test(t)) return { h: 9, m: 0 };
    if (/\bafternoon\b|మధ్యాహ్నం/i.test(t)) return { h: 14, m: 0 };
    if (/\bevening\b|సాయంత్రం/i.test(t)) return { h: 18, m: 0 };
    if (/\btonight\b|\bnight\b|రాత్రి/i.test(t)) return { h: 20, m: 0 };
    return null;
  }

  function parseDay(t, now) {
    const s = t.toLowerCase();
    let m;
    if ((m = s.match(/\bin\s+(\d+|an?|one|two|three)\s+(minute|min|hour|hr|day|week)s?\b/))) {
      const n = { a: 1, an: 1, one: 1, two: 2, three: 3 }[m[1]] || +m[1];
      const unit = m[2];
      if (unit.startsWith('min')) return { exact: new Date(now.getTime() + n * 60000) };
      if (unit.startsWith('h')) return { exact: new Date(now.getTime() + n * 3600000) };
      return { day: addDays(now, unit === 'week' ? n * 7 : n) };
    }
    if (/day after tomorrow|ఎల్లుండి/.test(s)) return { day: addDays(now, 2) };
    if (/\btomorrow\b|\btmrw\b|రేపు/.test(s)) return { day: addDays(now, 1) };
    if (/\btoday\b|\btonight\b|ఈరోజు|ఈ రోజు|ఇవాళ/.test(s)) return { day: new Date(now) };
    if (/\bnext week\b|వచ్చే వారం/.test(s)) return { day: addDays(now, 7) };
    if (/\bnext month\b/.test(s)) { const d = new Date(now); d.setMonth(d.getMonth() + 1); return { day: d }; }
    if (/\bweekend\b/.test(s)) return { day: addDays(now, (6 - now.getDay() + 7) % 7 || 7) };
    for (let i = 0; i < 7; i++) {
      const re = new RegExp('\\b(next\\s+)?' + DAYS[i] + '\\b');
      if ((m = s.match(re))) {
        const diff = (i - now.getDay() + 7) % 7 || 7;
        return { day: addDays(now, diff) };
      }
    }
    // "25th oct", "oct 25", "25 october"
    const mon = '(' + MONTHS.join('|') + ')[a-z]*';
    if ((m = s.match(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + mon + '\\b'))) ||
        (m = s.match(new RegExp('\\b' + mon + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b')))) {
      const day = /^\d/.test(m[1]) ? +m[1] : +m[2];
      const monName = /^\d/.test(m[1]) ? m[2] : m[1];
      const d = new Date(now.getFullYear(), MONTHS.indexOf(monName.slice(0, 3)), day);
      if (d < at(now, 0)) d.setFullYear(d.getFullYear() + 1);
      return { day: d };
    }
    // "25/10" or "25-10" (day first, Indian style)
    if ((m = s.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/))) {
      const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
      const d = new Date(y, +m[2] - 1, +m[1]);
      if (!isNaN(d) && +m[2] <= 12) {
        if (!m[3] && d < at(now, 0)) d.setFullYear(d.getFullYear() + 1);
        return { day: d };
      }
    }
    return null;
  }

  // Returns a due timestamp, or null when the text names no date or time.
  function parseWhen(text, now = new Date()) {
    const day = parseDay(text, now);
    if (day && day.exact) return day.exact.getTime();
    const time = parseTime(text);
    if (!day && !time) return null;
    let d = day ? day.day : new Date(now);
    d = at(d, time ? time.h : 9, time ? time.m : 0);
    if (!day && d <= now) d = addDays(d, 1);
    return d.getTime();
  }

  // A clause is a task when it says so outright ("need to", "remind me",
  // "చేయాలి"), opens with an action verb ("Call Ravi…"), or pairs an action
  // with a date. "He outlined topics to discuss" is a description, not a task.
  const STRONG = /\b(remind(?: me)?|remember to|don'?t forget|need to|have to|must|todo|to-do)\b|గుర్తు|చేయాలి|కొనాలి|పంపాలి/i;
  function isTask(c, now) {
    if (STRONG.test(c)) return true;
    if (!ACTION.test(c)) return false;
    const opening = c.split(/\s+/).slice(0, 3).join(' ');
    return ACTION.test(opening) || parseWhen(c, now) !== null;
  }

  function makeReminders(text, now = new Date()) {
    const out = [];
    const seen = new Set();
    // Split on sentence ends and on joining words so "call X and buy Y" gives two items.
    const clauses = (text || '').split(/\n+/).map(clean).join('\n').split(/(?<=[.!?।])\s+|\n+|;\s*|\s+(?:and then|also|and also)\s+|,?\s+and\s+(?=(?:call|buy|send|pay|book|meet|email|order|visit|submit|collect|pick up|prepare|finish|check|ask|remind)\b)/i);
    for (let c of clauses) {
      c = c.replace(FILLER, '').replace(/^(?:also|and|then|and then)\s+/i, '').trim();
      if (c.length < 4 || !isTask(c, now)) continue;
      let task = c.replace(/^(?:i\s+)?(?:please\s+)?(?:remind me to|remind me|remember to|don'?t forget to|i need to|i have to|need to|have to|i must|todo:?|to-do:?)\s*/i, '');
      task = cap(task.replace(/[.!?]+$/, ''));
      if (task.length > 140) task = task.slice(0, 137).replace(/\s\S*$/, '') + '…';
      const key = task.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: DB.uid(), text: task, due: parseWhen(c, now), done: false });
      if (out.length >= 6) break;
    }
    return out;
  }

  function analyze(text, now = new Date()) {
    const t = clean(text);
    if (!t) return { title: '', summary: '', tags: [], reminders: [] };
    return {
      title: makeTitle(t),
      summary: makeSummary(text),
      tags: makeTags(t),
      reminders: makeReminders(text, now),
    };
  }

  // ---- Search for the Ask tab ---------------------------------------------
  function terms(q) {
    return words(q).filter(w => !STOP.has(w) && w.length > 1 &&
      !['did', 'say', 'said', 'tell', 'told', 'about', 'notes', 'memory', 'memories', 'find', 'show', 'list'].includes(w));
  }

  function noteText(n) {
    return [n.title, n.summary, n.body, (n.tags || []).join(' '), n.folder || '', (n.links || []).join(' '),
      (n.reminders || []).map(r => r.text).join(' ')].join(' \n ');
  }

  function search(notes, query) {
    const qs = terms(query);
    if (!qs.length) return [];
    const results = [];
    for (const n of notes) {
      const hay = noteText(n).toLowerCase();
      let score = 0;
      let matched = 0;
      for (const q of qs) {
        const stem = q.length > 4 ? q.slice(0, -1) : q;
        const count = hay.split(stem).length - 1;
        if (count) { matched++; score += 1 + Math.log(1 + count); }
        if ((n.title || '').toLowerCase().includes(stem)) score += 2;
        if ((n.tags || []).some(t => t.toLowerCase().startsWith(stem))) score += 2;
      }
      if (!matched) continue;
      score *= matched / qs.length;
      results.push({ note: n, score, snippet: snippet(n, qs) });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  function snippet(n, qs) {
    const sents = sentences([n.summary, n.body].filter(Boolean).join('\n'));
    let best = sents[0] || n.title || '';
    let bestScore = -1;
    for (const s of sents) {
      const l = s.toLowerCase();
      const sc = qs.reduce((k, q) => k + (l.includes(q.length > 4 ? q.slice(0, -1) : q) ? 1 : 0), 0);
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    return best.length > 220 ? best.slice(0, 217) + '…' : best;
  }

  return { analyze, parseWhen, search, terms, sentences };
})();
