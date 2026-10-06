/* Editor de notas "todo en uno": se escribe directamente con formato (como un editor en línea)
 * y por debajo se guarda siempre Markdown (+ HTML saneado para lo que Markdown no cubre).
 *
 *   const ed = mountRichEditor(el, { markdown, renderHtml, onChange, onImageFiles, onState });
 *   ed.getMarkdown() · ed.cmd('bold') · ed.insertImage(url) · ed.focus() · ed.saveSel()
 *
 * `renderHtml(md)` es renderNoteHtml de notes-rich.js (marked + DOMPurify), así lo que se ve al
 * editar es exactamente lo que se ve al leer.
 */

/* ===================================================================== HTML → Markdown */
const ZW = /[\u200b\u2060\ufeff]/g;
const INLINE_RAW = new Set(['U', 'MARK', 'SUB', 'SUP', 'KBD', 'SMALL', 'INS', 'Q', 'ABBR', 'SAMP']);
const BLOCK_RAW = new Set(['DETAILS', 'FIGURE', 'DL', 'SUMMARY', 'FIGCAPTION']);

function escText(t) {
  return t.replace(ZW, '').replace(/\u00a0/g, ' ')
    .replace(/\\/g, '\\\\').replace(/([`*\[\]<])/g, '\\$1').replace(/~~/g, '\\~\\~')
    .replace(/(^|[^A-Za-z0-9])_|_(?![A-Za-z0-9])/g, m => m.replace('_', '\\_'));   // _ dentro de una palabra es literal
}
function escLineStart(s) {
  return s.split('\n').map(l => l
    .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*)([>+-])(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*)(\d+)([.)])(\s|$)/, '$1$2\\$3$4')
    .replace(/^(\s*)([-=]{3,})\s*$/, '$1\\$2')).join('\n');
}
function encUrl(u) { return String(u || '').trim().replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29'); }
function wrapInline(marker, inner) {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return m[2] ? m[1] + marker + m[2] + marker + m[3] : inner;
}
function attrsOf(el) {
  return [...el.attributes].map(a => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('');
}

function inlineNode(n) {
  if (n.nodeType === 3) return escText(n.nodeValue.replace(/[ \t\r\n]+/g, ' '));
  if (n.nodeType !== 1) return '';
  const tag = n.tagName;
  const kids = () => [...n.childNodes].map(inlineNode).join('');
  switch (tag) {
    case 'BR': return '\n';
    case 'B': case 'STRONG': return wrapInline('**', kids());
    case 'I': case 'EM': return wrapInline('*', kids());
    case 'S': case 'STRIKE': case 'DEL': return wrapInline('~~', kids());
    case 'CODE': {
      const t = n.textContent.replace(ZW, '');
      if (!t.trim()) return '';
      const fence = t.includes('`') ? '``' : '`';
      return fence + (t.startsWith('`') || t.endsWith('`') ? ' ' + t + ' ' : t) + fence;
    }
    case 'A': {
      const href = n.getAttribute('href');
      const inner = kids();
      return href ? `[${inner || escText(href)}](${encUrl(href)})` : inner;
    }
    case 'IMG': {
      const src = n.getAttribute('src');
      if (!src) return '';
      if (n.hasAttribute('width') || n.hasAttribute('height') || n.hasAttribute('style')) return n.outerHTML;
      const alt = (n.getAttribute('alt') || '').replace(/[\[\]]/g, '');
      const title = n.getAttribute('title');
      return `![${alt}](${encUrl(src)}${title ? ` "${title.replace(/"/g, '')}"` : ''})`;
    }
    case 'SPAN': case 'FONT':
      return n.hasAttribute('style') && tag === 'SPAN' ? `<span${attrsOf(n)}>${kids()}</span>` : kids();
    default:
      if (INLINE_RAW.has(tag)) return `<${tag.toLowerCase()}${attrsOf(n)}>${kids()}</${tag.toLowerCase()}>`;
      return kids();
  }
}
function inlineOf(el) {
  return [...el.childNodes].map(inlineNode).join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/^\n+|\n+$/g, '');
}

const isBlockTag = t => /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|HR|TABLE|DETAILS|FIGURE|DL)$/.test(t);

function listMd(list) {
  const ordered = list.tagName === 'OL';
  let n = parseInt(list.getAttribute('start') || '1', 10) || 1;
  const lines = [];
  for (const li of list.children) {
    if (li.tagName !== 'LI') continue;
    const marker = ordered ? (n++) + '. ' : '- ';
    const pad = ' '.repeat(marker.length);
    let head = '';
    const rest = [];
    for (const c of li.childNodes) {
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) rest.push(listMd(c));
      else if (c.nodeType === 1 && (c.tagName === 'P' || c.tagName === 'DIV')) head += inlineOf(c) + '\n';
      else if (c.nodeType === 1 && c.tagName === 'PRE') rest.push(codeBlockMd(c).split('\n').map(l => pad + l).join('\n').trimStart());
      else head += inlineNode(c);
    }
    const hl = head.replace(/^\n+|\n+$/g, '').split('\n').map(l => l.trimEnd());
    lines.push(marker + hl[0].trimStart());
    for (let i = 1; i < hl.length; i++) lines.push(pad + hl[i]);
    rest.forEach(r => r.split('\n').forEach(l => lines.push(pad + l)));
  }
  return lines.join('\n');
}
function codeBlockMd(pre) {
  const c = pre.cloneNode(true);
  c.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  const text = c.textContent.replace(ZW, '').replace(/\u00a0/g, ' ').replace(/\n+$/, '');
  const fence = text.includes('```') ? '````' : '```';
  return fence + '\n' + text + '\n' + fence;
}
function tableMd(table) {
  const rows = [...table.rows].map(r => [...r.cells].map(c =>
    inlineOf(c).replace(/\|/g, '\\|').replace(/\n/g, '<br>').trim() || ' '));
  if (!rows.length) return '';
  const cols = Math.max(...rows.map(r => r.length));
  const pad = r => { while (r.length < cols) r.push(' '); return '| ' + r.join(' | ') + ' |'; };
  const out = [pad(rows[0]), '| ' + Array(cols).fill('---').join(' | ') + ' |'];
  rows.slice(1).forEach(r => out.push(pad(r)));
  return out.join('\n');
}

function blocksOf(parent) {
  const out = [];
  let buf = '';
  let lastList = null;
  const push = (md, listType) => {
    if (!md) return;
    if (listType && lastList === listType) out.push('<!-- -->');     // dos listas seguidas del mismo tipo no deben fundirse
    lastList = listType || null;
    out.push(md);
  };
  const flush = () => {
    const t = buf.replace(/^\n+|\n+$/g, '');
    buf = '';
    if (t.trim()) push(escLineStart(t));
  };
  for (const n of parent.childNodes) {
    if (n.nodeType === 3) { buf += inlineNode(n); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (!isBlockTag(tag)) { buf += inlineNode(n); continue; }
    flush();
    if (tag === 'P' || tag === 'DIV') {
      if (n.attributes.length) { push(n.outerHTML); continue; }
      if ([...n.children].some(c => isBlockTag(c.tagName))) { push(blocksOf(n)); continue; }
      const t = inlineOf(n);
      if (t.trim()) push(escLineStart(t));
    } else if (/^H[1-6]$/.test(tag)) {
      if (n.attributes.length) { push(n.outerHTML); continue; }
      const t = inlineOf(n).replace(/\n+/g, ' ').trim();
      if (t) push('#'.repeat(+tag[1]) + ' ' + t);
    } else if (tag === 'UL' || tag === 'OL') {
      push(listMd(n), tag);
    } else if (tag === 'BLOCKQUOTE') {
      const inner = blocksOf(n);
      if (inner.trim()) push(inner.split('\n').map(l => l ? '> ' + l : '>').join('\n'));
    } else if (tag === 'PRE') {
      push(codeBlockMd(n));
    } else if (tag === 'HR') {
      push('---');
    } else if (tag === 'TABLE') {
      push(tableMd(n));
    } else if (BLOCK_RAW.has(tag)) {
      push(n.outerHTML);
    }
  }
  flush();
  return out.join('\n\n');
}

export function htmlToMarkdown(root) {
  return blocksOf(root).replace(/\n{3,}/g, '\n\n').trim();
}

/* ===================================================================== Editor */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function mountRichEditor(host, opts) {
  const { renderHtml, onChange = () => {}, onImageFiles = () => {}, onState = () => {} } = opts;
  const exec = (c, v) => document.execCommand(c, false, v);
  let savedRange = null;

  host.contentEditable = 'true';
  host.spellcheck = true;
  host.setAttribute('role', 'textbox');
  host.setAttribute('aria-multiline', 'true');
  host.setAttribute('data-placeholder', 'Escribe aquí… (puedes usar Markdown: # título, - lista, **negrita**)');

  function setMarkdown(md) {
    host.innerHTML = (md || '').trim() ? renderHtml(md) : '<p><br></p>';
    normalize();
  }
  function emptyDoc() {
    return host.children.length === 1 && host.firstElementChild.tagName === 'P' &&
      !host.textContent.replace(ZW, '').trim() && !host.querySelector('img');
  }
  function normalize() {
    // siempre debe haber un párrafo al final donde poder escribir (tras tabla, código, regla, lista…)
    const last = host.lastElementChild;
    if (!last || !(last.tagName === 'P' && !last.attributes.length)) host.appendChild(Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
    host.classList.toggle('is-empty', emptyDoc());
  }
  const sel = () => window.getSelection();
  const inHost = n => n && host.contains(n);
  function currentBlock() {
    const s = sel(); if (!s.rangeCount) return null;
    let n = s.anchorNode; if (!inHost(n)) return null;
    if (n.nodeType === 3) n = n.parentNode;
    while (n && n !== host) {
      if (/^(P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|TD|TH)$/.test(n.tagName)) return n;
      n = n.parentNode;
    }
    return null;
  }
  function closest(sel_) {
    const s = sel(); if (!s.rangeCount) return null;
    let n = s.anchorNode; if (!inHost(n)) return null;
    if (n.nodeType === 3) n = n.parentNode;
    const el = n.closest(sel_);
    return el && host.contains(el) ? el : null;
  }
  function setCaret(node, off) {
    const r = document.createRange(); r.setStart(node, off); r.collapse(true);
    const s = sel(); s.removeAllRanges(); s.addRange(r);
  }
  function changed() { normalize(); onChange(); }

  /* ---------- estado para la barra de herramientas ---------- */
  function getState() {
    if (!sel().rangeCount || !inHost(sel().anchorNode)) return null;
    const q = c => { try { return document.queryCommandState(c); } catch (e) { return false; } };
    let block = 'p';
    if (closest('h1')) block = 'h1'; else if (closest('h2')) block = 'h2'; else if (closest('h3')) block = 'h3';
    else if (closest('pre')) block = 'pre'; else if (closest('blockquote')) block = 'quote';
    else if (closest('ul')) block = 'ul'; else if (closest('ol')) block = 'ol';
    return { bold: q('bold'), italic: q('italic'), strike: q('strikeThrough'), code: !!closest('code'), block, link: !!closest('a') };
  }
  function emitState() { updateTableBar(); const s = getState(); if (s) onState(s); }

  /* ---------- barra de tabla: columnas y filas ---------- */
  const tbar = document.createElement('div');
  tbar.className = 'table-bar';
  tbar.style.display = 'none';
  const cellEl = () => closest('td,th');
  function cellAt(row, i) { return row.cells[Math.min(i, row.cells.length - 1)]; }
  function newCellLike(c) { const n = document.createElement(c.tagName.toLowerCase()); n.innerHTML = '<br>'; return n; }
  function removeTable(t) { t.remove(); normalize(); }
  const TABLE_OPS = {
    addCol(c) {
      const i = c.cellIndex;
      [...c.closest('table').rows].forEach(r => { if (r.cells[i]) r.cells[i].after(newCellLike(r.cells[i])); });
      return c.parentNode.cells[i + 1];
    },
    delCol(c) {
      const t = c.closest('table'), i = c.cellIndex;
      if (c.parentNode.cells.length <= 1) { removeTable(t); return null; }
      const row = c.parentNode;
      [...t.rows].forEach(r => { if (r.cells[i]) r.cells[i].remove(); });
      return cellAt(row, i);
    },
    addRow(c) {
      const row = c.parentNode, t = c.closest('table'), i = c.cellIndex;
      const nr = document.createElement('tr');
      [...row.cells].forEach(x => nr.appendChild(newCellLike(x.tagName === 'TH' ? document.createElement('td') : x)));
      if (row.parentNode.tagName === 'THEAD') {
        const body = t.tBodies[0] || t.appendChild(document.createElement('tbody'));
        body.insertBefore(nr, body.firstChild);
      } else row.after(nr);
      return cellAt(nr, i);
    },
    delRow(c) {
      const row = c.parentNode, t = c.closest('table'), i = c.cellIndex;
      if (t.rows.length <= 1) { removeTable(t); return null; }
      const target = row.nextElementSibling || row.previousElementSibling || (row.parentNode.nextElementSibling && row.parentNode.nextElementSibling.rows[0]) || (row.parentNode.previousElementSibling && row.parentNode.previousElementSibling.rows[0]);
      row.remove();
      [...t.tBodies].forEach(b => { if (!b.rows.length) b.remove(); });
      if (t.tHead && !t.tHead.rows.length) t.tHead.remove();
      return target ? cellAt(target, i) : null;
    },
    delTable(c) { removeTable(c.closest('table')); return null; },
  };
  [['addCol', '+ Columna', 'btn-soft'], ['delCol', '− Columna', 'btn-outline'], ['addRow', '+ Fila', 'btn-soft'], ['delRow', '− Fila', 'btn-outline'], ['delTable', 'Borrar tabla', 'btn-danger']].forEach(([op, label, cls]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-sm ' + cls; b.textContent = label;
    b.onmousedown = e => e.preventDefault();                       // no perder el cursor de la celda
    b.onclick = () => {
      const c = cellEl(); if (!c) return;
      const next = TABLE_OPS[op](c);
      if (next) setCaret(next, 0);
      changed(); emitState();
    };
    tbar.appendChild(b);
  });
  if (host.parentNode) host.parentNode.insertBefore(tbar, host);
  function updateTableBar() { tbar.style.display = cellEl() ? 'flex' : 'none'; }

  /* ---------- comandos ---------- */
  function toggleBlock(tag) {
    exec('formatBlock', closest(tag) ? '<p>' : `<${tag}>`);
  }
  function normUrl(u) {
    u = (u || '').trim(); if (!u) return '';
    return /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(u) ? u : 'https://' + u;
  }
  function doLink() {
    const existing = closest('a');
    const keep = sel().rangeCount ? sel().getRangeAt(0).cloneRange() : null;
    const raw = prompt('Dirección del enlace (déjala vacía para quitarlo):', existing ? existing.getAttribute('href') : 'https://');
    if (keep) { const s = sel(); s.removeAllRanges(); s.addRange(keep); }     // el diálogo puede haber quitado la selección
    if (raw === null) return;                                                   // cancelado: no se toca nada
    const url = normUrl(raw);
    if (!url || url === 'https://') { if (existing) exec('unlink'); return; }
    if (sel().isCollapsed && !existing) exec('insertHTML', `<a href="${esc(url)}">${esc(url)}</a>\u200b`);
    else exec('createLink', url);
  }
  function doInlineCode() {
    const c = closest('code');
    if (c) {                                        // quitar el formato de código
      const t = document.createTextNode(c.textContent); c.replaceWith(t); setCaret(t, t.length); return;
    }
    const text = sel().toString() || 'código';
    exec('insertHTML', `<code>${esc(text)}</code>\u200b`);
  }
  const TABLE = '<table><thead><tr><th><br></th><th><br></th><th><br></th></tr></thead><tbody>' +
    '<tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>';

  function cmd(name) {
    host.focus(); restoreSel();
    switch (name) {
      case 'bold': exec('bold'); break;
      case 'italic': exec('italic'); break;
      case 'strike': exec('strikeThrough'); break;
      case 'h1': case 'h2': case 'h3': toggleBlock(name); break;
      case 'quote': closest('blockquote') ? exec('outdent') : exec('formatBlock', '<blockquote>'); break;
      case 'ul': exec('insertUnorderedList'); break;
      case 'ol': exec('insertOrderedList'); break;
      case 'code': doInlineCode(); break;
      case 'codeblock': toggleBlock('pre'); break;
      case 'link': doLink(); break;
      case 'table': exec('insertHTML', TABLE); break;
      case 'hr': exec('insertHTML', '<hr><p><br></p>'); break;
      case 'clear': exec('removeFormat'); exec('formatBlock', '<p>'); break;
      case 'undo': exec('undo'); break;
      case 'redo': exec('redo'); break;
    }
    changed(); emitState();
  }
  function saveSel() { const s = sel(); if (s.rangeCount && inHost(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); }
  function restoreSel() {
    if (!savedRange) return;
    const s = sel(); s.removeAllRanges(); s.addRange(savedRange);
    savedRange = null;
  }
  function insertImage(url, alt) {
    host.focus();                                   // enfocar puede llevar el cursor al inicio: después se recoloca
    if (savedRange) restoreSel();
    else if (!inHost(sel().anchorNode)) { setCaret(host.lastElementChild || host, 0); }
    exec('insertHTML', `<img src="${esc(url)}" alt="${esc(alt || 'imagen')}">`);
    changed();
  }

  /* ---------- atajos Markdown mientras se escribe ---------- */
  function blockShortcut(e) {
    if (e.inputType !== 'insertText' || e.data !== ' ') return false;
    const b = currentBlock();
    if (!b || !/^(P|DIV)$/.test(b.tagName) || b.parentNode !== host && !b.closest('blockquote')) return false;
    const t = b.textContent.replace(/\u00a0/g, ' ');
    let m;
    const clear = () => { b.innerHTML = '<br>'; setCaret(b, 0); };
    if ((m = t.match(/^(#{1,3}) $/))) { clear(); exec('formatBlock', `<h${m[1].length}>`); }
    else if (/^[-*+] $/.test(t)) { clear(); exec('insertUnorderedList'); }
    else if (/^\d+[.)] $/.test(t)) { clear(); exec('insertOrderedList'); }
    else if (/^> $/.test(t)) { clear(); exec('formatBlock', '<blockquote>'); }
    else return false;
    return true;
  }
  function codeFenceShortcut() {
    const b = currentBlock();
    if (!b || !/^(P|DIV)$/.test(b.tagName) || b.textContent.trim() !== '```') return false;
    b.innerHTML = '<br>'; setCaret(b, 0); exec('formatBlock', '<pre>');
    return true;
  }
  const INLINE_RULES = [
    { ch: '*', re: /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, tag: 'strong' },
    { ch: '*', re: /(^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, tag: 'em', group: 2 },
    { ch: '_', re: /(^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, tag: 'em', group: 2 },
    { ch: '`', re: /`([^`]+)`$/, tag: 'code' },
    { ch: '~', re: /~~([^~]+)~~$/, tag: 's' },
  ];
  function inlineShortcut(e) {
    if (e.inputType !== 'insertText' || !e.data) return false;
    const s = sel(); if (!s.isCollapsed || !s.anchorNode || s.anchorNode.nodeType !== 3) return false;
    if (closest('pre') || closest('code')) return false;
    const node = s.anchorNode, off = s.anchorOffset;
    const before = node.nodeValue.slice(0, off);
    for (const r of INLINE_RULES) {
      if (r.ch !== e.data) continue;
      const m = before.match(r.re);
      if (!m) continue;
      const inner = m[r.group || 1];
      const full = m[0].length - (r.group ? m[1].length : 0);       // sin el carácter de contexto
      const start = off - full;
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, off);
      range.deleteContents();
      const el = document.createElement(r.tag); el.textContent = inner;
      range.insertNode(el);
      const after = document.createTextNode('\u200b');
      el.after(after); setCaret(after, 1);
      return true;
    }
    return false;
  }

  host.addEventListener('input', e => {
    // documento vacío o con texto suelto en la raíz (tras borrarlo todo): se recompone con un párrafo
    const hasEl = [...host.childNodes].some(n => n.nodeType === 1);
    const orphan = [...host.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
    if (!hasEl && !orphan) { host.innerHTML = '<p><br></p>'; setCaret(host.firstChild, 0); }
    else if (orphan) exec('formatBlock', '<p>');
    if (!e.isComposing) { if (blockShortcut(e) || codeFenceShortcut() || inlineShortcut(e)) { /* aplicado */ } }
    changed();
  });

  host.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); saveSel(); cmd('link'); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); cmd('strike'); return; }
    if (mod && e.key === '`') { e.preventDefault(); cmd('code'); return; }

    if (e.key === 'Enter' && !e.isComposing) {
      const pre = closest('pre');
      if (pre) {
        e.preventDefault();
        if (e.shiftKey || mod) {                      // salir del bloque de código
          const p = document.createElement('p'); p.innerHTML = '<br>';
          pre.after(p); setCaret(p, 0); changed(); return;
        }
        exec('insertLineBreak'); return;
      }
      const b = currentBlock();
      if (b && /^(P|DIV)$/.test(b.tagName) && /^---+$/.test(b.textContent.trim()) && b.parentNode === host) {
        e.preventDefault();
        const hr = document.createElement('hr'); const p = document.createElement('p'); p.innerHTML = '<br>';
        b.replaceWith(hr); hr.after(p); setCaret(p, 0); changed(); return;
      }
    }
    if (e.key === 'Tab') {
      const cell = closest('td,th');
      if (cell) {                                      // moverse por la tabla; en la última celda se añade una fila
        e.preventDefault();
        const cells = [...cell.closest('table').querySelectorAll('th,td')];
        let i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
        if (i >= cells.length) {
          const row = cell.parentNode.cloneNode(true);
          row.querySelectorAll('td,th').forEach(c => { c.innerHTML = '<br>'; });
          (cell.closest('table').tBodies[0] || cell.closest('table')).appendChild(row);
          i = cells.length;
          setCaret([...cell.closest('table').querySelectorAll('th,td')][i], 0); changed(); return;
        }
        if (i >= 0) setCaret(cells[i], 0);
        return;
      }
      if (closest('li')) { e.preventDefault(); exec(e.shiftKey ? 'outdent' : 'indent'); changed(); return; }
      if (closest('pre')) { e.preventDefault(); exec('insertText', '  '); return; }
    }
  });

  host.addEventListener('paste', e => {
    const cd = e.clipboardData; if (!cd) return;
    const img = [...(cd.files || [])].find(f => /^image\//.test(f.type));
    if (img) { e.preventDefault(); saveSel(); onImageFiles([img]); return; }
    const text = cd.getData('text/plain');
    e.preventDefault();
    if (!text) return;
    if (closest('pre')) { exec('insertText', text); return; }
    if (/^https?:\/\/\S+$/i.test(text.trim())) {
      const u = text.trim();
      exec('insertHTML', `<a href="${esc(u)}">${esc(u)}</a>\u200b`); return;
    }
    const looksMd = /\n/.test(text) || /^(#{1,6} |[-*+] |\d+[.)] |> |```|\||!\[)/m.test(text) || /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\([^)]+\))/.test(text);
    if (looksMd) exec('insertHTML', renderHtml(text)); else exec('insertText', text);
  });
  host.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  host.addEventListener('drop', e => {
    const f = [...(e.dataTransfer ? e.dataTransfer.files : [])].find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); onImageFiles([f]); }
  });
  host.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
  });
  host.addEventListener('keyup', emitState);
  host.addEventListener('mouseup', emitState);
  host.addEventListener('focus', () => { try { exec('defaultParagraphSeparator', 'p'); } catch (e) {} emitState(); });

  setMarkdown(opts.markdown);

  return {
    host, cmd, saveSel, insertImage, setMarkdown, emitState,
    getMarkdown: () => htmlToMarkdown(host),
    focus: () => host.focus(),
  };
}