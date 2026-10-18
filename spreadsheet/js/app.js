// UI controller: grid, selection, editing, ribbon commands, sheet tabs, files.
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const { colName, addr } = XL;
  const STORE_KEY = 'spreadsheet:workbook';
  const MAX_ROWS = 1048576, MAX_COLS = 16384;
  const DEFAULT_W = 72, ROW_HEADER_W = 46, COL_HEADER_H = 22;
  const REF_COLORS = ['#4472c4', '#c00000', '#7030a0', '#00a050', '#ed7d31', '#2f75b5', '#bf8f00'];
  const CHART_COLORS = ['#156082', '#e97132', '#196b24', '#0f9ed5', '#a02b93', '#4ea72e'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  const S = {
    wb: null, si: 0, docName: 'Book1',
    sel: { ar: 0, ac: 0, fr: 0, fc: 0 },
    editing: null, rows: 200, cols: 30,
    clip: null, painter: null, drag: null,
    showFormulas: false, zoom: 100,
    undo: [], redo: [],
    tabStartCol: null, // Enter after a run of Tabs returns to this column, as in Excel
  };

  const app = $('#app'), gridWrap = $('#gridWrap'), gridInner = $('#gridInner'), grid = $('#grid');
  const thead = grid.tHead, tbody = grid.tBodies[0];
  const editor = $('#cellEditor'), bar = $('#formulaBar'), nameBox = $('#nameBox');
  const selBox = $('#selBox'), fillPreview = $('#fillPreview'), marquee = $('#copyMarquee');
  const acBox = $('#autocomplete'), fnTip = $('#fnTip'), ctxMenu = $('#ctxMenu');

  const sheet = () => S.wb.sheets[S.si];
  const view = () => sheet().view;
  const valueAt = (r, c) => S.wb.getValue(S.si, r, c);
  const filled = (r, c) => { const cell = sheet().get(r, c); return !!cell && cell.input !== ''; };
  const selRect = () => {
    const { ar, ac, fr, fc } = S.sel;
    return expandToMerges({ r1: Math.min(ar, fr), c1: Math.min(ac, fc), r2: Math.max(ar, fr), c2: Math.max(ac, fc) });
  };
  const isTextField = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

  // ------------------------------------------------------------ persistence
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY));
      if (data && data.workbook) { S.wb = XL.Workbook.fromJSON(data.workbook); S.docName = data.name || 'Book1'; }
    } catch (e) { S.wb = null; }
    if (!S.wb) { S.wb = new XL.Workbook(); S.wb.addSheet('Sheet1'); }
  }
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (stylePreview) return scheduleSave(); // never save a hover preview
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ name: S.docName, workbook: S.wb.toJSON() })); } catch (e) { /* storage unavailable */ }
  }

  // ------------------------------------------------------------ undo
  const snapshot = () => { endPreview(); return { wb: JSON.stringify(S.wb.toJSON()), si: S.si, sel: { ...S.sel } }; };
  function pushUndo(snap = snapshot()) {
    S.undo.push(snap);
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
  }
  function restore(snap) {
    S.wb = XL.Workbook.fromJSON(JSON.parse(snap.wb));
    S.si = Math.min(snap.si, S.wb.sheets.length - 1);
    S.sel = snap.sel;
    rebuild();
  }
  function undo() {
    if (S.editing) return cancelEdit();
    const snap = S.undo.pop();
    if (!snap) return;
    S.redo.push(snapshot());
    restore(snap);
  }
  function redo() {
    const snap = S.redo.pop();
    if (!snap) return;
    S.undo.push(snapshot());
    restore(snap);
  }

  // ------------------------------------------------------------ grid construction
  const colWidth = (c) => sheet().colWidths[c] || DEFAULT_W;
  const tdAt = (r, c) => (tbody.rows[r] ? tbody.rows[r].cells[c + 1] : null);

  function rowHtml(from, to) {
    let html = '';
    const tds = '<td></td>'.repeat(S.cols);
    for (let r = from; r < to; r++) html += `<tr><th>${r + 1}</th>${tds}</tr>`;
    return html;
  }
  function buildGrid() {
    const ext = sheet().extent();
    S.rows = Math.min(MAX_ROWS, Math.max(S.rows, ext.rows + 50, S.sel.ar + 50));
    S.cols = Math.min(MAX_COLS, Math.max(S.cols, ext.cols + 5, S.sel.ac + 5));
    const old = grid.querySelector('colgroup');
    if (old) old.remove();
    const cg = document.createElement('colgroup');
    let cols = `<col style="width:${ROW_HEADER_W}px">`;
    for (let c = 0; c < S.cols; c++) cols += `<col style="width:${colWidth(c)}px">`;
    cg.innerHTML = cols;
    grid.prepend(cg);
    let head = '<tr><th class="corner" title="Select All"></th>';
    for (let c = 0; c < S.cols; c++) head += `<th>${colName(c)}<span class="col-resizer" data-c="${c}"></span></th>`;
    thead.innerHTML = head + '</tr>';
    tbody.innerHTML = rowHtml(0, S.rows);
    updateTableWidth();
    renderAll();
  }
  function updateTableWidth() {
    let w = ROW_HEADER_W;
    for (let c = 0; c < S.cols; c++) w += colWidth(c);
    grid.style.width = w + 'px';
  }
  function appendRows(n) {
    const from = S.rows;
    const to = Math.min(MAX_ROWS, S.rows + n);
    if (to <= from) return;
    tbody.insertAdjacentHTML('beforeend', rowHtml(from, to));
    S.rows = to;
    for (let r = from; r < to; r++) for (let c = 0; c < S.cols; c++) renderCell(r, c);
  }
  function ensureSize(r, c) {
    if (c >= S.cols) { S.cols = Math.min(MAX_COLS, c + 10); buildGrid(); }
    if (r >= S.rows) appendRows(r - S.rows + 100);
  }

  // ------------------------------------------------------------ rendering
  const measureCtx = document.createElement('canvas').getContext('2d');
  let cellFont = null;
  function textWidth(text, st) {
    cellFont = cellFont || getComputedStyle(grid).fontFamily;
    measureCtx.font = `${st.italic ? 'italic ' : ''}${st.bold ? '700 ' : ''}${st.size || 11}pt ${st.font ? `"${st.font}"` : cellFont}`;
    return measureCtx.measureText(text).width;
  }
  // Widen columns so formatted numbers fit (Excel does this when a number format is applied or a number typed).
  function fitNumbers(c1, c2, r1, r2) {
    let widened = false;
    const ext = sheet().extent();
    for (let c = c1; c <= Math.min(c2, S.cols - 1); c++) {
      let need = 0;
      for (let r = r1; r <= Math.min(r2, ext.rows - 1); r++) {
        const v = valueAt(r, c);
        if (typeof v !== 'number') continue;
        const st = S.wb.getStyle(S.si, r, c);
        need = Math.max(need, textWidth(XL.formatValue(v, st), st) + 12);
      }
      if (need > colWidth(c)) { sheet().colWidths[c] = Math.ceil(need); widened = true; }
    }
    if (widened) buildGrid();
  }

  // Borders: style.bd = { t, b, l, r } of [weight, colour]; the older style.border means thin black on every side.
  // A cell draws its own bottom and right edges (its gridlines) plus a neighbour's facing edge, and its top and left
  // edges only in row 1 / column A. Extra weight is drawn inward with inset shadows so the grid never shifts.
  const EDGE_RANK = { thin: 1, medium: 2, double: 3, thick: 4 };
  function edgeOf(st, side) { return (st.bd && st.bd[side]) || (st.border ? ['thin', '#000'] : null); }
  function edgeAt(r, c, side) { const cell = sheet().get(r, c); return cell && cell.style ? edgeOf(cell.style, side) : null; }
  const pickEdge = (own, other) => (!own ? other : other && EDGE_RANK[other[0]] > EDGE_RANK[own[0]] ? other : own);
  function edgeShadows([weight, col], dx, dy, bg, hasLine) {
    const at = (n, c) => `inset ${dx * n}px ${dy * n}px 0 ${c}`;
    if (weight === 'double') return hasLine ? [at(1, bg), at(2, col)] : [at(1, col), at(2, bg), at(3, col)];
    const n = { thin: 1, medium: 2, thick: 3 }[weight] - (hasLine ? 1 : 0);
    return n > 0 ? [at(n, col)] : [];
  }

  // Orientation: style.rot is 45 / -45 (degrees counterclockwise), 90 / -90 (rotate up / down) or 'v' (stacked).
  // Each is laid out so the row grows to fit, as Excel's rows do.
  function rotHtml(text, st) {
    const t = esc(text);
    if (st.rot === 'v') return `<span class="rot rot-v">${t}</span>`;
    if (st.rot === 90 || st.rot === -90) return `<span class="rot ${st.rot > 0 ? 'rot-up' : 'rot-down'}">${t}</span>`;
    const lh = (st.size || 11) * 4 / 3 * 1.25, k = Math.SQRT1_2;
    const h = Math.ceil((textWidth(text, st) + lh) * k) + 2, x = Math.ceil(lh * k);
    return `<span class="rot rot-a" style="height:${h}px"><span class="${st.rot > 0 ? 'ccw' : 'cw'}" style="left:${x}px">${t}</span></span>`;
  }

  // Displayed text and its kind; numbers too wide for `avail` px show as ###, as in Excel.
  function displayText(r, c, st, avail) {
    const cell = sheet().get(r, c);
    if (!cell || cell.input === '') return { text: '', kind: '' };
    if (S.showFormulas && cell.formula) return { text: cell.input, kind: 'str' };
    const v = valueAt(r, c);
    let text = XL.formatValue(v, st);
    let kind = typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : XL.isErr(v) ? 'err' : 'str';
    if (st.fmt === 'text' && !cell.formula) kind = 'str';
    if (kind === 'num' && !st.wrap && !st.rot && textWidth(text, st) > avail) text = '#'.repeat(Math.max(1, Math.floor(avail / textWidth('#', st))));
    return { text, kind };
  }
  function fontCss(st) {
    const css = [];
    if (st.bold) css.push('font-weight:700');
    if (st.italic) css.push('font-style:italic');
    const deco = [st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) css.push('text-decoration:' + deco);
    if (st.color) css.push('color:' + st.color);
    if (st.size) css.push(`font-size:${st.size}pt`);
    if (st.font) css.push(`font-family:"${st.font}",var(--cell-font)`);
    return css;
  }
  function edgeCss(bottom, right, top, left, bg) {
    const css = [], shadows = [];
    if (bottom) { css.push('border-bottom-color:' + bottom[1]); shadows.push(...edgeShadows(bottom, 0, -1, bg, true)); }
    if (right) { css.push('border-right-color:' + right[1]); shadows.push(...edgeShadows(right, -1, 0, bg, true)); }
    if (top) shadows.push(...edgeShadows(top, 0, 1, bg, false));
    if (left) shadows.push(...edgeShadows(left, 1, 0, bg, false));
    if (shadows.length) css.push('box-shadow:' + shadows.join(','));
    return css;
  }
  // Center Across Selection: the text centres over this cell and the empty, same-aligned cells to its right.
  function centerAcrossWidth(r, c) {
    let k = c + 1, w = colWidth(c);
    while (k < S.cols && !filled(r, k) && !mergeAt(r, k) && S.wb.getStyle(S.si, r, k).align === 'centerAcross') w += colWidth(k++);
    return k > c + 1 ? w : 0;
  }

  function renderCell(r, c, td = tdAt(r, c)) {
    if (!td) return;
    const m = mergeAt(r, c);
    if (m) { // drawn by the merged cell laid over the grid
      // A one-row merge's top-left cell keeps an invisible line of its font so the row stays tall enough.
      const strut = m.r1 === m.r2 && r === m.r1 && c === m.c1 && filled(r, c);
      const text = strut ? '\u00a0' : '';
      if (td._rot || td.textContent !== text) { td._rot = null; td.textContent = text; }
      td.className = view().freezeCol && c === 0 ? 'frozen-col' : '';
      const cssText = strut ? [...fontCss(S.wb.getStyle(S.si, r, c)), 'color:transparent'].join(';') : '';
      if (cssText) td.setAttribute('style', cssText); else td.removeAttribute('style');
      return;
    }
    const cell = sheet().get(r, c);
    const st = (cell && cell.style) || {};
    const across = st.align === 'centerAcross' && cell && cell.input !== '' && !st.rot ? centerAcrossWidth(r, c) : 0;
    const { text, kind } = displayText(r, c, st, (across || colWidth(c)) - 7);
    let cls = kind;
    if (st.wrap) cls += ' wrap';
    else if (kind === 'str' && text && (!st.align || st.align === 'left') && !filled(r, c + 1)) cls += ' ov';
    if (st.rot && text && (st.rot === 45 || st.rot === -45) && !cls.includes(' ov') && !filled(r, c + 1)) cls += ' ov';
    if (across && !cls.includes(' ov')) cls += ' ov';
    if (view().freezeCol && c === 0) cls += ' frozen-col';
    const css = fontCss(st);
    if (st.fill) css.push('background:' + st.fill);
    if (st.align) css.push('text-align:' + (st.align === 'centerAcross' ? (across ? 'left' : 'center') : st.align));
    if (st.valign) css.push('vertical-align:' + st.valign);
    if (st.indent) css.push(`padding-left:${3 + st.indent * 9}px`);
    const bottom = pickEdge(edgeOf(st, 'b'), edgeAt(r + 1, c, 't'));
    const right = pickEdge(edgeOf(st, 'r'), edgeAt(r, c + 1, 'l'));
    css.push(...edgeCss(bottom, right, r === 0 && edgeOf(st, 't'), c === 0 && edgeOf(st, 'l'), st.fill || '#fff'));
    if (cls.includes(' ov')) css.push('overflow:visible;position:relative;z-index:1');
    const html = st.rot && text ? rotHtml(text, st) : across && text ? `<span class="ca" style="width:${across - 7}px">${esc(text)}</span>` : null;
    if (html) { if (td._rot !== html) { td.innerHTML = html; td._rot = html; } }
    else if (td._rot || td.textContent !== text) { td._rot = null; td.textContent = text; }
    td.className = cls;
    const cssText = css.join(';');
    if (td.getAttribute('style') !== cssText) { if (cssText) td.setAttribute('style', cssText); else td.removeAttribute('style'); }
  }

  // ------------------------------------------------------------ merged cells
  // A merged range is drawn as one cell laid over the grid; the covered cells render blank underneath.
  const overlaps = (m, x) => !(m.r2 < x.r1 || m.r1 > x.r2 || m.c2 < x.c1 || m.c1 > x.c2);
  const mergeAt = (r, c) => sheet().merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) || null;
  // A selection covers every merged range it touches, as in Excel; whole rows and columns stay as they are.
  function expandToMerges(rect) {
    const ms = sheet().merges;
    const whole = (rect.r1 === 0 && rect.r2 >= S.rows - 1) || (rect.c1 === 0 && rect.c2 >= S.cols - 1);
    for (let grown = ms.length > 0 && !whole; grown;) {
      grown = false;
      for (const m of ms) {
        if (!overlaps(m, rect) || (m.r1 >= rect.r1 && m.r2 <= rect.r2 && m.c1 >= rect.c1 && m.c2 <= rect.c2)) continue;
        rect = { r1: Math.min(rect.r1, m.r1), c1: Math.min(rect.c1, m.c1), r2: Math.max(rect.r2, m.r2), c2: Math.max(rect.c2, m.c2) };
        grown = true;
      }
    }
    return rect;
  }
  function renderMerges() {
    gridInner.querySelectorAll('.merge-cell').forEach((el) => el.remove());
    sheet().merges.forEach((m, i) => {
      if (m.r1 >= S.rows || m.c1 >= S.cols) return;
      const box = boxFor(m.r1, m.c1, m.r2, m.c2);
      if (!box) return;
      const st = S.wb.getStyle(S.si, m.r1, m.c1);
      const { text, kind } = displayText(m.r1, m.c1, st, box.width - 7);
      const h = st.align === 'centerAcross' ? 'center' : st.align || (kind === 'num' ? 'right' : kind === 'bool' || kind === 'err' ? 'center' : 'left');
      const css = fontCss(st);
      css.push('background:' + (st.fill || '#fff'));
      css.push('align-items:' + (st.valign === 'top' ? 'flex-start' : st.valign === 'middle' ? 'center' : 'flex-end'));
      if (st.indent) css.push(`padding-left:${3 + st.indent * 9}px`);
      const bottom = pickEdge(edgeOf(st, 'b'), edgeAt(m.r2 + 1, m.c1, 't'));
      const right = pickEdge(edgeOf(st, 'r'), edgeAt(m.r1, m.c2 + 1, 'l'));
      css.push(...edgeCss(bottom, right, m.r1 === 0 && edgeOf(st, 't'), m.c1 === 0 && edgeOf(st, 'l'), st.fill || '#fff'));
      const el = document.createElement('div');
      el.className = 'merge-cell' + (st.wrap ? ' wrap' : '');
      el.dataset.i = i;
      el.setAttribute('style', css.join(';'));
      el.innerHTML = `<div class="mc-in" style="text-align:${h}">${st.rot && text ? rotHtml(text, st) : esc(text)}</div>`;
      gridInner.appendChild(el);
    });
    placeMerges();
  }
  // Keeps merged cells over their ranges after resizing, and pinned with a frozen first row or column.
  function placeMerges() {
    const z = S.zoom / 100;
    gridInner.querySelectorAll('.merge-cell').forEach((el) => {
      const m = sheet().merges[+el.dataset.i];
      const box = m && boxFor(m.r1, m.c1, m.r2, m.c2);
      if (!box) { el.style.display = 'none'; return; }
      Object.assign(el.style, { display: '', left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' });
      const frozenR = view().freezeRow && m.r1 === 0, frozenC = view().freezeCol && m.c1 === 0;
      const dy = frozenR ? Math.max(0, gridWrap.scrollTop / z + COL_HEADER_H - box.top) : 0;
      const dx = frozenC ? Math.max(0, gridWrap.scrollLeft / z + ROW_HEADER_W - box.left) : 0;
      el.style.transform = dx || dy ? `translate(${dx}px,${dy}px)` : '';
      el.classList.toggle('frozen', frozenR || frozenC);
    });
  }

  // Merge & Center, Merge Across, Merge Cells: Excel keeps the first value (reading order), gives every cell
  // the top-left cell's format, and warns before discarding other values.
  const MERGE_LOSS = 'Merging cells only keeps the upper-left value and discards other values.';
  function mergeSel(kind) {
    if (S.editing && !commitEdit()) return;
    if (guard()) return;
    const rect = selRect();
    if (kind === 'center' && sheet().merges.some((m) => m.r1 === rect.r1 && m.c1 === rect.c1 && m.r2 === rect.r2 && m.c2 === rect.c2)) return unmergeSel();
    const groups = (kind === 'across'
      ? Array.from({ length: rect.r2 - rect.r1 + 1 }, (_, i) => ({ r1: rect.r1 + i, c1: rect.c1, r2: rect.r1 + i, c2: rect.c2 }))
      : [rect]).filter((g) => g.r2 > g.r1 || g.c2 > g.c1);
    if (!groups.length) return;
    const filledIn = (g) => { const out = []; for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (filled(r, c)) out.push([r, c]); return out; };
    const run = () => {
      pushUndo();
      sheet().merges = sheet().merges.filter((m) => !groups.some((g) => overlaps(m, g)));
      for (const g of groups) {
        const first = filledIn(g)[0];
        const input = first ? S.wb.getInput(S.si, ...first) : '';
        const st = { ...S.wb.getStyle(S.si, g.r1, g.c1) };
        if (kind === 'center') st.align = 'center';
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
          S.wb.setInput(S.si, r, c, r === g.r1 && c === g.c1 ? input : '');
          S.wb.setStyle(S.si, r, c, Object.keys(st).length ? st : null, true);
        }
        sheet().merges.push({ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 });
      }
      S.wb.recalc();
      setSel(rect.r1, rect.c1, rect.r2, rect.c2);
      changed();
    };
    if (groups.some((g) => filledIn(g).length > 1)) confirmBox(MERGE_LOSS, run); else run();
  }
  function unmergeSel() {
    if (S.editing && !commitEdit()) return;
    if (guard()) return;
    const rect = selRect();
    if (!sheet().merges.some((m) => overlaps(m, rect))) return;
    pushUndo();
    sheet().merges = sheet().merges.filter((m) => !overlaps(m, rect));
    changed();
  }

  function renderAll() {
    for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) renderCell(r, c);
    renderMerges();
    const firstRow = tbody.rows[0];
    for (const tr of tbody.rows) tr.classList.remove('frozen');
    if (view().freezeRow && firstRow) firstRow.classList.add('frozen');
    const circ = S.wb.circular;
    $('#circText').textContent = circ ? `Circular References: ${circ.si !== S.si ? S.wb.sheets[circ.si].name + '!' : ''}${addr(circ.r, circ.c)}` : '';
    renderCharts();
  }

  function changed() {
    renderAll();
    updateSelection();
    scheduleSave();
  }

  function rebuild() {
    S.rows = 200; S.cols = 30;
    buildGrid();
    renderTabs();
    applyViewOptions();
    updateSelection();
    $('#docName').textContent = S.docName;
    document.title = `${S.docName} — Spreadsheet`;
    scheduleSave();
  }

  // ------------------------------------------------------------ selection
  function boxFor(r1, c1, r2, c2) {
    const a = tdAt(r1, c1), b = tdAt(Math.min(r2, S.rows - 1), Math.min(c2, S.cols - 1));
    if (!a || !b) return null;
    return { left: a.offsetLeft, top: a.offsetTop, width: b.offsetLeft + b.offsetWidth - a.offsetLeft, height: b.offsetTop + b.offsetHeight - a.offsetTop };
  }
  function place(el, box) {
    if (!box) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = box.left - 1 + 'px';
    el.style.top = box.top - 1 + 'px';
    el.style.width = box.width + 1 + 'px';
    el.style.height = box.height + 1 + 'px';
  }

  function updateSelection() {
    const { ar, ac, fr, fc } = S.sel;
    const whole = (Math.min(ar, fr) === 0 && Math.max(ar, fr) >= S.rows - 1) || (Math.min(ac, fc) === 0 && Math.max(ac, fc) >= S.cols - 1);
    const am = !whole && mergeAt(ar, ac);
    if (am && (am.r1 !== ar || am.c1 !== ac)) {
      if (S.sel.fr === S.sel.ar && S.sel.fc === S.sel.ac) { S.sel.fr = am.r1; S.sel.fc = am.c1; }
      S.sel.ar = am.r1; S.sel.ac = am.c1;
    }
    placeMerges();
    const { r1, c1, r2, c2 } = selRect();
    place(selBox, boxFor(r1, c1, r2, c2));
    for (const th of grid.querySelectorAll('th.hl, th.full')) th.classList.remove('hl', 'full');
    const headRow = thead.rows[0];
    const fullCols = r1 === 0 && r2 >= S.rows - 1;
    const fullRows = c1 === 0 && c2 >= S.cols - 1;
    for (let c = c1; c <= Math.min(c2, S.cols - 1); c++) headRow.cells[c + 1].classList.add('hl', ...(fullCols ? ['full'] : []));
    for (let r = r1; r <= Math.min(r2, S.rows - 1); r++) tbody.rows[r].cells[0].classList.add('hl', ...(fullRows ? ['full'] : []));
    if (!S.editing) {
      bar.value = S.wb.getInput(S.si, S.sel.ar, S.sel.ac);
      if (document.activeElement !== nameBox) {
        nameBox.value = S.drag && S.drag.type === 'select' && (r1 !== r2 || c1 !== c2) ? `${r2 - r1 + 1}R x ${c2 - c1 + 1}C` : addr(S.sel.ar, S.sel.ac);
      }
    }
    view().sel = { ...S.sel };
    if (S.clip && S.clip.si === S.si) place(marquee, boxFor(S.clip.r1, S.clip.c1, S.clip.r2, S.clip.c2)); else marquee.style.display = 'none';
    updateStatus();
    updateRibbonState();
  }

  function setSel(ar, ac, fr = ar, fc = ac) {
    S.sel = { ar, ac, fr, fc };
    updateSelection();
  }

  function ensureVisible(r, c) {
    const td = tdAt(r, c);
    if (!td) return;
    const z = S.zoom / 100;
    const hw = (view().headings === false ? 0 : ROW_HEADER_W) * z;
    const hh = (view().headings === false ? 0 : COL_HEADER_H) * z;
    const left = td.offsetLeft * z, top = td.offsetTop * z, w = td.offsetWidth * z, h = td.offsetHeight * z;
    // Skip an axis while the viewport is too small to show a cell (e.g. during initial layout).
    if (gridWrap.clientWidth > hw + w) {
      if (left - hw < gridWrap.scrollLeft) gridWrap.scrollLeft = left - hw;
      else if (left + w > gridWrap.scrollLeft + gridWrap.clientWidth) gridWrap.scrollLeft = left + w - gridWrap.clientWidth;
    }
    if (gridWrap.clientHeight > hh + h) {
      if (top - hh < gridWrap.scrollTop) gridWrap.scrollTop = top - hh;
      else if (top + h > gridWrap.scrollTop + gridWrap.clientHeight) gridWrap.scrollTop = top + h - gridWrap.clientHeight;
    }
  }

  // Ctrl/⌘+arrow: jump to the edge of the current data block.
  function jumpEdge(r, c, dr, dc) {
    const limR = dr > 0 ? Math.max(S.rows - 1, sheet().extent().rows) : 0;
    const limC = dc > 0 ? Math.max(S.cols - 1, sheet().extent().cols) : 0;
    const inside = (rr, cc) => rr >= 0 && cc >= 0 && (dr <= 0 || rr <= limR) && (dc <= 0 || cc <= limC);
    let nr = r + dr, nc = c + dc;
    if (!inside(nr, nc)) return [r, c];
    if (filled(r, c) && filled(nr, nc)) {
      while (inside(nr + dr, nc + dc) && filled(nr + dr, nc + dc)) { nr += dr; nc += dc; }
      return [nr, nc];
    }
    while (inside(nr, nc) && !filled(nr, nc)) {
      if (!inside(nr + dr, nc + dc)) return [nr, nc];
      nr += dr; nc += dc;
    }
    return [nr, nc];
  }

  function navKey(key, shift) {
    if (key === 'Tab') {
      if (S.tabStartCol === null) S.tabStartCol = S.sel.ac;
      const keep = S.tabStartCol;
      move(0, shift ? -1 : 1);
      S.tabStartCol = keep;
    } else if (S.tabStartCol !== null && !shift) {
      const c = S.tabStartCol;
      move(1, c - S.sel.ac);
    } else move(shift ? -1 : 1, 0);
  }

  function move(dr, dc, extend = false, jump = false) {
    S.tabStartCol = null;
    let r = extend ? S.sel.fr : S.sel.ar;
    let c = extend ? S.sel.fc : S.sel.ac;
    if (jump) [r, c] = jumpEdge(r, c, dr, dc);
    else {
      // Merged cells are one cell: step from the selection's far edge rather than from inside a merge.
      const box = selRect(), m = mergeAt(r, c);
      if (extend) {
        if (dr) r = (S.sel.fr > S.sel.ar || (S.sel.fr === S.sel.ar && dr > 0) ? box.r2 : box.r1);
        if (dc) c = (S.sel.fc > S.sel.ac || (S.sel.fc === S.sel.ac && dc > 0) ? box.c2 : box.c1);
      } else if (m) { if (dr > 0) r = m.r2; if (dc > 0) c = m.c2; }
      r = clamp(r + dr, 0, MAX_ROWS - 1); c = clamp(c + dc, 0, MAX_COLS - 1);
    }
    ensureSize(r, c);
    if (extend) { S.sel.fr = r; S.sel.fc = c; updateSelection(); }
    else { const t = mergeAt(r, c); if (t) { r = t.r1; c = t.c1; } setSel(r, c); }
    ensureVisible(r, c);
  }

  // ------------------------------------------------------------ status bar
  function updateStatus() {
    const { r1, c1, r2, c2 } = selRect();
    const out = $('#aggText');
    if ((r1 === r2 && c1 === c2) || sheet().merges.some((m) => m.r1 === r1 && m.c1 === c1 && m.r2 === r2 && m.c2 === c2)) { out.textContent = ''; return; }
    const ext = sheet().extent();
    let sum = 0, nums = 0, count = 0;
    for (let r = r1; r <= Math.min(r2, ext.rows - 1); r++) {
      for (let c = c1; c <= Math.min(c2, ext.cols - 1); c++) {
        if (!filled(r, c)) continue;
        count++;
        const v = valueAt(r, c);
        if (typeof v === 'number') { sum += v; nums++; }
      }
    }
    const st = S.wb.getStyle(S.si, S.sel.ar, S.sel.ac);
    const f = (x) => XL.formatValue(x, st.fmt && !['text', 'general'].includes(st.fmt) ? st : {});
    out.textContent = nums ? `Average: ${f(sum / nums)}    Count: ${count}    Sum: ${f(sum)}` : count > 1 ? `Count: ${count}` : '';
  }
  function setMode() {
    const e = S.editing;
    $('#modeText').textContent = !e ? 'Ready' : e.point ? 'Point' : e.mode === 'edit' ? 'Edit' : 'Enter';
  }

  // ------------------------------------------------------------ editing
  const activeInput = () => (S.editing && S.editing.src === 'bar' ? bar : editor);

  function guard() {
    if (view().protected) {
      msg('This cell is on a protected sheet. To change it, turn off Protect Sheet on the Review tab.');
      return true;
    }
    return false;
  }

  function startEdit(mode, initial, src = 'cell') {
    if (S.editing) return true;
    if (guard()) return false;
    const { ar: r, ac: c } = S.sel;
    setSel(r, c, S.sel.fr, S.sel.fc);
    ensureVisible(r, c);
    const input = initial !== undefined ? initial : S.wb.getInput(S.si, r, c);
    S.editing = { r, c, si: S.si, mode, src, point: null };
    editor.value = input;
    bar.value = input;
    positionEditor();
    const el = activeInput();
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    $('#fxCancel').disabled = $('#fxEnter').disabled = false;
    onEditInput();
    return true;
  }

  function positionEditor() {
    const { r, c } = S.editing;
    const td = tdAt(r, c);
    const st = S.wb.getStyle(S.si, r, c);
    const em = mergeAt(r, c), area = em ? boxFor(em.r1, em.c1, em.r2, em.c2) : { width: td.offsetWidth, height: td.offsetHeight };
    editor.style.display = 'block';
    editor.style.left = td.offsetLeft - 1 + 'px';
    editor.style.top = td.offsetTop - 1 + 'px';
    editor.style.fontWeight = st.bold ? '700' : '';
    editor.style.fontStyle = st.italic ? 'italic' : '';
    editor.style.fontSize = st.size ? st.size + 'pt' : '';
    editor.style.fontFamily = st.font ? `"${st.font}"` : '';
    editor.style.width = '0px';
    editor.style.height = '0px';
    editor.style.width = Math.max(area.width + 2, Math.min(editor.scrollWidth + 12, 640)) + 'px';
    editor.style.height = Math.max(area.height + 2, editor.scrollHeight + 4) + 'px';
  }

  function onEditInput(fromPoint = false) {
    if (!S.editing) return;
    if (!fromPoint) S.editing.point = null;
    const el = activeInput();
    if (el === editor) bar.value = editor.value; else editor.value = bar.value;
    positionEditor();
    drawRefBoxes();
    updateAutocomplete();
    setMode();
  }

  function upperRef(src) {
    const i = src.lastIndexOf('!');
    return i < 0 ? src.toUpperCase() : src.slice(0, i + 1) + src.slice(i + 1).toUpperCase();
  }
  // Excel tidies formulas on entry: closes open parentheses and upper-cases names and references.
  function normalizeFormula(text) {
    let body = text.slice(1);
    let depth = 0, inStr = false;
    for (const ch of body) {
      if (ch === '"') inStr = !inStr;
      else if (!inStr) depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
    }
    if (depth > 0 && !inStr) body += ')'.repeat(depth);
    try {
      const toks = XL.tokenize(body).reverse();
      for (const t of toks) {
        if (t.t !== 'fn' && t.t !== 'ref' && t.t !== 'bool') continue;
        const src = body.slice(t.s, t.e);
        body = body.slice(0, t.s) + (t.t === 'ref' ? upperRef(src) : src.toUpperCase()) + body.slice(t.e);
      }
    } catch (e) { /* leave as typed; parse will report */ }
    return '=' + body;
  }

  function commitEdit() {
    if (!S.editing) return true;
    const ed = S.editing;
    let text = activeInput().value;
    if (text.startsWith('=') && text.length > 1) text = normalizeFormula(text);
    const before = snapshot();
    const res = S.wb.setInput(ed.si, ed.r, ed.c, text);
    if (!res.ok) {
      msg(`There's a problem with this formula.\n\n${res.message}. Check for missing parentheses, commas or quotes.`, () => activeInput().focus());
      return false;
    }
    pushUndo(before);
    endEdit();
    if (typeof S.wb.getValue(ed.si, ed.r, ed.c) === 'number' && !text.startsWith('=')) fitNumbers(ed.c, ed.c, ed.r, ed.r);
    changed();
    return true;
  }
  function cancelEdit() { endEdit(); updateSelection(); }
  function endEdit() {
    S.editing = null;
    editor.style.display = 'none';
    hideAC();
    fnTip.style.display = 'none';
    $('#refBoxes').innerHTML = '';
    $('#fxCancel').disabled = $('#fxEnter').disabled = true;
    setMode();
    focusGrid();
  }
  const focusGrid = () => gridWrap.focus({ preventScroll: true });

  // --- point mode: clicking or arrowing while typing a formula inserts references
  function pointable() {
    const el = activeInput();
    const v = el.value;
    if (!v.startsWith('=') || el.selectionStart !== el.selectionEnd) return false;
    const pos = el.selectionStart;
    const p = S.editing.point;
    if (p && pos === p.end) return true;
    return /[=(,+\-*/^&<>:]$/.test(v.slice(0, pos).trimEnd());
  }
  function pointTo(r, c, r2 = r, c2 = c) {
    const el = activeInput();
    const p = S.editing.point;
    const ref = r === r2 && c === c2 ? addr(r, c) : addr(Math.min(r, r2), Math.min(c, c2)) + ':' + addr(Math.max(r, r2), Math.max(c, c2));
    const replacing = p && el.selectionStart === p.end;
    const start = replacing ? p.start : el.selectionStart;
    const end = replacing ? p.end : el.selectionStart;
    el.value = el.value.slice(0, start) + ref + el.value.slice(end);
    el.setSelectionRange(start + ref.length, start + ref.length);
    S.editing.point = { start, end: start + ref.length, r, c, r2, c2 };
    onEditInput(true);
    ensureVisible(r2, c2);
  }

  function drawRefBoxes() {
    const host = $('#refBoxes');
    host.innerHTML = '';
    const v = activeInput().value;
    if (!S.editing || S.editing.si !== S.si || !v.startsWith('=')) return;
    let toks;
    try { toks = XL.tokenize(v.slice(1)); } catch (e) { return; }
    let i = 0;
    for (const t of toks) {
      if (t.t !== 'ref') continue;
      if (t.sheet && t.sheet.toLowerCase() !== sheet().name.toLowerCase()) continue;
      const a = t.a, b = t.b || t.a;
      const box = boxFor(a.r ?? 0, a.c ?? 0, b.r ?? S.rows - 1, b.c ?? S.cols - 1);
      if (!box) continue;
      const d = document.createElement('div');
      d.className = 'ref-box';
      d.style.borderColor = REF_COLORS[i++ % REF_COLORS.length];
      d.style.background = d.style.borderColor + '14';
      host.appendChild(d);
      place(d, box);
    }
  }

  // --- function autocomplete + argument tooltip
  const AC = { items: [], idx: 0, start: 0, end: 0 };
  function hideAC() { acBox.style.display = 'none'; AC.items = []; }
  function inString(text) { return (text.match(/"/g) || []).length % 2 === 1; }
  function anchorBelow(el, box) {
    const rect = el.getBoundingClientRect();
    box.style.left = Math.min(rect.left, window.innerWidth - 380) + 'px';
    box.style.top = rect.bottom + 2 + 'px';
  }
  function updateAutocomplete() {
    const el = activeInput();
    const v = el.value, pos = el.selectionStart;
    hideAC();
    fnTip.style.display = 'none';
    if (!v.startsWith('=') || inString(v.slice(0, pos))) return;
    const m = /(^|[^A-Za-z0-9_.$!"'])([A-Za-z][A-Za-z0-9.]*)$/.exec(v.slice(1, pos));
    if (m && v[pos] !== '(') {
      const frag = m[2].toUpperCase();
      AC.items = Object.keys(XL.FUNCTIONS).filter((n) => n.startsWith(frag)).sort().slice(0, 12);
      if (AC.items.length && !(AC.items.length === 1 && AC.items[0] === frag)) {
        AC.idx = 0; AC.start = pos - m[2].length; AC.end = pos;
        acBox.innerHTML = AC.items.map((n, i) => `<div data-i="${i}" class="${i ? '' : 'active'}"><b>${n}</b><span>${esc(XL.FUNCTIONS[n].desc)}</span></div>`).join('');
        anchorBelow(el, acBox);
        acBox.style.display = 'block';
        return;
      }
      AC.items = [];
    }
    showFnTip(el, v.slice(0, pos));
  }
  function acceptAC(i = AC.idx) {
    const name = AC.items[i];
    if (!name) return;
    const el = activeInput();
    el.value = el.value.slice(0, AC.start) + name + '(' + el.value.slice(AC.end);
    const caret = AC.start + name.length + 1;
    el.setSelectionRange(caret, caret);
    el.focus();
    onEditInput();
  }
  function showFnTip(el, before) {
    const stack = [];
    let inStr = false, word = '';
    for (const ch of before.slice(1)) {
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (/[A-Za-z0-9_.]/.test(ch)) { word += ch; continue; }
      if (ch === '(') stack.push({ name: word.toUpperCase(), arg: 0 });
      else if (ch === ')') stack.pop();
      else if (ch === ',' && stack.length) stack[stack.length - 1].arg++;
      word = '';
    }
    const top = stack[stack.length - 1];
    const f = top && XL.FUNCTIONS[top.name];
    if (!f) return;
    const m = /^([^(]+)\((.*)\)$/.exec(f.syntax);
    const args = m[2] ? m[2].split(', ') : [];
    const idx = Math.min(top.arg, args.length - 1);
    const shown = args.map((a, i) => (i === idx || (a === '...' && top.arg >= i) ? `<b>${esc(a)}</b>` : esc(a)));
    fnTip.innerHTML = `${m[1]}(${shown.join(', ')})`;
    anchorBelow(el, fnTip);
    fnTip.style.display = 'block';
  }

  function onEditKey(e) {
    if (!S.editing) return;
    const el = activeInput();
    if (AC.items.length && acBox.style.display === 'block') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        AC.idx = (AC.idx + (e.key === 'ArrowDown' ? 1 : -1) + AC.items.length) % AC.items.length;
        [...acBox.children].forEach((d, i) => d.classList.toggle('active', i === AC.idx));
        acBox.children[AC.idx].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); acceptAC(); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideAC(); return; }
    }
    if (e.key === 'Enter' && (e.altKey || e.ctrlKey)) {
      e.preventDefault();
      const p = el.selectionStart;
      el.value = el.value.slice(0, p) + '\n' + el.value.slice(el.selectionEnd);
      el.setSelectionRange(p + 1, p + 1);
      onEditInput();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (commitEdit()) navKey(e.key, e.shiftKey);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
    if (e.key === 'F2') { e.preventDefault(); S.editing.mode = S.editing.mode === 'edit' ? 'enter' : 'edit'; setMode(); return; }
    if (e.key === 'F4') { e.preventDefault(); cycleAbsolute(el); return; }
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key] && S.editing.mode === 'enter' && el === editor) {
      const [dr, dc] = arrows[e.key];
      e.preventDefault();
      if (pointable()) {
        const p = S.editing.point;
        const base = p ? [p.r2, p.c2] : [S.editing.r, S.editing.c];
        pointTo(clamp(base[0] + dr, 0, MAX_ROWS - 1), clamp(base[1] + dc, 0, MAX_COLS - 1));
      } else if (commitEdit()) move(dr, dc);
    }
  }

  // F4 cycles the reference at the caret through A1 → $A$1 → A$1 → $A1.
  function cycleAbsolute(el) {
    const v = el.value, pos = el.selectionStart;
    const re = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g;
    let m;
    while ((m = re.exec(v))) {
      if (pos < m.index || pos > m.index + m[0].length) continue;
      const state = (m[1] ? 2 : 0) + (m[3] ? 1 : 0);
      const next = { 0: [1, 1], 3: [0, 1], 1: [1, 0], 2: [0, 0] }[state];
      const text = (next[0] ? '$' : '') + m[2] + (next[1] ? '$' : '') + m[4];
      el.value = v.slice(0, m.index) + text + v.slice(m.index + m[0].length);
      el.setSelectionRange(m.index + text.length, m.index + text.length);
      onEditInput();
      return;
    }
  }

  // ------------------------------------------------------------ clipboard
  function copySel(cut) {
    const { r1, c1, r2, c2 } = selRect();
    const ext = sheet().extent();
    const R2 = Math.min(r2, Math.max(r1, ext.rows - 1)), C2 = Math.min(c2, Math.max(c1, ext.cols - 1));
    const cells = [], lines = [];
    for (let r = r1; r <= R2; r++) {
      const row = [], line = [];
      for (let c = c1; c <= C2; c++) {
        const cell = sheet().get(r, c);
        row.push({ input: cell ? cell.input : '', style: cell && cell.style ? { ...cell.style } : null });
        const text = cell && cell.input !== '' ? XL.formatValue(valueAt(r, c), (cell && cell.style) || {}) : '';
        line.push(/[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
      }
      cells.push(row);
      lines.push(line.join('\t'));
    }
    const merges = sheet().merges.filter((m) => m.r1 >= r1 && m.c1 >= c1 && m.r2 <= R2 && m.c2 <= C2)
      .map((m) => ({ r1: m.r1 - r1, c1: m.c1 - c1, r2: m.r2 - r1, c2: m.c2 - c1 }));
    S.clip = { si: S.si, r1, c1, r2: R2, c2: C2, cells, merges, text: lines.join('\n'), cut };
    updateSelection();
    return S.clip.text;
  }
  const normClip = (s) => s.replace(/\r/g, '').replace(/\n+$/, '');

  function pasteText(text) {
    if (S.clip && normClip(text) === normClip(S.clip.text)) return pasteInternal();
    if (guard()) return;
    const rows = parseDelimited(text.replace(/\n+$/, ''), '\t');
    pushUndo();
    const { r1, c1 } = selRect();
    rows.forEach((row, i) => row.forEach((v, j) => { ensureSize(r1 + i, c1 + j); S.wb.setInput(S.si, r1 + i, c1 + j, v); }));
    setSel(r1, c1, r1 + rows.length - 1, c1 + Math.max(...rows.map((r) => r.length)) - 1);
    changed();
  }
  function pasteInternal() {
    if (guard()) return;
    const clip = S.clip;
    const h = clip.cells.length, w = clip.cells[0].length;
    const { r1, c1, r2, c2 } = selRect();
    const reps = (span, n) => (span % n === 0 ? span / n : 1);
    const rr = reps(r2 - r1 + 1, h), rc = reps(c2 - c1 + 1, w);
    const target = { r1, c1, r2: r1 + rr * h - 1, c2: c1 + rc * w - 1 };
    if (sheet().merges.some((m) => overlaps(m, target) && !(m.r1 >= target.r1 && m.c1 >= target.c1 && m.r2 <= target.r2 && m.c2 <= target.c2))) return msg("We can't do that to a merged cell.");
    pushUndo();
    sheet().merges = sheet().merges.filter((m) => !overlaps(m, target));
    if (clip.cut) { const src = S.wb.sheets[clip.si]; src.merges = src.merges.filter((m) => !overlaps(m, clip)); }
    for (let a = 0; a < rr; a++) for (let b = 0; b < rc; b++) for (const m of clip.merges || []) {
      sheet().merges.push({ r1: r1 + a * h + m.r1, c1: c1 + b * w + m.c1, r2: r1 + a * h + m.r2, c2: c1 + b * w + m.c2 });
    }
    if (clip.cut) {
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
        S.wb.setStyle(clip.si, clip.r1 + i, clip.c1 + j, null, true);
        S.wb.setInput(clip.si, clip.r1 + i, clip.c1 + j, '');
      }
    }
    for (let a = 0; a < rr; a++) for (let b = 0; b < rc; b++) for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
      const tr = r1 + a * h + i, tc = c1 + b * w + j;
      const src = clip.cells[i][j];
      ensureSize(tr, tc);
      let input = src.input;
      if (!clip.cut && input.startsWith('=')) input = XL.shiftFormula(input, tr - (clip.r1 + i), tc - (clip.c1 + j));
      S.wb.setInput(S.si, tr, tc, input);
      S.wb.setStyle(S.si, tr, tc, src.style, true);
    }
    if (clip.cut) S.clip = null;
    setSel(r1, c1, r1 + rr * h - 1, c1 + rc * w - 1);
    changed();
  }

  // RFC 4180-style parser used for CSV import and clipboard text.
  function parseDelimited(text, delim) {
    const rows = [[]];
    let field = '', i = 0, quoted = false;
    while (i < text.length) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '') { quoted = true; i++; continue; }
      if (ch === delim) { rows[rows.length - 1].push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { rows[rows.length - 1].push(field); rows.push([]); field = ''; i++; continue; }
      field += ch; i++;
    }
    rows[rows.length - 1].push(field);
    return rows;
  }

  // ------------------------------------------------------------ fill handle & fill commands
  function performFill(src, dir, count) {
    if (guard() || count <= 0) return;
    pushUndo();
    const vertical = dir === 'down' || dir === 'up';
    const forward = dir === 'down' || dir === 'right';
    const len = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
    const [from, to] = vertical ? [src.c1, src.c2] : [src.r1, src.r2];
    for (let line = from; line <= to; line++) {
      const at = (i) => (vertical ? [src.r1 + i, line] : [line, src.c1 + i]);
      const inputs = [], styles = [];
      for (let i = 0; i < len; i++) {
        const [r, c] = at(i);
        inputs.push(S.wb.getInput(S.si, r, c));
        const st = S.wb.getStyle(S.si, r, c);
        styles.push(Object.keys(st).length ? { ...st } : null);
      }
      const nums = inputs.map((s) => (s.startsWith('=') ? null : XL.parseLiteral(s).value));
      const series = len >= 2 && nums.every((n) => typeof n === 'number');
      const step = series ? (nums[len - 1] - nums[0]) / (len - 1) : 0;
      for (let k = 1; k <= count; k++) {
        const pos = forward ? len - 1 + k : -k;
        const srcIdx = forward ? (k - 1) % len : len - 1 - ((k - 1) % len);
        const [r, c] = at(pos);
        if (r < 0 || c < 0) continue;
        const [sr, sc] = at(srcIdx);
        let input = inputs[srcIdx];
        if (series) input = String(parseFloat((nums[0] + step * pos).toPrecision(12)));
        else if (input.startsWith('=')) input = XL.shiftFormula(input, r - sr, c - sc);
        else if (len === 1) {
          const m = /^(.*?)(\d+)$/.exec(input);
          if (m && typeof XL.parseLiteral(input).value === 'string') input = m[1] + (parseInt(m[2], 10) + (forward ? k : -k));
        }
        ensureSize(r, c);
        S.wb.setInput(S.si, r, c, input);
        S.wb.setStyle(S.si, r, c, styles[srcIdx], true);
      }
    }
    const ext = { ...src };
    if (dir === 'down') ext.r2 += count; else if (dir === 'up') ext.r1 = Math.max(0, ext.r1 - count);
    else if (dir === 'right') ext.c2 += count; else ext.c1 = Math.max(0, ext.c1 - count);
    setSel(ext.r1, ext.c1, ext.r2, ext.c2);
    changed();
  }
  function fillFromEdge(vertical) {
    const { r1, c1, r2, c2 } = selRect();
    if (vertical) {
      if (r1 === r2) { if (r1 > 0) { setSel(r1 - 1, c1, r2, c2); performFill({ r1: r1 - 1, c1, r2: r1 - 1, c2 }, 'down', 1); } return; }
      copyFill({ r1, c1, r2: r1, c2 }, 'down', r2 - r1);
    } else {
      if (c1 === c2) { if (c1 > 0) { setSel(r1, c1 - 1, r2, c2); performFill({ r1, c1: c1 - 1, r2, c2: c1 - 1 }, 'right', 1); } return; }
      copyFill({ r1, c1, r2, c2: c1 }, 'right', c2 - c1);
    }
  }
  // Fill Down / Fill Right copy (never extend a series), like Excel's ⌘D / ⌘R.
  function copyFill(src, dir, count) {
    if (guard()) return;
    pushUndo();
    for (let k = 1; k <= count; k++) {
      for (let i = 0; i <= (dir === 'down' ? src.c2 - src.c1 : src.r2 - src.r1); i++) {
        const [sr, sc] = dir === 'down' ? [src.r1, src.c1 + i] : [src.r1 + i, src.c1];
        const [r, c] = dir === 'down' ? [sr + k, sc] : [sr, sc + k];
        let input = S.wb.getInput(S.si, sr, sc);
        if (input.startsWith('=')) input = XL.shiftFormula(input, r - sr, c - sc);
        S.wb.setInput(S.si, r, c, input);
        const st = S.wb.getStyle(S.si, sr, sc);
        S.wb.setStyle(S.si, r, c, Object.keys(st).length ? { ...st } : null, true);
      }
    }
    changed();
  }

  // ------------------------------------------------------------ styles & formats
  function forSel(fn) {
    const { r1, c1, r2, c2 } = selRect();
    for (let r = r1; r <= Math.min(r2, S.rows - 1); r++) for (let c = c1; c <= Math.min(c2, S.cols - 1); c++) fn(r, c);
  }
  function applyStyle(patch) {
    if (S.editing && !commitEdit()) return;
    if (guard()) return;
    pushUndo();
    forSel((r, c) => S.wb.setStyle(S.si, r, c, patch));
    if ('fmt' in patch || 'dec' in patch || 'size' in patch) { const { r1, c1, r2, c2 } = selRect(); fitNumbers(c1, c2, r1, r2); }
    changed();
  }
  const activeStyle = () => S.wb.getStyle(S.si, S.sel.ar, S.sel.ac);
  const toggleStyle = (prop) => applyStyle({ [prop]: activeStyle()[prop] ? undefined : true });
  const toggleValue = (prop, value) => applyStyle({ [prop]: activeStyle()[prop] === value ? undefined : value });
  function adjustDecimals(delta) {
    const st = activeStyle();
    const v = valueAt(S.sel.ar, S.sel.ac);
    let cur = st.dec;
    if (cur === undefined) {
      if (['number', 'currency', 'accounting', 'percent', 'scientific'].includes(st.fmt)) cur = st.fmt === 'percent' ? 2 : 2;
      else if (typeof v === 'number') { const s = XL.formatGeneral(v); cur = s.includes('.') && !s.includes('E') ? s.split('.')[1].length : 0; }
      else cur = 0;
    }
    applyStyle({ dec: clamp(cur + delta, 0, 15) });
  }
  function fontSizeStep(dir) {
    const sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
    const cur = activeStyle().size || 11;
    const i = sizes.findIndex((s) => s >= cur);
    const next = sizes[clamp((i < 0 ? sizes.length - 1 : i) + dir, 0, sizes.length - 1)];
    applyStyle({ size: next === 11 ? undefined : next });
  }
  // ------------------------------------------------------------ cell styles (Excel's gallery, Office 2023+ theme)
  // A style formats only the categories it includes; the rest of the cell's formatting is kept.
  const STYLE_CATS = {
    number: ['fmt', 'dec'], align: ['align', 'valign', 'wrap', 'indent', 'rot'],
    font: ['font', 'size', 'bold', 'italic', 'underline', 'strike', 'color'], border: ['border', 'bd'], fill: ['fill'],
  };
  const CAT_LABEL = { number: 'Number', align: 'Alignment', font: 'Font', border: 'Border', fill: 'Fill' };
  const ALL_CATS = Object.keys(STYLE_CATS);
  const box = (weight, col) => ({ t: [weight, col], b: [weight, col], l: [weight, col], r: [weight, col] });
  const TEXT2 = '#0e2841';
  const ACCENT = ['#156082', '#e97132', '#196b24', '#0f9ed5', '#a02b93', '#4ea72e'];
  const TINT = { // theme accents lightened in HSL, as Excel does: 20% = tint .8, 40% = .6, 60% = .4
    20: ['#c1e5f5', '#fbe3d6', '#c2f1c8', '#caeefb', '#f2cfee', '#d9f2d0'],
    40: ['#83cbeb', '#f6c6ad', '#84e291', '#96dcf8', '#e59edd', '#b4e5a2'],
    60: ['#46b1e1', '#f2aa84', '#47d45a', '#61cbf4', '#d86ecc', '#8ed973'],
  };
  const FF = ['font', 'fill'], FFB = ['font', 'fill', 'border'], FB = ['font', 'border'];
  const st_ = (key, name, inc, def) => ({ key, name, inc, def });
  const STYLE_SECTIONS = [
    ['Good, Bad and Neutral', [
      st_('normal', 'Normal', ALL_CATS, {}),
      st_('bad', 'Bad', FF, { fill: '#ffc7ce', color: '#9c0006' }),
      st_('good', 'Good', FF, { fill: '#c6efce', color: '#006100' }),
      st_('neutral', 'Neutral', FF, { fill: '#ffeb9c', color: '#9c5700' }),
    ]],
    ['Data and Model', [
      st_('calculation', 'Calculation', FFB, { fill: '#f2f2f2', color: '#fa7d00', bold: true, bd: box('thin', '#7f7f7f') }),
      st_('checkCell', 'Check Cell', FFB, { fill: '#a5a5a5', color: '#ffffff', bold: true, bd: box('double', '#3f3f3f') }),
      st_('explanatory', 'Explanatory Text', ['font'], { color: '#7f7f7f', italic: true }),
      st_('input', 'Input', FFB, { fill: '#ffcc99', color: '#3f3f76', bd: box('thin', '#7f7f7f') }),
      st_('linkedCell', 'Linked Cell', FB, { color: '#fa7d00', bd: { b: ['double', '#ff8001'] } }),
      st_('note', 'Note', ['fill', 'border'], { fill: '#ffffcc', bd: box('thin', '#b2b2b2') }),
      st_('output', 'Output', FFB, { fill: '#f2f2f2', color: '#3f3f3f', bold: true, bd: box('thin', '#3f3f3f') }),
      st_('warning', 'Warning Text', ['font'], { color: '#ff0000' }),
    ]],
    ['Titles and Headings', [
      st_('heading1', 'Heading 1', FB, { bold: true, size: 15, color: TEXT2, bd: { b: ['thick', ACCENT[0]] } }),
      st_('heading2', 'Heading 2', FB, { bold: true, size: 13, color: TEXT2, bd: { b: ['thick', '#64bee6'] } }),
      st_('heading3', 'Heading 3', FB, { bold: true, color: TEXT2, bd: { b: ['medium', TINT[60][0]] } }),
      st_('heading4', 'Heading 4', ['font'], { bold: true, color: TEXT2 }),
      st_('title', 'Title', ['font'], { font: 'Aptos Display', size: 18, color: TEXT2 }),
      st_('total', 'Total', FB, { bold: true, bd: { t: ['thin', ACCENT[0]], b: ['double', ACCENT[0]] } }),
    ]],
    ['Themed Cell Styles', [
      ...[20, 40, 60].flatMap((p) => ACCENT.map((_, i) => st_(`accent${i + 1}_${p}`, `${p}% - Accent${i + 1}`, FF, { fill: TINT[p][i], color: p === 60 ? '#ffffff' : undefined }))),
      ...ACCENT.map((a, i) => st_(`accent${i + 1}`, `Accent${i + 1}`, FF, { fill: a, color: '#ffffff' })),
    ]],
    ['Number Format', [
      st_('comma', 'Comma', ['number'], { fmt: 'number', dec: 2 }),
      st_('comma0', 'Comma [0]', ['number'], { fmt: 'number', dec: 0 }),
      st_('currency', 'Currency', ['number'], { fmt: 'accounting', dec: 2 }),
      st_('currency0', 'Currency [0]', ['number'], { fmt: 'accounting', dec: 0 }),
      st_('percent', 'Percent', ['number'], { fmt: 'percent', dec: 0 }),
    ]],
  ];
  const BUILTIN_STYLES = new Map(STYLE_SECTIONS.flatMap(([, list]) => list.map((x) => [x.key, x])));
  const customKey = (name) => 'c:' + name;
  const customStyles = () => S.wb.cellStyles.map((x) => ({ ...x, key: customKey(x.name) }));
  const styleDef = (key) => BUILTIN_STYLES.get(key) || customStyles().find((x) => x.key === key);
  const styleNameTaken = (name, except) => [...BUILTIN_STYLES.values(), ...customStyles()]
    .some((x) => x.name.toLowerCase() === name.toLowerCase() && x.key !== except);

  function styledWith(cur, def) {
    const out = { ...cur };
    for (const cat of def.inc) for (const p of STYLE_CATS[cat]) { delete out[p]; if (def.def[p] !== undefined) out[p] = def.def[p]; }
    if (def.key === 'normal') delete out.cs; else out.cs = def.key;
    return out;
  }
  function applyCellStyle(key) {
    const def = styleDef(key);
    if (!def) return;
    if (S.editing && !commitEdit()) return;
    if (guard()) return;
    pushUndo();
    forSel((r, c) => S.wb.setStyle(S.si, r, c, styledWith(S.wb.getStyle(S.si, r, c), def), true));
    if (def.inc.includes('number') || def.inc.includes('font')) { const { r1, c1, r2, c2 } = selRect(); fitNumbers(c1, c2, r1, r2); }
    changed();
  }
  // Every cell carrying a style, across all sheets.
  function forStyled(key, fn) {
    S.wb.sheets.forEach((sh, si) => { for (const [k, cell] of sh.cells) if (cell.style && cell.style.cs === key) fn(si, ...k.split(',').map(Number), cell.style); });
  }

  // Live preview: hovering a tile formats the selection until the pointer leaves or the gallery closes.
  let stylePreview = null;
  function startPreview(key) {
    if (stylePreview && stylePreview.key === key) return;
    endPreview(false);
    const def = styleDef(key);
    if (!def || S.editing || view().protected) return renderAll();
    stylePreview = { key, saved: new Map() };
    forSel((r, c) => {
      const cur = S.wb.getStyle(S.si, r, c);
      stylePreview.saved.set(`${r},${c}`, Object.keys(cur).length ? cur : null);
      S.wb.setStyle(S.si, r, c, styledWith(cur, def), true);
    });
    renderAll();
  }
  function endPreview(render = true) {
    if (!stylePreview) return;
    for (const [k, st] of stylePreview.saved) { const [r, c] = k.split(',').map(Number); S.wb.setStyle(S.si, r, c, st, true); }
    stylePreview = null;
    if (render) renderAll();
  }

  function tileCss(d) {
    const css = [];
    if (d.fill) css.push('background:' + d.fill);
    if (d.color) css.push('color:' + d.color);
    if (d.bold) css.push('font-weight:700');
    if (d.italic) css.push('font-style:italic');
    const deco = [d.underline && 'underline', d.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) css.push('text-decoration:' + deco);
    if (d.font) css.push(`font-family:"${d.font}",var(--cell-font)`);
    if (d.size) css.push(`font-size:${Math.round(13 + (clamp(d.size, 8, 20) - 11) * 0.8)}px`);
    const bg = d.fill || '#fff', shadows = [];
    [['t', 0, 1], ['b', 0, -1], ['l', 1, 0], ['r', -1, 0]].forEach(([side, dx, dy]) => { const e = edgeOf(d, side); if (e) shadows.push(...edgeShadows(e, dx, dy, bg, false)); });
    if (shadows.length) css.push('box-shadow:' + shadows.join(','));
    return css.join(';');
  }
  function renderGallery() {
    const cur = activeStyle().cs || (Object.keys(activeStyle()).length ? '' : 'normal');
    const tile = (x) => `<button class="cs-tile${x.key === cur ? ' current' : ''}" role="menuitem" data-style="${esc(x.key)}" title="${esc(x.name)}" style="${tileCss(x.def)}">${esc(x.name)}</button>`;
    const custom = customStyles();
    const sections = custom.length ? [['Custom', custom], ...STYLE_SECTIONS] : STYLE_SECTIONS;
    $('#cellStyles').innerHTML = sections.map(([head, list]) => `<div class="cs-head">${esc(head)}</div><div class="cs-grid">${list.map(tile).join('')}</div>`).join('')
      + '<div class="cs-foot"><button data-cmd="newCellStyle" role="menuitem">New Cell Style…</button></div>';
  }

  // New / Duplicate / Modify: a name plus the categories the style includes, taken by example.
  const STYLE_ORDER = ['number', 'align', 'font', 'border', 'fill'];
  function describeCat(cat, d) {
    if (cat === 'number') return d.fmt ? $(`#numFmt option[value="${d.fmt}"]`)?.textContent || d.fmt : 'General';
    if (cat === 'align') return [d.align === 'centerAcross' ? 'Center Across Selection' : d.align ? d.align[0].toUpperCase() + d.align.slice(1) : 'General', `${d.valign ? d.valign[0].toUpperCase() + d.valign.slice(1) : 'Bottom'} Aligned`, d.wrap && 'Wrap', d.indent && `Indent ${d.indent}`, d.rot && (d.rot === 'v' ? 'Vertical' : `${d.rot}°`)].filter(Boolean).join(', ');
    if (cat === 'font') return [`${d.font || 'Aptos Narrow'} ${d.size || 11}`, d.bold && 'Bold', d.italic && 'Italic', d.underline && 'Underline', d.color && d.color.toUpperCase()].filter(Boolean).join(', ');
    if (cat === 'border') return d.bd || d.border ? 'Borders' : 'No Borders';
    return d.fill ? d.fill.toUpperCase() : 'No Shading';
  }
  function uniqueStyleName(base, n = 1) {
    while (styleNameTaken(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }
  function openStyleDialog(mode, key) {
    if (S.editing && !commitEdit()) return;
    const src = key ? styleDef(key) : null;
    const def = src ? { ...src.def } : Object.fromEntries(Object.entries(activeStyle()).filter(([p]) => p !== 'cs'));
    const inc = src ? src.inc : ALL_CATS;
    const d = $('#csDialog');
    styleDialogKey = mode === 'modify' ? key : null;
    $('#csTitle').textContent = mode === 'modify' ? 'Modify Cell Style' : mode === 'duplicate' ? 'Duplicate Cell Style' : 'New Cell Style';
    $('#csName').value = mode === 'modify' ? src.name : mode === 'duplicate' ? uniqueStyleName(src.name, 2) : uniqueStyleName('Style');
    $('#csErr').hidden = true;
    $('#csIncludes').innerHTML = STYLE_ORDER.map((cat) => `<label class="check"><input type="checkbox" value="${cat}"${inc.includes(cat) ? ' checked' : ''}><span>${CAT_LABEL[cat]}</span><span class="cs-desc">${esc(describeCat(cat, def))}</span></label>`).join('');
    d.returnValue = '';
    d.onclose = () => {
      if (d.returnValue === 'ok') saveCustomStyle(mode, src, $('#csName').value.trim(), [...$('#csIncludes').querySelectorAll('input:checked')].map((i) => i.value), def);
      focusGrid();
    };
    d.showModal();
    $('#csName').select();
  }
  let styleDialogKey = null; // the style being modified, so it may keep its own name
  function styleDialogError() {
    const name = $('#csName').value.trim();
    return !name ? 'Enter a style name.' : styleNameTaken(name, styleDialogKey) ? 'A style with this name already exists.' : '';
  }
  function saveCustomStyle(mode, src, name, inc, def) {
    pushUndo();
    const keep = Object.fromEntries(inc.flatMap((cat) => STYLE_CATS[cat].filter((p) => def[p] !== undefined).map((p) => [p, def[p]])));
    const entry = { name, inc: STYLE_ORDER.filter((c) => inc.includes(c)), def: keep };
    if (mode === 'modify') {
      const i = S.wb.cellStyles.findIndex((x) => x.name === src.name);
      S.wb.cellStyles[i] = entry;
      const next = { ...entry, key: customKey(name) };
      forStyled(src.key, (si, r, c, st) => S.wb.setStyle(si, r, c, styledWith(st, next), true));
    } else {
      S.wb.cellStyles.push(entry);
    }
    changed();
  }
  function deleteCustomStyle(key) {
    const def = styleDef(key);
    pushUndo();
    S.wb.cellStyles = S.wb.cellStyles.filter((x) => customKey(x.name) !== key);
    // Excel returns the cells to Normal for every category the deleted style included.
    forStyled(key, (si, r, c, st) => S.wb.setStyle(si, r, c, styledWith(st, { ...BUILTIN_STYLES.get('normal'), inc: def.inc }), true));
    changed();
  }

  function updateRibbonState() {
    const st = activeStyle();
    const on = (cmd, v) => document.querySelectorAll(`.ribbon [data-cmd="${cmd}"]`).forEach((b) => b.classList.toggle('on', !!v));
    on('bold', st.bold); on('italic', st.italic); on('underline', st.underline); on('strike', st.strike);
    on('mergeCenter', !!mergeAt(S.sel.ar, S.sel.ac));
    on('rotCCW', st.rot === 45); on('rotCW', st.rot === -45); on('rotVertical', st.rot === 'v'); on('rotUp', st.rot === 90); on('rotDown', st.rot === -90);
    document.querySelectorAll('#orientMenu [data-cmd]').forEach((b) => b.setAttribute('aria-checked', b.classList.contains('on')));
    $('[data-menu="orientMenu"]').classList.toggle('on', !!st.rot);
    on('wrap', st.wrap); on('alignLeft', st.align === 'left'); on('alignCenter', st.align === 'center'); on('alignRight', st.align === 'right');
    on('valignTop', st.valign === 'top'); on('valignMiddle', st.valign === 'middle'); on('valignBottom', !st.valign || st.valign === 'bottom');
    on('showFormulas', S.showFormulas); on('protect', view().protected); on('freezeRow', view().freezeRow); on('freezeCol', view().freezeCol);
    on('printGridlines', view().printGridlines); on('formatPainter', S.painter);
    $('#fontFamily').value = st.font || 'Aptos Narrow';
    $('#fontSize').value = String(st.size || 11);
    if (![...$('#fontSize').options].some((o) => o.value === String(st.size || 11))) $('#fontSize').add(new Option(String(st.size)));
    $('#fontSize').value = String(st.size || 11);
    $('#numFmt').value = st.fmt && st.fmt !== 'datetime' && st.fmt !== 'custom' ? st.fmt : st.fmt === 'datetime' ? 'date' : 'general';
  }

  // ------------------------------------------------------------ structure: rows, columns, sheets
  function insertCells(axis, del) {
    if (S.editing && !commitEdit()) return;
    if (guard()) return;
    const { r1, c1, r2, c2 } = selRect();
    const [at, n] = axis === 'row' ? [r1, r2 - r1 + 1] : [c1, c2 - c1 + 1];
    pushUndo();
    S.wb.shift(S.si, axis, at, del ? -n : n);
    if (view().charts) view().charts = [];
    buildGrid();
    changed();
  }
  function newSheet() {
    if (S.editing && !commitEdit()) return;
    pushUndo();
    S.wb.addSheet(null, S.si + 1);
    switchSheet(S.si + 1);
    scheduleSave();
  }
  function deleteSheet(i = S.si) {
    if (S.wb.sheets.length === 1) return msg('A workbook must contain at least one visible worksheet.');
    const sh = S.wb.sheets[i];
    const go = () => {
      pushUndo();
      S.wb.sheets.splice(i, 1);
      S.wb.recalc();
      S.si = Math.min(S.si, S.wb.sheets.length - 1);
      rebuild();
    };
    if (sh.cells.size) confirmBox(`Delete "${sh.name}"? Its data will be removed. You can undo this with ⌘Z.`, go);
    else go();
  }
  function switchSheet(i) {
    if (i < 0 || i >= S.wb.sheets.length) return;
    if (S.editing && !commitEdit()) return;
    S.si = i;
    S.sel = view().sel || { ar: 0, ac: 0, fr: 0, fc: 0 };
    S.rows = 200; S.cols = 30;
    gridWrap.scrollTop = 0; gridWrap.scrollLeft = 0;
    buildGrid();
    renderTabs();
    applyViewOptions();
    updateSelection();
    ensureVisible(S.sel.ar, S.sel.ac);
  }
  function renderTabs() {
    const host = $('#sheetTabs');
    host.innerHTML = S.wb.sheets.map((s, i) => `<div class="sheet-tab${i === S.si ? ' active' : ''}" data-si="${i}" draggable="true">${esc(s.name)}</div>`).join('');
  }
  function renameSheetInline(i) {
    const tab = $(`#sheetTabs [data-si="${i}"]`);
    if (!tab) return;
    const old = S.wb.sheets[i].name;
    tab.innerHTML = `<input value="${esc(old)}" maxlength="31">`;
    const input = tab.firstChild;
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && name !== old) {
        const clash = S.wb.sheetIndex(name);
        if (/[\\/?*[\]:]/.test(name) || (clash >= 0 && clash !== i)) {
          msg('That sheet name is taken or contains characters that are not allowed ( \\ / ? * [ ] : ).');
        } else {
          pushUndo();
          S.wb.renameSheet(i, name);
          changed();
        }
      }
      renderTabs();
      focusGrid();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  function applyViewOptions() {
    const v = view();
    grid.classList.toggle('no-gridlines', v.gridlines === false);
    grid.classList.toggle('print-grid', !!v.printGridlines);
    app.classList.toggle('no-headings', v.headings === false);
    $('#optGridlines').checked = v.gridlines !== false;
    $('#optHeadings').checked = v.headings !== false;
    gridInner.style.zoom = S.zoom / 100;
    $('#zoomSlider').value = S.zoom;
    $('#zoomText').textContent = S.zoom + '%';
    updateRibbonState();
  }
  function setZoom(z) {
    S.zoom = clamp(Math.round(z / 10) * 10, 50, 200);
    applyViewOptions();
    updateSelection();
  }

  // ------------------------------------------------------------ data commands
  function currentRegion(r, c) {
    let r1 = r, r2 = r, c1 = c, c2 = c, grew = true;
    const anyFilled = (ra, rb, ca, cb) => { for (let i = ra; i <= rb; i++) for (let j = ca; j <= cb; j++) if (i >= 0 && j >= 0 && filled(i, j)) return true; return false; };
    while (grew) {
      grew = false;
      if (r1 > 0 && anyFilled(r1 - 1, r1 - 1, c1 - 1, c2 + 1)) { r1--; grew = true; }
      if (anyFilled(r2 + 1, r2 + 1, c1 - 1, c2 + 1)) { r2++; grew = true; }
      if (c1 > 0 && anyFilled(r1, r2, c1 - 1, c1 - 1)) { c1--; grew = true; }
      if (anyFilled(r1, r2, c2 + 1, c2 + 1)) { c2++; grew = true; }
    }
    return { r1, c1, r2, c2 };
  }
  // Sorting/dedupe region: the selection, or the data block around the active cell (with header detection).
  function dataRegion() {
    let rect = selRect();
    let header = false;
    if (rect.r1 === rect.r2 && rect.c1 === rect.c2) {
      rect = currentRegion(rect.r1, rect.c1);
      if (rect.r2 > rect.r1) {
        const row = (r) => { const out = []; for (let c = rect.c1; c <= rect.c2; c++) out.push(valueAt(r, c)); return out; };
        const first = row(rect.r1), second = row(rect.r1 + 1);
        header = first.every((v) => v === null || typeof v === 'string') && second.some((v, i) => typeof v !== typeof first[i] && v !== null);
      }
    } else {
      const ext = sheet().extent();
      rect.r2 = Math.min(rect.r2, ext.rows - 1);
      rect.c2 = Math.min(rect.c2, ext.cols - 1);
    }
    return { ...rect, start: rect.r1 + (header ? 1 : 0) };
  }
  function readRow(r, c1, c2) {
    const out = [];
    for (let c = c1; c <= c2; c++) {
      const cell = sheet().get(r, c);
      out.push({ input: cell ? cell.input : '', style: cell && cell.style ? { ...cell.style } : null });
    }
    return out;
  }
  function writeRow(r, c1, cells, fromRow) {
    cells.forEach((cell, j) => {
      let input = cell.input;
      if (input.startsWith('=') && fromRow !== undefined) input = XL.shiftFormula(input, r - fromRow, 0);
      S.wb.setInput(S.si, r, c1 + j, input);
      S.wb.setStyle(S.si, r, c1 + j, cell.style, true);
    });
  }
  function sortData(desc) {
    if (S.editing && !commitEdit()) return;
    if (guard()) return;
    const reg = dataRegion();
    if (reg.r2 <= reg.start) return;
    // Excel sorts merged cells only when every row holds the same one-row merges, which then stay in place.
    const inSort = sheet().merges.filter((m) => overlaps(m, { r1: reg.start, c1: reg.c1, r2: reg.r2, c2: reg.c2 }));
    if (inSort.length) {
      const spans = (r) => inSort.filter((m) => m.r1 === r).map((m) => `${m.c1}-${m.c2}`).sort().join();
      const same = inSort.every((m) => m.r1 === m.r2 && m.c1 >= reg.c1 && m.c2 <= reg.c2)
        && Array.from({ length: reg.r2 - reg.start + 1 }, (_, i) => spans(reg.start + i)).every((x, _, all) => x === all[0]);
      if (!same) return msg('To do this, all the merged cells need to be the same size.');
    }
    const key = clamp(S.sel.ac, reg.c1, reg.c2);
    const rows = [];
    for (let r = reg.start; r <= reg.r2; r++) rows.push({ r, key: valueAt(r, key), cells: readRow(r, reg.c1, reg.c2) });
    rows.sort((a, b) => {
      const ea = a.key === null || a.key === '', eb = b.key === null || b.key === '';
      if (ea || eb) return ea - eb;
      const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3);
      let d = rank(a.key) - rank(b.key);
      if (!d) {
        const x = typeof a.key === 'string' ? a.key.toLowerCase() : XL.isErr(a.key) ? a.key.code : a.key;
        const y = typeof b.key === 'string' ? b.key.toLowerCase() : XL.isErr(b.key) ? b.key.code : b.key;
        d = x < y ? -1 : x > y ? 1 : 0;
      }
      return desc ? -d : d;
    });
    pushUndo();
    rows.forEach((row, i) => writeRow(reg.start + i, reg.c1, row.cells, row.r));
    setSel(reg.start, key, reg.r2, key);
    S.sel = { ar: reg.start, ac: reg.c1, fr: reg.r2, fc: reg.c2 };
    changed();
  }
  function removeDuplicates() {
    if (S.editing && !commitEdit()) return;
    if (guard()) return;
    const reg = dataRegion();
    if (reg.r2 < reg.start) return;
    const seen = new Set(), keep = [];
    for (let r = reg.start; r <= reg.r2; r++) {
      const k = [];
      for (let c = reg.c1; c <= reg.c2; c++) { const v = valueAt(r, c); k.push(typeof v === 'string' ? 's:' + v.toLowerCase() : String(v)); }
      const id = k.join('\u0001');
      if (!seen.has(id)) { seen.add(id); keep.push({ r, cells: readRow(r, reg.c1, reg.c2) }); }
    }
    const removed = reg.r2 - reg.start + 1 - keep.length;
    if (removed) {
      pushUndo();
      keep.forEach((row, i) => writeRow(reg.start + i, reg.c1, row.cells, row.r));
      for (let r = reg.start + keep.length; r <= reg.r2; r++) writeRow(r, reg.c1, readRow(-1, reg.c1, reg.c2));
      changed();
    }
    msg(removed ? `${removed} duplicate row${removed > 1 ? 's' : ''} found and removed; ${keep.length} unique row${keep.length === 1 ? '' : 's'} remain.` : 'No duplicate values found.');
  }
  function autoSum() {
    if (S.editing && !commitEdit()) return;
    const { r1, c1, r2, c2 } = selRect();
    const isNum = (r, c) => typeof valueAt(r, c) === 'number';
    if (r1 === r2 && c1 === c2) {
      const r = r1, c = c1;
      let range = '';
      let top = r - 1;
      while (top >= 0 && isNum(top, c)) top--;
      if (top < r - 1) range = `${addr(top + 1, c)}:${addr(r - 1, c)}`;
      else {
        let left = c - 1;
        while (left >= 0 && isNum(r, left)) left--;
        if (left < c - 1) range = `${addr(r, left + 1)}:${addr(r, c - 1)}`;
      }
      if (startEdit('enter', `=SUM(${range})`) && !range) editor.setSelectionRange(5, 5);
      return;
    }
    if (guard()) return;
    pushUndo();
    for (let c = c1; c <= c2; c++) S.wb.setInput(S.si, r2 + 1, c, `=SUM(${addr(r1, c)}:${addr(r2, c)})`);
    changed();
  }
  function findNext(query) {
    if (!query) return;
    const q = query.toLowerCase();
    const ext = sheet().extent();
    const total = ext.rows * ext.cols;
    if (!total) return msg(`Cannot find "${query}".`);
    let idx = S.sel.ar * ext.cols + S.sel.ac;
    for (let n = 1; n <= total; n++) {
      const i = (idx + n) % total;
      const r = Math.floor(i / ext.cols), c = i % ext.cols;
      const cell = sheet().get(r, c);
      if (!cell || cell.input === '') continue;
      const shown = XL.formatValue(valueAt(r, c), cell.style || {});
      if (shown.toLowerCase().includes(q) || cell.input.toLowerCase().includes(q)) {
        setSel(r, c);
        ensureVisible(r, c);
        return;
      }
    }
    msg(`Cannot find "${query}".`);
  }

  // ------------------------------------------------------------ charts (live, drawn from sheet ranges)
  function addChart(type) {
    if (S.editing && !commitEdit()) return;
    let rect = selRect();
    if (rect.r1 === rect.r2 && rect.c1 === rect.c2) rect = currentRegion(rect.r1, rect.c1);
    if (rect.r1 === rect.r2 && rect.c1 === rect.c2 && !filled(rect.r1, rect.c1)) return msg('Select the data you want to chart first.');
    const box = boxFor(rect.r1, rect.c1, rect.r2, rect.c2) || { left: 60, top: 30, width: 0 };
    pushUndo();
    view().charts = [...(view().charts || []), { type, ...rect, x: box.left + box.width + 24, y: box.top }];
    changed();
  }
  function chartData(ch) {
    const v = (r, c) => valueAt(r, c);
    const header = (() => { for (let c = ch.c1; c <= ch.c2; c++) if (typeof v(ch.r1, c) === 'string') return ch.r2 > ch.r1; return false; })();
    const r0 = header ? ch.r1 + 1 : ch.r1;
    const labelsCol = (() => { for (let r = r0; r <= ch.r2; r++) if (typeof v(r, ch.c1) === 'string') return ch.c2 > ch.c1; return false; })();
    const c0 = labelsCol ? ch.c1 + 1 : ch.c1;
    const labels = [];
    for (let r = r0; r <= ch.r2; r++) labels.push(labelsCol ? XL.formatValue(v(r, ch.c1)) : String(r - r0 + 1));
    const series = [];
    for (let c = c0; c <= ch.c2; c++) {
      const vals = [];
      for (let r = r0; r <= ch.r2; r++) { const x = v(r, c); vals.push(typeof x === 'number' ? x : 0); }
      series.push({ name: header ? XL.formatValue(v(ch.r1, c)) : `Series${c - c0 + 1}`, vals });
    }
    return { labels, series };
  }
  function niceMax(x) {
    if (x <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(x));
    const n = x / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  function chartSvg(ch) {
    const { labels, series } = chartData(ch);
    const W = 440, H = 260, L = 46, R = 12, T = 30, B = 52;
    const all = series.flatMap((s) => s.vals);
    const max = niceMax(Math.max(0, ...all)), min = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(...all)) : 0;
    const y = (val) => T + (H - T - B) * (1 - (val - min) / (max - min));
    const plotW = W - L - R, n = Math.max(labels.length, 1);
    let out = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart">`;
    out += `<text x="${W / 2}" y="18" text-anchor="middle" style="font-size:13px">${esc(series.length === 1 ? series[0].name : 'Chart Title')}</text>`;
    for (let i = 0; i <= 5; i++) {
      const val = min + ((max - min) * i) / 5, yy = y(val);
      out += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#e6e6e6"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${esc(XL.formatGeneral(parseFloat(val.toPrecision(6))))}</text>`;
    }
    const slot = plotW / n;
    labels.forEach((lab, i) => { out += `<text x="${L + slot * (i + 0.5)}" y="${H - B + 16}" text-anchor="middle">${esc(lab.slice(0, 12))}</text>`; });
    series.forEach((s, k) => {
      const color = CHART_COLORS[k % CHART_COLORS.length];
      if (ch.type === 'line') {
        const pts = s.vals.map((val, i) => `${L + slot * (i + 0.5)},${y(val)}`).join(' ');
        out += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round"/>`;
      } else {
        const bw = (slot * 0.7) / series.length;
        s.vals.forEach((val, i) => {
          const x = L + slot * i + slot * 0.15 + bw * k;
          out += `<rect x="${x}" y="${Math.min(y(val), y(0))}" width="${Math.max(bw - 1, 1)}" height="${Math.abs(y(val) - y(0))}" fill="${color}"/>`;
        });
      }
    });
    let lx = L;
    series.forEach((s, k) => {
      out += `<rect x="${lx}" y="${H - 18}" width="10" height="10" fill="${CHART_COLORS[k % CHART_COLORS.length]}"/><text x="${lx + 14}" y="${H - 9}">${esc(s.name.slice(0, 16))}</text>`;
      lx += 24 + Math.min(s.name.length, 16) * 6.5;
    });
    return out + '</svg>';
  }
  function renderCharts() {
    const host = $('#charts');
    host.innerHTML = '';
    (view().charts || []).forEach((ch, i) => {
      const el = document.createElement('div');
      el.className = 'chart';
      el.style.left = ch.x + 'px';
      el.style.top = ch.y + 'px';
      el.innerHTML = `<header data-chart="${i}"><span>${ch.type === 'line' ? 'Line' : 'Column'} chart · ${addr(ch.r1, ch.c1)}:${addr(ch.r2, ch.c2)}</span><button data-close-chart="${i}" title="Delete chart">✕</button></header>${chartSvg(ch)}`;
      host.appendChild(el);
    });
  }

  // ------------------------------------------------------------ dialogs
  function msg(text, then) {
    const d = $('#msgDialog');
    $('#msgText').textContent = text;
    $('#msgText').style.whiteSpace = 'pre-wrap';
    d.querySelector('.actions').innerHTML = '<button value="ok" class="primary">OK</button>';
    d.onclose = () => { if (then) then(); else if (!S.editing) focusGrid(); };
    d.showModal();
  }
  function confirmBox(text, onYes) {
    const d = $('#msgDialog');
    $('#msgText').textContent = text;
    d.querySelector('.actions').innerHTML = '<button value="cancel">Cancel</button><button value="ok" class="primary">OK</button>';
    d.onclose = () => { if (d.returnValue === 'ok') onYes(); focusGrid(); };
    d.returnValue = '';
    d.showModal();
  }

  let fnSelected = null;
  function openFnDialog(cat = 'All') {
    const d = $('#fnDialog');
    const cats = ['All', ...new Set(Object.values(XL.FUNCTIONS).map((f) => f.cat))];
    $('#fnCategory').innerHTML = cats.map((c) => `<option>${esc(c)}</option>`).join('');
    $('#fnCategory').value = cat;
    $('#fnSearch').value = '';
    fnSelected = null;
    renderFnList();
    d.returnValue = '';
    d.onclose = () => {
      if (d.returnValue === 'ok' && fnSelected) insertFunctionName(fnSelected);
      else if (S.editing) activeInput().focus(); else focusGrid();
    };
    d.showModal();
    $('#fnSearch').focus();
  }
  function renderFnList() {
    const q = $('#fnSearch').value.trim().toUpperCase();
    const cat = $('#fnCategory').value;
    const names = Object.keys(XL.FUNCTIONS).filter((n) => {
      const f = XL.FUNCTIONS[n];
      return (cat === 'All' || f.cat === cat) && (!q || n.includes(q) || f.desc.toUpperCase().includes(q));
    }).sort();
    if (!names.includes(fnSelected)) fnSelected = names[0] || null;
    $('#fnList').innerHTML = names.map((n) => `<li data-fn="${n}" class="${n === fnSelected ? 'active' : ''}">${n}</li>`).join('');
    const f = fnSelected && XL.FUNCTIONS[fnSelected];
    $('#fnDetail').innerHTML = f ? `<b>${esc(f.syntax)}</b>${esc(f.desc)}` : 'No functions match your search.';
    $('#fnOk').disabled = !f;
  }
  function insertFunctionName(name) {
    if (S.editing) {
      const el = activeInput();
      const pos = el.selectionStart;
      let v = el.value;
      let text = name + '(';
      if (!v.startsWith('=')) { v = '=' + v; text = name + '('; }
      const p = v === el.value ? pos : pos + 1;
      el.value = v.slice(0, p) + text + v.slice(p);
      el.focus();
      el.setSelectionRange(p + text.length, p + text.length);
      onEditInput();
    } else {
      startEdit('enter', `=${name}(`);
    }
  }

  function showStats() {
    let cells = 0, formulas = 0, numbers = 0, texts = 0, errors = 0;
    S.wb.sheets.forEach((sh, si) => {
      for (const [k, cell] of sh.cells) {
        if (cell.input === '') continue;
        cells++;
        if (cell.formula) formulas++;
        const [r, c] = k.split(',').map(Number);
        const v = S.wb.getValue(si, r, c);
        if (typeof v === 'number') numbers++; else if (typeof v === 'string') texts++; else if (XL.isErr(v)) errors++;
      }
    });
    const ext = sheet().extent();
    let sheetCells = 0, sheetFormulas = 0;
    for (const cell of sheet().cells.values()) if (cell.input !== '') { sheetCells++; if (cell.formula) sheetFormulas++; }
    const rows = [
      ['head', `Current sheet: ${sheet().name}`],
      ['End of sheet', ext.rows ? addr(ext.rows - 1, ext.cols - 1) : 'A1'],
      ['Cells with data', sheetCells], ['Formulas', sheetFormulas], ['Charts', (view().charts || []).length],
      ['head', 'Workbook'],
      ['Sheets', S.wb.sheets.length], ['Cells with data', cells], ['Formulas', formulas],
      ['Numbers', numbers], ['Text values', texts], ['Error values', errors],
    ];
    $('#statsTable').innerHTML = rows.map(([a, b]) => (a === 'head' ? `<tr class="head"><td colspan="2">${esc(b)}</td></tr>` : `<tr><td>${a}</td><td>${b}</td></tr>`)).join('');
    $('#statsDialog').showModal();
  }

  function showCtx(x, y, items) {
    ctxMenu.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}">${esc(it.label)}</button>`)).join('');
    ctxMenu.style.display = 'block';
    ctxMenu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    ctxMenu.style.top = Math.min(y, window.innerHeight - ctxMenu.offsetHeight - 8) + 'px';
    ctxMenu.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      hideCtx();
      items[+b.dataset.i].run();
    };
  }
  const hideCtx = () => { ctxMenu.style.display = 'none'; };
  const closeMenus = () => { endPreview(); document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); };

  // ------------------------------------------------------------ document title flyout
  const titleBtn = $('#docTitleBtn'), flyout = $('#titleFlyout'), flyName = $('#flyName'), flyErr = $('#flyErr');
  const BAD_NAME = /[\\/:*?"<>|]/;
  const nameError = (n) => (!n ? 'Enter a file name.' : BAD_NAME.test(n) ? 'Name can’t contain \\ / : * ? " < > |' : '');
  function showNameError(text) {
    flyErr.textContent = text;
    flyErr.hidden = !text;
    flyName.classList.toggle('invalid', !!text);
  }
  function openFlyout() {
    if (S.editing && !commitEdit()) return;
    hideCtx(); closeMenus();
    flyName.value = S.docName;
    showNameError('');
    flyout.hidden = false;
    titleBtn.setAttribute('aria-expanded', 'true');
    flyName.focus();
    flyName.select();
  }
  function closeFlyout(refocus = true) {
    if (flyout.hidden) return;
    flyout.hidden = true;
    titleBtn.setAttribute('aria-expanded', 'false');
    if (refocus) focusGrid();
  }
  // Returns false (and keeps the field open) when the name is rejected.
  function commitName() {
    const n = flyName.value.trim();
    const err = nameError(n);
    if (err) { showNameError(err); return false; }
    showNameError('');
    if (n !== S.docName) {
      S.docName = n;
      $('#docName').textContent = n;
      document.title = `${n} — Spreadsheet`;
      saveNow();
    }
    return true;
  }

  // ------------------------------------------------------------ files
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportCsv() {
    const ext = sheet().extent();
    const lines = [];
    for (let r = 0; r < ext.rows; r++) {
      const row = [];
      for (let c = 0; c < ext.cols; c++) {
        const cell = sheet().get(r, c);
        const t = cell && cell.input !== '' ? XL.formatValue(valueAt(r, c), cell.style || {}) : '';
        row.push(/[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      }
      lines.push(row.join(','));
    }
    download(`${S.docName}${S.wb.sheets.length > 1 ? ' - ' + sheet().name : ''}.csv`, new Blob([lines.join('\r\n')], { type: 'text/csv' }));
  }
  const ERR_CODES = { '#NULL!': 0x00, '#DIV/0!': 0x07, '#VALUE!': 0x0f, '#REF!': 0x17, '#NAME?': 0x1d, '#NUM!': 0x24, '#N/A': 0x2a };
  function numFmtCode(st) {
    const d = st.dec ?? 2;
    const dec = d ? '.' + '0'.repeat(d) : '';
    return {
      number: `#,##0${dec}`, currency: `"$"#,##0${dec}`, accounting: `_("$"* #,##0${dec}_)`, percent: `0${st.dec !== undefined ? dec : '.00'}%`,
      date: 'yyyy-mm-dd', longdate: 'dddd, mmmm d, yyyy', datetime: 'yyyy-mm-dd hh:mm', time: 'hh:mm:ss', scientific: `0${dec}E+00`, text: '@',
    }[st.fmt];
  }
  function saveXlsx() {
    if (!window.XLSX) return msg('The .xlsx writer could not be loaded. Reload the page, or use Export CSV.');
    const out = XLSX.utils.book_new();
    S.wb.sheets.forEach((sh, si) => {
      const ws = {};
      let maxR = 0, maxC = 0;
      for (const [k, cell] of sh.cells) {
        if (cell.input === '') continue;
        const [r, c] = k.split(',').map(Number);
        maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
        const v = S.wb.getValue(si, r, c);
        const o = {};
        if (typeof v === 'number') { o.t = 'n'; o.v = v; }
        else if (typeof v === 'boolean') { o.t = 'b'; o.v = v; }
        else if (XL.isErr(v)) { o.t = 'e'; o.v = ERR_CODES[v.code] ?? 0x2a; o.w = v.code; }
        else { o.t = 's'; o.v = v === null ? '' : String(v); }
        if (cell.formula) o.f = cell.input.slice(1);
        const z = cell.style && numFmtCode(cell.style);
        if (z) o.z = z;
        ws[XLSX.utils.encode_cell({ r, c })] = o;
      }
      for (const m of sh.merges) { maxR = Math.max(maxR, m.r2); maxC = Math.max(maxC, m.c2); }
      if (sh.merges.length) ws['!merges'] = sh.merges.map((m) => ({ s: { r: m.r1, c: m.c1 }, e: { r: m.r2, c: m.c2 } }));
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
      ws['!cols'] = Array.from({ length: maxC + 1 }, (_, c) => ({ wpx: sh.colWidths[c] || DEFAULT_W }));
      XLSX.utils.book_append_sheet(out, ws, sh.name);
    });
    XLSX.writeFile(out, `${S.docName}.xlsx`);
    saveNow();
  }
  function fmtFromCode(z) {
    if (!z || z === 'General') return null;
    const plain = z.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    const dec = (/\.(0+)/.exec(plain) || [, ''])[1].length;
    if (/[yd]/i.test(plain) && !/[0#]/.test(plain)) return { fmt: /h/i.test(plain) ? 'datetime' : 'date' };
    if (/h/i.test(plain) && !/[0#]/.test(plain)) return { fmt: 'time' };
    if (plain.includes('%')) return { fmt: 'percent', dec };
    if (/E\+/i.test(plain)) return { fmt: 'scientific', dec };
    if (z.includes('$')) return { fmt: /_\(|\* /.test(z) ? 'accounting' : 'currency', dec };
    if (plain.includes(',')) return { fmt: 'number', dec };
    if (plain === '@') return { fmt: 'text' };
    if (/^0(\.0+)?$/.test(plain)) return { fmt: 'general', dec };
    return null;
  }
  function fromXlsx(xwb) {
    const wb = new XL.Workbook();
    xwb.SheetNames.forEach((name) => {
      const ws = xwb.Sheets[name];
      const sh = wb.addSheet(name);
      const si = wb.sheets.length - 1;
      if (!ws['!ref']) return;
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let r = range.s.r; r <= Math.min(range.e.r, 50000); r++) {
        for (let c = range.s.c; c <= Math.min(range.e.c, 500); c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell) continue;
          let input;
          if (cell.f) input = '=' + cell.f;
          else if (cell.t === 'n') input = String(cell.v);
          else if (cell.t === 'b') input = cell.v ? 'TRUE' : 'FALSE';
          else if (cell.t === 'e') input = cell.w || '#N/A';
          else input = String(cell.v ?? '');
          if (cell.t === 's' && (input.startsWith('=') || typeof XL.parseLiteral(input).value !== 'string')) input = "'" + input;
          const res = wb.setInput(si, r, c, input);
          if (!res.ok) wb.setInput(si, r, c, "'" + (cell.w ?? String(cell.v ?? '')));
          const f = fmtFromCode(cell.z);
          if (f) wb.setStyle(si, r, c, f);
        }
      }
      sh.merges = (ws['!merges'] || []).map((m) => ({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c }));
      (ws['!cols'] || []).forEach((col, i) => { if (col && (col.wpx || col.wch)) sh.colWidths[i] = Math.round(col.wpx || col.wch * 7 + 5); });
    });
    if (!wb.sheets.length) wb.addSheet('Sheet1');
    wb.recalc();
    return wb;
  }
  async function openFile(file) {
    const base = file.name.replace(/\.[^.]+$/, '');
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      let wb;
      if (ext === 'csv' || ext === 'txt') {
        wb = new XL.Workbook();
        wb.addSheet(base.slice(0, 31).replace(/[\\/?*[\]:]/g, '_') || 'Sheet1');
        const rows = parseDelimited(await file.text(), ext === 'txt' ? '\t' : ',');
        rows.forEach((row, r) => row.forEach((v, c) => { if (v !== '') wb.setInput(0, r, c, v); }));
      } else {
        if (!window.XLSX) return msg('The .xlsx reader could not be loaded. Reload the page and try again.');
        wb = fromXlsx(XLSX.read(await file.arrayBuffer(), { cellFormula: true, cellNF: true, cellStyles: true }));
      }
      pushUndo();
      S.wb = wb;
      S.si = 0;
      S.sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
      S.docName = base;
      S.clip = null;
      rebuild();
      fitNumbers(0, S.cols - 1, 0, sheet().extent().rows - 1);
      updateSelection();
    } catch (e) {
      msg(`Cannot open "${file.name}". The file may be damaged or in an unsupported format.\n\n${e.message}`);
    }
  }
  function newWorkbook() {
    const go = () => {
      pushUndo();
      S.wb = new XL.Workbook();
      S.wb.addSheet('Sheet1');
      S.si = 0; S.sel = { ar: 0, ac: 0, fr: 0, fc: 0 }; S.clip = null;
      let n = 1;
      S.docName = 'Book' + n;
      rebuild();
    };
    const hasData = S.wb.sheets.some((s) => s.cells.size);
    if (hasData) confirmBox('Start a new workbook? The current one is replaced in this browser. You can undo with ⌘Z.', go);
    else go();
  }

  // ------------------------------------------------------------ command table
  const CMD = {
    save: () => { saveNow(); const t = $('.doc-title .muted'); t.textContent = ' — Saved'; setTimeout(() => { t.textContent = ' — Saved to this browser'; }, 1500); },
    undo, redo,
    new: newWorkbook,
    open: () => $('#fileInput').click(),
    saveXlsx, exportCsv,
    print: () => window.print(),
    paste: () => {
      if (S.clip) return pasteInternal();
      if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(pasteText, () => msg('Use ⌘V to paste from other apps.'));
    },
    cut: () => { const t = copySel(true); if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); },
    copy: () => { const t = copySel(false); if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); },
    formatPainter: () => { S.painter = S.painter ? null : { ...activeStyle() }; updateRibbonState(); },
    growFont: () => fontSizeStep(1),
    shrinkFont: () => fontSizeStep(-1),
    bold: () => toggleStyle('bold'),
    italic: () => toggleStyle('italic'),
    underline: () => toggleStyle('underline'),
    strike: () => toggleStyle('strike'),
    borders: () => applyStyle({ border: true }),
    noBorders: () => applyStyle({ border: undefined }),
    applyFill: () => applyStyle({ fill: $('#fillColor').value }),
    applyFontColor: () => applyStyle({ color: $('#fontColor').value }),
    valignTop: () => applyStyle({ valign: 'top' }),
    valignMiddle: () => applyStyle({ valign: 'middle' }),
    valignBottom: () => applyStyle({ valign: undefined }),
    wrap: () => toggleStyle('wrap'),
    mergeCenter: () => mergeSel('center'),
    mergeAcross: () => mergeSel('across'),
    mergeCells: () => mergeSel('merge'),
    unmergeCells: () => unmergeSel(),
    centerAcross: () => applyStyle({ align: 'centerAcross' }),
    rotCCW: () => toggleValue('rot', 45),
    rotCW: () => toggleValue('rot', -45),
    rotVertical: () => toggleValue('rot', 'v'),
    rotUp: () => toggleValue('rot', 90),
    rotDown: () => toggleValue('rot', -90),
    alignLeft: () => toggleValue('align', 'left'),
    alignCenter: () => toggleValue('align', 'center'),
    alignRight: () => toggleValue('align', 'right'),
    indent: () => applyStyle({ indent: Math.min((activeStyle().indent || 0) + 1, 15), align: activeStyle().align === 'right' ? undefined : activeStyle().align }),
    outdent: () => applyStyle({ indent: Math.max((activeStyle().indent || 0) - 1, 0) || undefined }),
    fmtCurrency: () => applyStyle({ fmt: 'accounting', dec: undefined }),
    fmtPercent: () => applyStyle({ fmt: 'percent', dec: 0 }),
    fmtComma: () => applyStyle({ fmt: 'number', dec: 2 }),
    incDecimal: () => adjustDecimals(1),
    decDecimal: () => adjustDecimals(-1),
    insertRow: () => insertCells('row', false),
    insertCol: () => insertCells('col', false),
    deleteRow: () => insertCells('row', true),
    deleteCol: () => insertCells('col', true),
    newSheet,
    deleteSheet: () => deleteSheet(),
    autoSum,
    fillDown: () => fillFromEdge(true),
    clearAll: () => clearCells(true, true),
    clearFormats: () => clearCells(false, true),
    newCellStyle: () => openStyleDialog('new'),
    clearContents: () => clearCells(true, false),
    sortAsc: () => sortData(false),
    sortDesc: () => sortData(true),
    find: () => { $('#searchBox').focus(); $('#searchBox').select(); },
    chartColumn: () => addChart('column'),
    chartLine: () => addChart('line'),
    insertFunction: () => openFnDialog(),
    insertToday: () => {
      if (S.editing && !commitEdit()) return;
      if (guard()) return;
      pushUndo();
      const d = new Date();
      S.wb.setInput(S.si, S.sel.ar, S.sel.ac, `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
      changed();
    },
    orientation: () => {
      const landscape = !document.getElementById('pageStyle');
      if (landscape) { const s = document.createElement('style'); s.id = 'pageStyle'; s.textContent = '@page { size: landscape; }'; document.head.appendChild(s); }
      else document.getElementById('pageStyle').remove();
      $('#orientBtn').lastChild.textContent = landscape ? 'Landscape' : 'Portrait';
    },
    printGridlines: () => { view().printGridlines = !view().printGridlines; applyViewOptions(); scheduleSave(); },
    showFormulas: () => { S.showFormulas = !S.showFormulas; renderAll(); updateRibbonState(); },
    calcNow: () => { S.wb.recalc(); changed(); },
    removeDuplicates,
    stats: showStats,
    protect: () => { view().protected = !view().protected; updateRibbonState(); scheduleSave(); },
    freezeRow: () => { view().freezeRow = !view().freezeRow; renderAll(); updateSelection(); scheduleSave(); },
    freezeCol: () => { view().freezeCol = !view().freezeCol; renderAll(); updateSelection(); scheduleSave(); },
    zoomIn: () => setZoom(S.zoom + 10),
    zoomOut: () => setZoom(S.zoom - 10),
    zoom100: () => setZoom(100),
    prevSheet: () => switchSheet(S.si - 1),
    nextSheet: () => switchSheet(S.si + 1),
  };
  function clearCells(contents, formats) {
    if (S.editing && !commitEdit()) return;
    if (guard()) return;
    pushUndo();
    if (formats) { const rect = selRect(); sheet().merges = sheet().merges.filter((m) => !overlaps(m, rect)); }
    forSel((r, c) => {
      if (formats) S.wb.setStyle(S.si, r, c, null, true);
      if (contents) S.wb.setInput(S.si, r, c, '');
    });
    changed();
  }

  // ------------------------------------------------------------ events: ribbon
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
  }));
  // A click toggles the flyout; the second click of a double-click keeps it open.
  titleBtn.addEventListener('click', (e) => {
    if (flyout.hidden) openFlyout();
    else if (e.detail < 2) closeFlyout();
    else { flyName.focus(); flyName.select(); }
  });
  flyName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (commitName()) closeFlyout(); } });
  // Once an error shows, clear it as soon as the name becomes valid.
  flyName.addEventListener('input', () => { if (!flyErr.hidden) showNameError(nameError(flyName.value.trim())); });
  // Leaving the field renames; a rejected name reverts.
  flyName.addEventListener('blur', () => { if (!commitName()) { flyName.value = S.docName; showNameError(''); } });
  flyout.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); flyName.value = S.docName; closeFlyout(); } });
  flyout.addEventListener('click', (e) => { if (e.target.closest('[data-cmd]')) closeFlyout(false); });
  document.addEventListener('mousedown', (e) => { if (!flyout.hidden && !e.target.closest('.doc-title')) closeFlyout(false); });
  // Keep keyboard focus on the grid/editor when using ribbon buttons.
  document.querySelector('.ribbon').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  // Pinned menus would drift from their button, so close them when the ribbon scrolls or the window resizes.
  document.querySelector('.ribbon').addEventListener('scroll', closeMenus);
  window.addEventListener('resize', closeMenus);
  document.addEventListener('click', (e) => {
    const menuBtn = e.target.closest('[data-menu]');
    if (menuBtn) {
      const m = document.getElementById(menuBtn.dataset.menu);
      const open = !m.classList.contains('open');
      closeMenus();
      if (open && m.id === 'cellStyles') renderGallery();
      m.classList.toggle('open', open);
      // The ribbon scrolls sideways, which clips anything below it; pin ribbon menus to the viewport under their button.
      if (open && m.closest('.ribbon')) {
        const b = menuBtn.getBoundingClientRect();
        m.classList.add('pinned');
        m.style.top = b.bottom + 'px';
        m.style.left = Math.max(8, Math.min(b.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
        if (m.id === 'cellStyles') m.style.maxHeight = `${window.innerHeight - b.bottom - 8}px`;
      }
      return;
    }
    if (!e.target.closest('.ctx-menu')) hideCtx();
    const styleBtn = e.target.closest('[data-style]');
    if (styleBtn) { closeMenus(); applyCellStyle(styleBtn.dataset.style); return; }
    const catBtn = e.target.closest('[data-fncat]');
    if (catBtn) { closeMenus(); openFnDialog(catBtn.dataset.fncat); return; }
    const cmd = e.target.closest('[data-cmd]');
    closeMenus();
    if (cmd && CMD[cmd.dataset.cmd]) {
      const keepEditing = ['insertFunction', 'undo', 'redo'].includes(cmd.dataset.cmd);
      if (S.editing && !keepEditing && !commitEdit()) return;
      CMD[cmd.dataset.cmd]();
      if (!S.editing && !isTextField(document.activeElement) && !document.querySelector('dialog[open]')) focusGrid();
    }
    const close = e.target.closest('[data-close-chart]');
    if (close) {
      pushUndo();
      view().charts.splice(+close.dataset.closeChart, 1);
      changed();
    }
  });
  const gallery = $('#cellStyles');
  const previewFrom = (e) => { const t = e.target.closest('[data-style]'); if (t) startPreview(t.dataset.style); else endPreview(); };
  gallery.addEventListener('mouseover', previewFrom);
  gallery.addEventListener('focusin', previewFrom);
  gallery.addEventListener('mouseleave', () => endPreview());
  gallery.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('[data-style]');
    if (!t) return;
    e.preventDefault();
    const key = t.dataset.style, custom = key.startsWith('c:');
    const items = [{ label: 'Apply', run: () => { closeMenus(); applyCellStyle(key); } }];
    if (custom) items.push({ label: 'Modify…', run: () => { closeMenus(); openStyleDialog('modify', key); } });
    items.push({ label: 'Duplicate…', run: () => { closeMenus(); openStyleDialog('duplicate', key); } });
    if (custom) items.push({ label: 'Delete', run: () => { closeMenus(); deleteCustomStyle(key); } });
    showCtx(e.clientX, e.clientY, items);
  });
  $('#csOk').addEventListener('click', (e) => {
    const err = styleDialogError();
    $('#csErr').textContent = err;
    $('#csErr').hidden = !err;
    if (err) { e.preventDefault(); $('#csName').focus(); }
  });
  $('#csName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#csOk').click(); } });

  $('#fontFamily').addEventListener('change', (e) => applyStyle({ font: e.target.value === 'Aptos Narrow' ? undefined : e.target.value }));
  $('#fontSize').addEventListener('change', (e) => applyStyle({ size: +e.target.value === 11 ? undefined : +e.target.value }));
  $('#numFmt').addEventListener('change', (e) => applyStyle({ fmt: e.target.value === 'general' ? undefined : e.target.value, dec: undefined }));
  $('#fillColor').addEventListener('input', (e) => { $('#fillSwatch').style.background = e.target.value; });
  $('#fillColor').addEventListener('change', (e) => applyStyle({ fill: e.target.value }));
  $('#fontColor').addEventListener('input', (e) => { $('#fontSwatch').style.background = e.target.value; });
  $('#fontColor').addEventListener('change', (e) => applyStyle({ color: e.target.value }));
  $('#optGridlines').addEventListener('change', (e) => { view().gridlines = e.target.checked; applyViewOptions(); scheduleSave(); });
  $('#optHeadings').addEventListener('change', (e) => { view().headings = e.target.checked; applyViewOptions(); updateSelection(); scheduleSave(); });
  $('#optFormulaBar').addEventListener('change', (e) => { $('#formulaRow').style.display = e.target.checked ? '' : 'none'; });
  $('#zoomSlider').addEventListener('input', (e) => setZoom(+e.target.value));
  $('#fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); });

  // Insert Function dialog
  $('#fnSearch').addEventListener('input', renderFnList);
  $('#fnCategory').addEventListener('change', renderFnList);
  $('#fnList').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) { fnSelected = li.dataset.fn; renderFnList(); } });
  $('#fnList').addEventListener('dblclick', (e) => { const li = e.target.closest('li'); if (li) { fnSelected = li.dataset.fn; $('#fnDialog').close('ok'); } });
  $('#fxInsert').addEventListener('click', () => openFnDialog());
  $('#fxCancel').addEventListener('click', () => cancelEdit());
  $('#fxEnter').addEventListener('click', () => commitEdit());

  // ------------------------------------------------------------ events: name box, formula bar, search
  nameBox.addEventListener('focus', () => nameBox.select());
  nameBox.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { nameBox.blur(); updateSelection(); focusGrid(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    let text = nameBox.value.trim();
    let target = S.si;
    const bang = text.lastIndexOf('!');
    if (bang > 0) { target = S.wb.sheetIndex(text.slice(0, bang).replace(/^'|'$/g, '')); text = text.slice(bang + 1); }
    const rg = XL.parseRangeAddr(text);
    if (!rg || target < 0 || rg.r2 >= MAX_ROWS || rg.c2 >= MAX_COLS) { msg('The reference isn\'t valid. Type a cell such as C10 or a range such as A1:D20.'); return; }
    if (target !== S.si) switchSheet(target);
    ensureSize(rg.r2, rg.c2);
    nameBox.blur();
    setSel(rg.r1, rg.c1, rg.r2, rg.c2);
    ensureVisible(rg.r1, rg.c1);
    focusGrid();
  });
  bar.addEventListener('focus', () => {
    if (!S.editing) startEdit('edit', undefined, 'bar');
    else S.editing.src = 'bar';
  });
  editor.addEventListener('focus', () => { if (S.editing) S.editing.src = 'cell'; });
  for (const el of [editor, bar]) {
    el.addEventListener('input', () => onEditInput());
    el.addEventListener('keydown', onEditKey);
    el.addEventListener('click', () => { if (S.editing) { S.editing.point = null; updateAutocomplete(); setMode(); } });
  }
  acBox.addEventListener('mousedown', (e) => { e.preventDefault(); const d = e.target.closest('[data-i]'); if (d) acceptAC(+d.dataset.i); });
  $('#searchBox').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findNext(e.target.value); }
    if (e.key === 'Escape') { e.target.value = ''; focusGrid(); }
  });

  // ------------------------------------------------------------ events: grid mouse
  const cellOf = (td) => ({ r: td.parentElement.sectionRowIndex, c: td.cellIndex - 1 });

  gridInner.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    hideCtx();
    closeMenus();
    const chartHead = e.target.closest('[data-chart]');
    if (chartHead && !e.target.closest('button')) {
      const ch = view().charts[+chartHead.dataset.chart];
      S.drag = { type: 'chart', ch, el: chartHead.parentElement, x: e.clientX, y: e.clientY, ox: ch.x, oy: ch.y };
      e.preventDefault();
      return;
    }
    if (e.target.closest('.chart')) return;
    if (e.target === $('#fillHandle')) {
      if (S.editing && !commitEdit()) return;
      S.drag = { type: 'fill', src: selRect(), dir: null, count: 0 };
      e.preventDefault();
      return;
    }
    const resizer = e.target.closest('.col-resizer');
    if (resizer) {
      const c = +resizer.dataset.c;
      S.drag = { type: 'colresize', c, x: e.clientX, w: colWidth(c) };
      e.preventDefault();
      return;
    }
    const th = e.target.closest('th');
    const td = e.target.closest('td');
    if (S.editing && (td || th) && pointable() && S.editing.si === S.si) {
      e.preventDefault();
      if (td) { const { r, c } = cellOf(td); pointTo(r, c); S.drag = { type: 'point', r, c }; }
      return;
    }
    if (S.editing && e.target !== editor && !commitEdit()) { e.preventDefault(); return; }
    if (e.target === editor) return;
    if (th) {
      e.preventDefault();
      if (th.classList.contains('corner')) { setSel(0, 0, S.rows - 1, S.cols - 1); focusGrid(); return; }
      if (th.parentElement.parentElement === thead) {
        const c = th.cellIndex - 1;
        if (e.shiftKey) setSel(0, S.sel.ac, S.rows - 1, c); else setSel(0, c, S.rows - 1, c);
        S.drag = { type: 'cols', c: e.shiftKey ? S.sel.ac : c };
      } else {
        const r = th.parentElement.sectionRowIndex;
        if (e.shiftKey) setSel(S.sel.ar, 0, r, S.cols - 1); else setSel(r, 0, r, S.cols - 1);
        S.drag = { type: 'rows', r: e.shiftKey ? S.sel.ar : r };
      }
      focusGrid();
      return;
    }
    if (!td) return;
    e.preventDefault();
    const { r, c } = cellOf(td);
    if (e.shiftKey) { S.sel.fr = r; S.sel.fc = c; } else S.sel = { ar: r, ac: c, fr: r, fc: c };
    S.tabStartCol = null;
    S.drag = { type: 'select' };
    updateSelection();
    focusGrid();
  });

  document.addEventListener('mousemove', (e) => {
    const d = S.drag;
    if (!d) return;
    if (d.type === 'colresize') {
      const w = Math.max(8, Math.round(d.w + (e.clientX - d.x) / (S.zoom / 100)));
      grid.querySelector('colgroup').children[d.c + 1].style.width = w + 'px';
      sheet().colWidths[d.c] = w;
      updateTableWidth();
      updateSelection();
      return;
    }
    if (d.type === 'chart') {
      d.ch.x = Math.max(0, d.ox + (e.clientX - d.x) / (S.zoom / 100));
      d.ch.y = Math.max(0, d.oy + (e.clientY - d.y) / (S.zoom / 100));
      d.el.style.left = d.ch.x + 'px';
      d.el.style.top = d.ch.y + 'px';
      return;
    }
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const td = hit && hit.closest && hit.closest('#grid td');
    const th = hit && hit.closest && hit.closest('#grid th');
    if (d.type === 'cols' && th && th.parentElement.parentElement === thead && th.cellIndex > 0) { S.sel.fc = th.cellIndex - 1; updateSelection(); return; }
    if (d.type === 'rows' && th && th.parentElement.parentElement === tbody) { S.sel.fr = th.parentElement.sectionRowIndex; updateSelection(); return; }
    if (!td) return;
    const { r, c } = cellOf(td);
    if (d.type === 'select') { if (S.sel.fr !== r || S.sel.fc !== c) { S.sel.fr = r; S.sel.fc = c; updateSelection(); } }
    else if (d.type === 'point') pointTo(d.r, d.c, r, c);
    else if (d.type === 'fill') {
      const s = d.src;
      const down = r - s.r2, up = s.r1 - r, right = c - s.c2, left = s.c1 - c;
      const best = Math.max(down, up, right, left);
      if (best <= 0) { d.dir = null; fillPreview.style.display = 'none'; return; }
      d.dir = best === down ? 'down' : best === up ? 'up' : best === right ? 'right' : 'left';
      d.count = best;
      const t = { ...s };
      if (d.dir === 'down') t.r2 = r; else if (d.dir === 'up') t.r1 = r; else if (d.dir === 'right') t.c2 = c; else t.c1 = c;
      place(fillPreview, boxFor(t.r1, t.c1, t.r2, t.c2));
    }
    // Auto-scroll while dragging near the edges.
    const rect = gridWrap.getBoundingClientRect();
    if (e.clientY > rect.bottom - 20) gridWrap.scrollTop += 20;
    if (e.clientX > rect.right - 20) gridWrap.scrollLeft += 20;
  });

  document.addEventListener('mouseup', () => {
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    if (d.type === 'fill') {
      fillPreview.style.display = 'none';
      if (d.dir) performFill(d.src, d.dir, d.count);
    } else if (d.type === 'colresize' || d.type === 'chart') {
      scheduleSave();
    } else if (d.type === 'select' || d.type === 'cols' || d.type === 'rows') {
      if (S.painter) {
        const st = S.painter;
        S.painter = null;
        if (!guard()) { pushUndo(); forSel((r, c) => S.wb.setStyle(S.si, r, c, Object.keys(st).length ? { ...st } : null, true)); changed(); }
      }
      updateSelection();
    }
  });

  gridInner.addEventListener('dblclick', (e) => {
    const resizer = e.target.closest('.col-resizer');
    if (resizer) { autofitColumn(+resizer.dataset.c); return; }
    const td = e.target.closest('td');
    if (td && !S.editing) startEdit('edit');
  });
  function autofitColumn(c) {
    const ctx = document.createElement('canvas').getContext('2d');
    let w = 20;
    const ext = sheet().extent();
    for (let r = 0; r < ext.rows; r++) {
      const cell = sheet().get(r, c);
      if (!cell || cell.input === '') continue;
      const st = cell.style || {};
      ctx.font = `${st.bold ? '700 ' : ''}${st.size || 11}pt ${st.font ? `"${st.font}"` : getComputedStyle(grid).fontFamily}`;
      w = Math.max(w, ctx.measureText(XL.formatValue(valueAt(r, c), st)).width + 12);
    }
    pushUndo();
    sheet().colWidths[c] = Math.ceil(w);
    buildGrid();
    updateSelection();
    scheduleSave();
  }

  gridInner.addEventListener('contextmenu', (e) => {
    const td = e.target.closest('td'), th = e.target.closest('th');
    if (!td && !th) return;
    e.preventDefault();
    if (S.editing && !commitEdit()) return;
    const { r1, c1, r2, c2 } = selRect();
    if (td) {
      const { r, c } = cellOf(td);
      if (r < r1 || r > r2 || c < c1 || c > c2) setSel(r, c);
    }
    const isCols = th && th.parentElement.parentElement === thead;
    if (th && !th.classList.contains('corner')) {
      if (isCols) { const c = th.cellIndex - 1; if (c < c1 || c > c2 || r1 !== 0) setSel(0, c, S.rows - 1, c); }
      else { const r = th.parentElement.sectionRowIndex; if (r < r1 || r > r2 || c1 !== 0) setSel(r, 0, r, S.cols - 1); }
    }
    const items = [
      { label: 'Cut', run: CMD.cut }, { label: 'Copy', run: CMD.copy }, { label: 'Paste', run: CMD.paste }, '-',
    ];
    if (isCols) items.push({ label: 'Insert Columns', run: CMD.insertCol }, { label: 'Delete Columns', run: CMD.deleteCol }, { label: 'Column Width: Autofit', run: () => autofitColumn(S.sel.ac) });
    else items.push({ label: 'Insert Rows', run: CMD.insertRow }, { label: 'Delete Rows', run: CMD.deleteRow }, { label: 'Insert Columns', run: CMD.insertCol }, { label: 'Delete Columns', run: CMD.deleteCol });
    items.push({ label: 'Clear Contents', run: CMD.clearContents }, '-', { label: 'Sort A to Z', run: CMD.sortAsc }, { label: 'Sort Z to A', run: CMD.sortDesc }, '-', { label: 'Insert Function…', run: CMD.insertFunction });
    showCtx(e.clientX, e.clientY, items);
  });

  gridWrap.addEventListener('scroll', () => {
    if (view().freezeRow || view().freezeCol) placeMerges();
    if (gridWrap.scrollTop + gridWrap.clientHeight > gridWrap.scrollHeight - 300 && S.rows < MAX_ROWS) appendRows(100);
    if (gridWrap.scrollLeft + gridWrap.clientWidth > gridWrap.scrollWidth - 200 && S.cols < MAX_COLS) {
      const left = gridWrap.scrollLeft;
      S.cols = Math.min(MAX_COLS, S.cols + 10);
      buildGrid();
      updateSelection();
      gridWrap.scrollLeft = left;
    }
    if (S.editing) { hideAC(); fnTip.style.display = 'none'; }
  });

  // ------------------------------------------------------------ events: sheet tabs
  const tabs = $('#sheetTabs');
  tabs.addEventListener('click', (e) => { const t = e.target.closest('[data-si]'); if (t && !t.querySelector('input')) { switchSheet(+t.dataset.si); focusGrid(); } });
  tabs.addEventListener('dblclick', (e) => { const t = e.target.closest('[data-si]'); if (t) renameSheetInline(+t.dataset.si); });
  tabs.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('[data-si]');
    if (!t) return;
    e.preventDefault();
    const i = +t.dataset.si;
    switchSheet(i);
    showCtx(e.clientX, e.clientY, [
      { label: 'Insert Sheet', run: newSheet },
      { label: 'Delete', run: () => deleteSheet(i) },
      { label: 'Rename', run: () => renameSheetInline(i) },
      { label: 'Duplicate', run: () => {
        pushUndo();
        const copy = XL.Workbook.fromJSON({ sheets: [S.wb.toJSON().sheets[i]] }).sheets[0];
        let n = 2;
        while (S.wb.sheetIndex(`${copy.name} (${n})`) >= 0) n++;
        copy.name = `${copy.name} (${n})`;
        S.wb.sheets.splice(i + 1, 0, copy);
        S.wb.recalc();
        switchSheet(i + 1);
        scheduleSave();
      } },
    ]);
  });
  let dragTab = null;
  tabs.addEventListener('dragstart', (e) => { dragTab = +e.target.dataset.si; });
  tabs.addEventListener('dragover', (e) => e.preventDefault());
  tabs.addEventListener('drop', (e) => {
    e.preventDefault();
    const t = e.target.closest('[data-si]');
    if (!t || dragTab === null) return;
    const to = +t.dataset.si;
    if (to === dragTab) return;
    pushUndo();
    const [moved] = S.wb.sheets.splice(dragTab, 1);
    S.wb.sheets.splice(to, 0, moved);
    S.wb.recalc();
    S.si = to;
    renderTabs();
    changed();
    dragTab = null;
  });

  // ------------------------------------------------------------ events: keyboard & clipboard
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (S.editing) commitEdit(); CMD.save(); return; }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); CMD.find(); return; }
    // Keys typed into the cell editor or formula bar are handled by onEditKey.
    if (S.editing || e.target === editor || e.target === bar || isTextField(document.activeElement)) return;
    if (ctxMenu.style.display === 'block' && e.key === 'Escape') { hideCtx(); return; }
    if (e.key === 'Escape' && document.querySelector('.menu.open')) { closeMenus(); focusGrid(); return; }
    const k = e.key;
    if (mod) {
      const lower = k.toLowerCase();
      const map = {
        b: CMD.bold, i: CMD.italic, u: CMD.underline, d: () => fillFromEdge(true), r: () => fillFromEdge(false),
        a: () => setSel(0, 0, S.rows - 1, S.cols - 1), y: redo, '`': CMD.showFormulas,
      };
      if (lower === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (map[lower]) { e.preventDefault(); map[lower](); return; }
    }
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) { e.preventDefault(); move(...arrows[k], e.shiftKey, mod); return; }
    switch (k) {
      case 'Enter': case 'Tab': e.preventDefault(); navKey(k, e.shiftKey); return;
      case 'Home': e.preventDefault(); if (mod) { setSel(0, 0); ensureVisible(0, 0); } else { setSel(S.sel.ar, 0); ensureVisible(S.sel.ar, 0); } return;
      case 'PageDown': e.preventDefault(); move(Math.floor(gridWrap.clientHeight / 22), 0, e.shiftKey); return;
      case 'PageUp': e.preventDefault(); move(-Math.floor(gridWrap.clientHeight / 22), 0, e.shiftKey); return;
      case 'F2': e.preventDefault(); startEdit('edit'); return;
      case 'Delete': case 'Backspace': e.preventDefault(); CMD.clearContents(); return;
      case 'Escape': if (S.clip) { S.clip = null; updateSelection(); } if (S.painter) { S.painter = null; updateRibbonState(); } return;
      default: break;
    }
    if (k === '=' && e.altKey) { e.preventDefault(); autoSum(); return; }
    if (k.length === 1 && !mod) {
      e.preventDefault();
      startEdit('enter', k);
    }
  });
  document.addEventListener('copy', (e) => {
    if (S.editing || isTextField(document.activeElement)) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', copySel(false));
  });
  document.addEventListener('cut', (e) => {
    if (S.editing || isTextField(document.activeElement)) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', copySel(true));
  });
  document.addEventListener('paste', (e) => {
    if (S.editing || isTextField(document.activeElement)) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  });
  window.addEventListener('beforeunload', saveNow);
  window.addEventListener('resize', () => { if (S.editing) positionEditor(); });

  // ------------------------------------------------------------ boot
  load();
  rebuild();
  ensureVisible(S.sel.ar, S.sel.ac);
  focusGrid();
  // Exposed for debugging in the console.
  window.SpreadsheetApp = { S, CMD };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
