// The My hums panel on the Hum section: your earlier hums, newest first. Tap one to
// open it as you left it; ⋯ to rename it, save it as a file, or delete it.
// The panel only lists and asks; app.js opens, saves and deletes (see hum-store.js).

import { listHums, storeAvailable } from './hum-store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SHOWN = 5; // hums listed before "Show all"

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return today ? `Today ${time}` : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const length = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * @param {object} o
 * @param {() => string|null} o.current       id of the hum that's open
 * @param {(id: string) => void} o.onOpen
 * @param {(id: string, name: string) => Promise} o.onRename
 * @param {(id: string) => void} o.onSaveFile
 * @param {(id: string) => Promise} o.onDelete
 * @param {boolean} [o.files]  offer Save as file (not where downloads are blocked)
 */
export function createMyHums({ current, onOpen, onRename, onSaveFile, onDelete, files = true }) {
  const box = $('my-hums'), list = $('hum-list'), more = $('hum-more');
  let hums = [];
  let open = null;     // the hum whose actions are showing
  let asking = null;   // 'rename' or 'delete', for that hum
  let all = false;
  let usable = true;

  function draw() {
    box.hidden = usable && !hums.length;
    $('hum-none').hidden = usable;
    $('hum-count').textContent = hums.length ? String(hums.length) : '';
    const cur = current();
    const shown = all ? hums : hums.slice(0, SHOWN);
    list.innerHTML = shown.map((h) => {
      const on = h.id === cur;
      const sub = [when(h.createdAt), h.duration ? length(h.duration) : '', h.summary].filter(Boolean).join(' · ');
      let acts = '';
      if (open === h.id && asking === 'rename') {
        acts = `<form class="hum-rename" data-id="${h.id}">
          <input type="text" name="name" value="${esc(h.name)}" maxlength="60" autocomplete="off" enterkeyhint="done" aria-label="New name">
          <button type="submit" class="primary">Save</button><button type="button" data-act="cancel">Cancel</button></form>`;
      } else if (open === h.id && asking === 'delete') {
        acts = `<div class="hum-acts ask"><span>Delete this hum and its recording? This can't be undone.</span>
          <button type="button" class="danger" data-act="delete-yes">Delete</button><button type="button" data-act="cancel">Keep it</button></div>`;
      } else if (open === h.id) {
        acts = `<div class="hum-acts">
          <button type="button" data-act="rename">Rename</button>
          ${files ? '<button type="button" data-act="file">Save as file</button>' : ''}
          <button type="button" data-act="delete">Delete</button></div>`;
      }
      return `<li class="hum${on ? ' on' : ''}" data-id="${h.id}">
        <div class="hum-row">
          <button type="button" class="hum-open" data-act="open" aria-current="${on}">
            <b>${esc(h.name)}${on ? '<i>open</i>' : ''}</b><span>${esc(sub)}</span></button>
          <button type="button" class="hum-more" data-act="more" aria-expanded="${open === h.id}" aria-label="More for ${esc(h.name)}">⋯</button>
        </div>${acts}</li>`;
    }).join('');
    more.hidden = hums.length <= SHOWN;
    more.textContent = all ? 'Show fewer' : `Show all ${hums.length}`;
    if (asking === 'rename') list.querySelector('.hum-rename input')?.select();
  }

  async function refresh() {
    try {
      hums = await listHums();
      usable = true;
    } catch {
      hums = [];
      usable = await storeAvailable();
    }
    if (open && !hums.some((h) => h.id === open)) { open = null; asking = null; }
    draw();
  }

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    const id = b?.closest('li')?.dataset.id;
    if (!b || !id) return;
    const act = b.dataset.act;
    if (act === 'open') { open = null; asking = null; onOpen(id); return; }
    if (act === 'more') { open = open === id ? null : id; asking = null; }
    else if (act === 'rename' || act === 'delete') asking = act;
    else if (act === 'cancel') asking = null;
    else if (act === 'file') { onSaveFile(id); return; }
    else if (act === 'delete-yes') { open = null; asking = null; await onDelete(id); return; }
    draw();
  });
  list.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.elements.name.value.trim();
    const id = e.target.dataset.id;
    open = null;
    asking = null;
    if (name) await onRename(id, name.slice(0, 60));
    else draw();
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && asking) { asking = null; draw(); }
  });
  more.addEventListener('click', () => { all = !all; draw(); });

  return {
    refresh,
    draw,
    get count() { return hums.length; },
    get usable() { return usable; },
  };
}
