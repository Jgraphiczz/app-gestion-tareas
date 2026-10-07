/* Intérprete de frases en español para "apuntar": detecta importe, fecha, hora, aviso y tipo (tarea / gasto / ingreso)
   sin llamar a ninguna API (instantáneo y gratis). Lo usa capture.js mientras escribes.
   parseCapture("gasolina 12 mañana a las 9") → { kind, title, amount, date:'YYYY-MM-DD', time:'HH:MM', remind, hits } */
(function (root) {
  const DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();   // misma longitud que el original (á→a, ñ→n)
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const INCOME = /\b(nomina|ingreso|ingrese|cobro|cobre|cobrado|me pagaron|me han pagado|me ingresaron|venta|vendi|reembolso|devolucion|salario|sueldo|paga extra)\b/;
  const TASK_MARK = /\b(recuerdame|avisame|recordatorio|recordarme|tengo que|hay que|no se me olvide|llamar|reunion|cita|entregar|enviar|mandar|revisar|preparar|reservar|renovar)\b/;

  function num(str) {                                   // "1.450,50" · "12,5" · "12.50" · "1.200"
    let s = String(str).trim();
    if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const v = parseFloat(s);
    return isFinite(v) ? Math.round(v * 100) / 100 : null;
  }

  function parseCapture(text, now, opts) {
    now = now || new Date();
    opts = opts || {};
    const orig = String(text || '');
    let n = norm(orig);
    const out = { kind: null, title: '', amount: null, date: null, time: null, remind: null, hits: {} };
    const cuts = [];
    const take = (re, key) => {                         // busca, apunta el trozo para borrarlo del título y lo tapa para que no lo vuelva a usar otra regla
      const m = re.exec(n); if (!m) return null;
      cuts.push([m.index, m.index + m[0].length]);
      n = n.slice(0, m.index) + ' '.repeat(m[0].length) + n.slice(m.index + m[0].length);
      if (key) out.hits[key] = orig.slice(m.index, m.index + m[0].length).trim();
      return m;
    };
    const setDate = d => { if (!out.date) out.date = ymd(d); };
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    /* ---- importe ---- */
    let m = null;
    if (!opts.noAmount) m = take(/(\d+(?:[.,]\d+)*)\s*(?:€|euros?\b|eur\b)/, 'amount') || take(/€\s*(\d+(?:[.,]\d+)*)/, 'amount');
    if (m) out.amount = num(m[1]);
    if (out.amount == null && !opts.noAmount) {                           // "gasto de 12", "nómina 1450"
      m = /\b(gasto|ingreso|gaste|pague|cobre|cobro|nomina|factura|compra|recibo|importe)\b[^\d\n]{0,14}(\d+(?:[.,]\d+)*)(?![\d:/])/.exec(n);
      if (m) {
        const a = m.index + m[0].length - m[2].length, b = m.index + m[0].length;
        cuts.push([a, b]); out.hits.amount = orig.slice(a, b); out.amount = num(m[2]);
        n = n.slice(0, a) + ' '.repeat(b - a) + n.slice(b);
      }
    }

    /* ---- aviso ---- */
    if (take(/\b(recuerdame|avisame|recordatorio|recordarme|no se me olvide)\b( que)?/, null)) out.remind = 0;

    /* ---- duración relativa: "en 2 horas", "en 3 dias" ---- */
    m = take(/\ben\s+(\d+|un|una|media)\s+(hora|horas|minuto|minutos|min|dia|dias|semana|semanas)\b/, 'date');
    if (m) {
      const q = m[1] === 'media' ? 0.5 : (m[1] === 'un' || m[1] === 'una') ? 1 : parseInt(m[1], 10), u = m[2];
      if (/^(hora|minuto|min)/.test(u)) {
        const d = new Date(now.getTime() + q * (u[0] === 'h' ? 3600e3 : 60e3));
        d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);       // al siguiente múltiplo de 5 min
        out.date = ymd(d); out.time = pad(d.getHours()) + ':' + pad(d.getMinutes());
      } else setDate(addDays(today, u[0] === 's' ? q * 7 : q));
    }

    /* ---- franja del día ---- */
    let part = null;
    if (take(/\b(por la manana|de la manana|en la manana)\b/, null)) part = 'am';
    else if (take(/\b(por la tarde|de la tarde|en la tarde)\b/, null)) part = 'pm';
    else if (take(/\b(por la noche|de la noche|en la noche)\b/, null)) part = 'night';
    else if (take(/\b(al mediodia|a mediodia)\b/, null)) { out.time = '12:00'; }

    /* ---- fecha ---- */
    if (!out.date) {
      if (take(/\bpasado\s+manana\b/, 'date')) setDate(addDays(today, 2));
      else if (take(/\bmanana\b/, 'date')) setDate(addDays(today, 1));
      else if (take(/\bhoy\b/, 'date')) setDate(today);
      else if (take(/\banteayer\b/, 'date')) setDate(addDays(today, -2));
      else if (take(/\bayer\b/, 'date')) setDate(addDays(today, -1));
      else if ((m = take(new RegExp('\\b(?:el\\s+|este\\s+|proximo\\s+|el proximo\\s+)?(' + DAYS.filter(Boolean).join('|') + ')\\b(?:\\s+que viene)?'), 'date'))) {
        let diff = (DAYS.indexOf(m[1]) - today.getDay() + 7) % 7;
        if (diff === 0) diff = 7;                                     // "el miércoles" siendo miércoles = el de la semana que viene
        setDate(addDays(today, diff));
      } else if (take(/\b(fin de semana|finde)\b/, 'date')) setDate(addDays(today, (6 - today.getDay() + 7) % 7 || 7));
      else if (take(/\b(semana que viene|proxima semana|la semana proxima)\b/, 'date')) setDate(addDays(today, (8 - today.getDay()) % 7 || 7));
      else if ((m = take(new RegExp('\\b(\\d{1,2})\\s+de\\s+(' + MONTHS.join('|') + ')(?:\\s+de(?:l)?\\s+(\\d{4}))?\\b'), 'date'))) {
        let y = m[3] ? +m[3] : today.getFullYear(); const d = new Date(y, MONTHS.indexOf(m[2]), +m[1]);
        if (!m[3] && d < today) d.setFullYear(y + 1);
        setDate(d);
      } else if ((m = take(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/, 'date'))) {
        let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : today.getFullYear(); const d = new Date(y, +m[2] - 1, +m[1]);
        if (!m[3] && d < today) d.setFullYear(y + 1);
        if (d.getMonth() === +m[2] - 1) setDate(d);
      } else if ((m = take(/\b(?:el|dia)\s+(\d{1,2})\b(?!\s*[:h])/, 'date')) && +m[1] >= 1 && +m[1] <= 31) {
        const d = new Date(today.getFullYear(), today.getMonth(), +m[1]); if (d < today) d.setMonth(d.getMonth() + 1);
        setDate(d);
      }
    }

    /* ---- hora ---- */
    if (!out.time) {
      let h = null, mi = 0, ap = null;
      if ((m = take(/\ba\s+las?\s+(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|h|horas)?\b(?:\s+de la (manana|tarde|noche))?/, 'time'))) { h = +m[1]; mi = m[2] ? +m[2] : 0; ap = m[3] === 'am' || m[3] === 'pm' ? m[3] : (m[4] === 'manana' ? 'am' : m[4] ? 'pm' : null); }
      else if ((m = take(/\ba\s+la\s+una\b/, 'time'))) { h = 1; }
      else if ((m = take(/\b(\d{1,2})[:.](\d{2})\s*(am|pm|h)?\b/, 'time'))) { h = +m[1]; mi = +m[2]; ap = m[3] === 'am' || m[3] === 'pm' ? m[3] : null; }
      else if ((m = take(/\b(\d{1,2})\s*(am|pm)\b/, 'time'))) { h = +m[1]; ap = m[2]; }
      if (h != null && h <= 24 && mi < 60) {
        if (ap === 'pm' && h < 12) h += 12;
        else if (ap === 'am' && h === 12) h = 0;
        else if (!ap && part === 'pm' && h < 12) h += 12;
        else if (!ap && part === 'night' && h < 12 && h >= 6) h += 12;
        else if (!ap && !part && h >= 1 && h <= 7) h += 12;         // "a las 5" casi siempre es por la tarde
        out.time = pad(h % 24) + ':' + pad(mi);
      } else if (h != null) delete out.hits.time;
    }
    if (!out.time && part) out.time = part === 'am' ? '09:00' : part === 'pm' ? '17:00' : '21:00';
    if (out.time && !out.date) out.date = ymd(today);              // una hora sin día = hoy

    /* ---- importe "adivinado": la frase termina en un número ("gasolina 12") ---- */
    if (out.amount == null && !opts.noAmount) {
      m = /^(?=.*[a-z])(.*?[a-z][^\d]*?)\s+(\d+(?:[.,]\d{1,2})?)\s*$/.exec(n.replace(/\s+/g, ' ').trim());
      if (m && (m[2].length >= 2 || /[.,]/.test(m[2]))) {            // una sola cifra suelta ("capítulo 5") no se toma como importe
        const idx = n.lastIndexOf(m[2]); cuts.push([idx, idx + m[2].length]); out.amount = num(m[2]); out.hits.amount = m[2];
        n = n.slice(0, idx) + ' '.repeat(m[2].length) + n.slice(idx + m[2].length);
      }
    }

    /* ---- tipo ---- */
    const plain = norm(orig);
    if (out.amount != null) out.kind = TASK_MARK.test(plain) && out.remind != null ? 'task' : (INCOME.test(plain) ? 'ingreso' : (TASK_MARK.test(plain) && out.date ? 'task' : 'gasto'));
    else out.kind = 'task';

    /* ---- título: lo que queda sin los trozos reconocidos ---- */
    cuts.sort((a, b) => a[0] - b[0]);
    let t = '', last = 0;
    for (const [a, b] of cuts) { if (a >= last) { t += orig.slice(last, a) + ' '; last = b; } }
    t += orig.slice(last);
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/^(apuntame|anotame|apunta|anota|añade|añademe|agrega|crea|pon|ponme|tengo que|hay que|necesito|quiero)\s+(que\s+)?/i, '');
    if (out.kind !== 'task') t = t.replace(/^(un\s+|el\s+)?(gasto|ingreso|pago)\s*(de|en|por)?\s+/i, '').replace(/^(gaste|pague|cobre|compre)\s+(de|en|por)?\s*/i, '');
    for (let i = 0; i < 3; i++) t = t.replace(/^(el|la|los|las|de|del|a|al|en|para|que|y|con|por)\s+/i, '').replace(/\s+(el|la|de|a|al|en|para|que|y|con|por|a las|a la)$/i, '').replace(/^[,;:.\-–\s]+|[,;:.\-–\s]+$/g, '');
    out.title = t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
    return out;
  }

  root.parseCapture = parseCapture;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseCapture };
})(typeof window !== 'undefined' ? window : globalThis);
