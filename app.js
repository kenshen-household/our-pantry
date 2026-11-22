/*
  Our Pantry — a small pantry tracker + cookbook for two.

  HOW IT WORKS
  - Everything lives in two JSON files in your GitHub repo:
      data/pantry.json   -> { items: [...], shopping: [...] }
      data/recipes.json  -> { recipes: [...] }
  - When you're connected (Settings tab), every change is saved straight to
    GitHub as a commit, so the other person sees it after a refresh.
  - When you're NOT connected, changes are saved in this browser only.

  The file is split into numbered sections so it's easy to find things.
*/

// ======================================================================
// 1. Small helpers
// ======================================================================
const $ = (selector) => document.querySelector(selector);

// Makes text safe to put inside HTML (so a recipe named "<b>" can't break the page).
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// A short random id for new items and recipes.
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const todayString = () => new Date().toISOString().slice(0, 10);

// Shows 1.5 as "1.5", 0.333333 as "0.33", and blanks as "".
function fmtQty(n) {
  if (n === null || n === undefined || n === '') return '';
  return String(Math.round(Number(n) * 100) / 100);
}

// Safe wrappers around the browser's localStorage.
function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ======================================================================
// 2. App data (what's currently on screen)
// ======================================================================
const FILES = { pantry: 'data/pantry.json', recipes: 'data/recipes.json' };
const EMPTY = {
  pantry: () => ({ items: [], shopping: [] }),
  recipes: () => ({ recipes: [] }),
};
const state = { pantry: EMPTY.pantry(), recipes: EMPTY.recipes() };

const LOCATIONS = ['Pantry', 'Fridge', 'Freezer', 'Spice rack', 'Other'];
const DEFAULT_CATEGORIES = ['Baking', 'Breakfast', 'Canned goods', 'Dairy', 'Drinks', 'Frozen',
  'Grains & pasta', 'Meat & fish', 'Oils & sauces', 'Produce', 'Snacks', 'Spices', 'Other'];

// Makes sure loaded data always has the expected shape.
function normalize(which, data) {
  return Object.assign(EMPTY[which](), data || {});
}

// ======================================================================
// 3. Settings (stored in this browser only — never committed)
// ======================================================================
const SETTINGS_KEY = 'our-pantry-settings';
const LOCAL_DATA_KEY = 'our-pantry-local-data';
let settings = readStorage(SETTINGS_KEY) || {};

const isConnected = () => Boolean(settings.owner && settings.repo && settings.token);
const branch = () => settings.branch || 'main';

function setStatus(message, kind = '') {
  const el = $('#sync-status');
  el.textContent = message;
  el.className = 'status ' + kind;
}

// ======================================================================
// 4. Talking to GitHub
//    Uses GitHub's "contents" API to read and write a file in the repo.
// ======================================================================
function ghUrl(path) {
  return `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/contents/${path}`;
}
function ghHeaders() {
  return {
    Authorization: `Bearer ${settings.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// GitHub sends file contents as base64. These two handle emoji/accents correctly.
function toBase64(text) {
  let binary = '';
  new TextEncoder().encode(text).forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
function fromBase64(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

async function ghError(res) {
  let msg = res.statusText;
  try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
  const hints = {
    401: 'The token is wrong or has expired.',
    403: 'The token is not allowed to change this repo (it needs Contents: Read and write).',
    404: 'Repo not found. Check the owner and name, and that the token can see this repo.',
  };
  const err = new Error(`GitHub error ${res.status}: ${msg}. ${hints[res.status] || ''}`);
  err.status = res.status;
  return err;
}

// Returns { data, sha }. "sha" is GitHub's version stamp, needed to save.
async function ghRead(path) {
  const res = await fetch(`${ghUrl(path)}?ref=${encodeURIComponent(branch())}`, {
    headers: ghHeaders(), cache: 'no-store',
  });
  if (res.status === 404) return { data: null, sha: undefined };
  if (!res.ok) throw await ghError(res);
  const json = await res.json();
  return { data: JSON.parse(fromBase64(json.content)), sha: json.sha };
}

async function ghWrite(path, data, sha, message) {
  const body = {
    message,
    content: toBase64(JSON.stringify(data, null, 2) + '\n'),
    branch: branch(),
  };
  if (sha) body.sha = sha;
  const res = await fetch(ghUrl(path), { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw await ghError(res);
}

// ======================================================================
// 5. Loading and saving
// ======================================================================
async function loadAll({ quiet = false } = {}) {
  if (isConnected()) {
    if (!quiet) setStatus('Loading from GitHub…');
    try {
      for (const which of ['pantry', 'recipes']) {
        const { data } = await ghRead(FILES[which]);
        if (data === null) {
          // File doesn't exist yet: create it from whatever is on screen now.
          await ghWrite(FILES[which], state[which], undefined, `Create ${FILES[which]}`);
        } else {
          state[which] = normalize(which, data);
        }
      }
      setStatus(`Synced with ${settings.owner}/${settings.repo} · ${new Date().toLocaleTimeString()}`, 'ok');
    } catch (e) {
      setStatus(e.message, 'error');
    }
  } else {
    const local = readStorage(LOCAL_DATA_KEY);
    if (local) {
      state.pantry = normalize('pantry', local.pantry);
      state.recipes = normalize('recipes', local.recipes);
    } else {
      // First visit: start from the sample files that ship with the app (if reachable).
      for (const which of ['pantry', 'recipes']) {
        try {
          const res = await fetch(FILES[which], { cache: 'no-store' });
          if (res.ok) state[which] = normalize(which, await res.json());
        } catch { /* opened straight from disk — start empty */ }
      }
    }
    setStatus('Not connected to GitHub — changes are saved on this device only. See Settings.', 'warn');
  }
  render();
}

/*
  change(which, message, mutate) is how EVERY edit happens.
  - which:   'pantry' or 'recipes'
  - message: a short description, becomes the commit message on GitHub
  - mutate:  a function that edits the data, e.g. (d) => d.items.push(newItem)

  The edit is shown right away. Then, if connected, we fetch the newest copy
  from GitHub, apply the same edit to it, and save. That way if your partner
  changed something a minute ago, their change isn't wiped out by yours.
*/
let saveQueue = Promise.resolve();
let pendingSaves = 0;

function change(which, message, mutate) {
  mutate(state[which]);
  render();

  if (!isConnected()) {
    writeStorage(LOCAL_DATA_KEY, { pantry: state.pantry, recipes: state.recipes });
    return;
  }
  pendingSaves++;
  saveQueue = saveQueue.then(() => pushChange(which, message, mutate));
}

async function pushChange(which, message, mutate) {
  setStatus('Saving…');
  const who = settings.name ? `${settings.name}: ` : '';
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data, sha } = await ghRead(FILES[which]);
        const fresh = normalize(which, data);
        mutate(fresh);
        await ghWrite(FILES[which], fresh, sha, who + message);
        // Only swap in GitHub's copy once nothing else is waiting to save.
        if (pendingSaves === 1) { state[which] = fresh; render(); }
        setStatus(`Saved ✓ ${new Date().toLocaleTimeString()}`, 'ok');
        return;
      } catch (e) {
        // 409/422 = someone saved at the exact same moment. Try again.
        if ((e.status === 409 || e.status === 422) && attempt < 3) continue;
        throw e;
      }
    }
  } catch (e) {
    setStatus('Save failed: ' + e.message, 'error');
    alert('Could not save to GitHub:\n\n' + e.message);
  } finally {
    pendingSaves--;
  }
}

// ======================================================================
// 6. Ingredients: reading "1 1/2 cup flour" and matching it to the pantry
// ======================================================================
const UNIT_ALIASES = {
  cup: 'cup', cups: 'cup', c: 'cup',
  tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g', kg: 'kg',
  ml: 'ml', l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  qt: 'qt', quart: 'qt', quarts: 'qt', pint: 'pint', pints: 'pint', gallon: 'gallon', gallons: 'gallon',
  can: 'can', cans: 'can', box: 'box', boxes: 'box', bag: 'bag', bags: 'bag',
  jar: 'jar', jars: 'jar', bottle: 'bottle', bottles: 'bottle',
  package: 'package', packages: 'package', pkg: 'package',
  clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice',
  stick: 'stick', sticks: 'stick', piece: 'piece', pieces: 'piece',
  bunch: 'bunch', head: 'head', heads: 'head', loaf: 'loaf', loaves: 'loaf',
  pinch: 'pinch', dash: 'dash',
};
const unitKey = (u) => {
  const k = String(u || '').toLowerCase().trim().replace(/\.$/, '');
  return UNIT_ALIASES[k] || k;
};

function parseNumber(token) {
  if (!token) return null;
  const fancy = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
  if (fancy[token] !== undefined) return fancy[token];
  if (/^\d+\/\d+$/.test(token)) {
    const [a, b] = token.split('/').map(Number);
    return b ? a / b : null;
  }
  if (/^\d*\.?\d+$/.test(token)) return Number(token);
  return null;
}

// "1 1/2 cup flour (optional)" -> { quantity: 1.5, unit: 'cup', name: 'flour', optional: true }
function parseIngredient(line) {
  let text = line.trim();
  let optional = false;
  if (/\(optional\)/i.test(text)) {
    optional = true;
    text = text.replace(/\(optional\)/gi, '').trim();
  }
  const tokens = text.split(/\s+/);
  let quantity = null;
  let unit = '';

  const first = parseNumber(tokens[0]);
  if (first !== null) {
    quantity = first;
    tokens.shift();
    const fraction = parseNumber(tokens[0]);
    if (fraction !== null && fraction < 1) { quantity += fraction; tokens.shift(); }
  }
  if (tokens.length > 1 && UNIT_ALIASES[tokens[0].toLowerCase().replace(/\.$/, '')]) {
    unit = unitKey(tokens.shift());
  }
  if (tokens.length > 1 && tokens[0].toLowerCase() === 'of') tokens.shift();
  return { quantity, unit, name: tokens.join(' '), optional };
}

function ingredientToLine(ing) {
  return [fmtQty(ing.quantity), ing.unit, ing.name].filter(Boolean).join(' ') + (ing.optional ? ' (optional)' : '');
}

// Turns names into a simple form so "Eggs", "egg" and "EGGS " all match.
function singular(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('oes') || word.endsWith('ches') || word.endsWith('shes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
function norm(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map(singular).join(' ');
}

// Finds the pantry item for an ingredient. "large eggs" matches "Eggs"; "rice" matches "Brown rice".
function findPantryItem(ingredientName) {
  const n = norm(ingredientName);
  if (!n) return null;
  const items = state.pantry.items;
  return items.find((i) => norm(i.name) === n)
    || items.find((i) => norm(i.name).endsWith(' ' + n))
    || items.find((i) => n.endsWith(' ' + norm(i.name)))
    || null;
}

// 'have' | 'short' (have some, not enough) | 'missing'
function ingredientStatus(ing) {
  const item = findPantryItem(ing.name);
  if (!item || Number(item.quantity) <= 0) return { status: 'missing', item };
  const sameUnit = unitKey(item.unit) === unitKey(ing.unit);
  if (ing.quantity && sameUnit && Number(item.quantity) < ing.quantity) return { status: 'short', item };
  return { status: 'have', item };
}

function recipeReadiness(recipe) {
  const required = recipe.ingredients.filter((i) => !i.optional);
  const missing = required.filter((i) => ingredientStatus(i).status !== 'have');
  return { missing, canMake: missing.length === 0 };
}

// ======================================================================
// 7. Drawing the screen
// ======================================================================
function render() {
  renderPantry();
  renderRecipes();
  renderShopping();
  renderPickers();
}

function isLow(item) {
  const q = Number(item.quantity) || 0;
  return q <= 0 || (item.lowAt !== '' && item.lowAt != null && q <= Number(item.lowAt));
}

function itemBadges(item) {
  const q = Number(item.quantity) || 0;
  let html = '';
  if (q <= 0) html += '<span class="badge out">Out</span>';
  else if (isLow(item)) html += '<span class="badge low">Running low</span>';
  if (item.expires) {
    const days = Math.round((new Date(item.expires) - new Date(todayString())) / 86400000);
    if (days < 0) html += '<span class="badge expired">Expired</span>';
    else if (days <= 7) html += `<span class="badge soon">${days === 0 ? 'Expires today' : `Expires in ${days}d`}</span>`;
  }
  return html;
}

function renderPantry() {
  const search = norm($('#pantry-search').value);
  const location = $('#pantry-location').value;
  const items = state.pantry.items
    .filter((i) => !search || norm(i.name).includes(search) || norm(i.category).includes(search))
    .filter((i) => !location || i.location === location)
    .sort((a, b) => a.name.localeCompare(b.name));

  const list = $('#pantry-list');
  if (!items.length) {
    list.innerHTML = `<p class="empty">${state.pantry.items.length ? 'Nothing matches.' : 'Your pantry is empty. Tap “+ Add item” to start.'}</p>`;
    return;
  }

  // Group by category.
  const groups = {};
  for (const item of items) (groups[item.category || 'Other'] ||= []).push(item);

  list.innerHTML = Object.keys(groups).sort().map((category) => `
    <h3>${esc(category)} · ${groups[category].length}</h3>
    <ul class="items">
      ${groups[category].map((item) => `
        <li class="item">
          <div class="item-main">
            <span class="item-name">${esc(item.name)}</span>${itemBadges(item)}
            <div class="item-meta">${esc([item.location, item.expires && `exp. ${item.expires}`, item.notes].filter(Boolean).join(' · '))}</div>
          </div>
          <div class="qty">
            <button data-act="dec" data-id="${item.id}" aria-label="One less">−</button>
            <span>${esc(fmtQty(item.quantity))} ${esc(item.unit || '')}</span>
            <button data-act="inc" data-id="${item.id}" aria-label="One more">+</button>
          </div>
          <button class="ghost small" data-act="edit" data-id="${item.id}">Edit</button>
        </li>`).join('')}
    </ul>`).join('');
}

function renderRecipes() {
  const search = norm($('#recipe-search').value);
  const onlyReady = $('#can-make-only').checked;

  const rows = state.recipes.recipes
    .map((r) => ({ recipe: r, ...recipeReadiness(r) }))
    .filter(({ recipe }) => !search || norm(recipe.name).includes(search)
      || (recipe.tags || []).some((t) => norm(t).includes(search))
      || recipe.ingredients.some((i) => norm(i.name).includes(search)))
    .filter(({ canMake }) => !onlyReady || canMake)
    .sort((a, b) => a.missing.length - b.missing.length || a.recipe.name.localeCompare(b.recipe.name));

  const list = $('#recipe-list');
  if (!rows.length) {
    list.innerHTML = `<p class="empty">${state.recipes.recipes.length ? 'No recipes match.' : 'No recipes yet. Tap “+ Add recipe”.'}</p>`;
    return;
  }
  list.innerHTML = rows.map(({ recipe, missing, canMake }) => {
    let badge;
    if (canMake) badge = '<span class="badge good">Ready to cook</span>';
    else if (missing.length <= 2) badge = `<span class="badge short">Missing ${missing.length}</span>`;
    else badge = `<span class="badge missing">Missing ${missing.length}</span>`;
    const meta = [recipe.time, recipe.servings && `serves ${recipe.servings}`].filter(Boolean).join(' · ');
    return `
      <button class="card" data-recipe="${recipe.id}">
        <h4>${esc(recipe.name)}</h4>
        <div>${badge}</div>
        ${meta ? `<div class="muted">${esc(meta)}</div>` : ''}
        ${missing.length && !canMake ? `<div class="missing-list">Need: ${esc(missing.map((m) => m.name).join(', '))}</div>` : ''}
        <div>${(recipe.tags || []).map((t) => `<span class="badge tag">${esc(t)}</span>`).join('')}</div>
      </button>`;
  }).join('');
}

function renderShopping() {
  const shopping = state.pantry.shopping;
  $('#shopping-list').innerHTML = shopping.length
    ? shopping.map((s) => `
        <li>
          <span class="grow">${esc(s.name)}${s.addedBy ? ` <span class="muted">· ${esc(s.addedBy)}</span>` : ''}</span>
          <button class="primary small" data-act="bought" data-id="${s.id}">Bought it</button>
          <button class="ghost small" data-act="remove" data-id="${s.id}" aria-label="Remove">✕</button>
        </li>`).join('')
    : '<p class="empty">Nothing on the list.</p>';

  const onList = new Set(shopping.map((s) => norm(s.name)));
  const low = state.pantry.items.filter(isLow).sort((a, b) => a.name.localeCompare(b.name));
  $('#low-list').innerHTML = low.length
    ? low.map((item) => `
        <li>
          <span class="grow">${esc(item.name)}${itemBadges(item)}
            <span class="muted">· ${esc(fmtQty(item.quantity))} ${esc(item.unit || '')} left</span></span>
          ${onList.has(norm(item.name))
            ? '<span class="muted">On the list</span>'
            : `<button class="small" data-act="add-low" data-id="${item.id}">Add to list</button>`}
        </li>`).join('')
    : '<p class="empty">Nothing is running low. 🎉</p>';
}

// Fills the drop-downs and suggestion lists.
function renderPickers() {
  const locSelect = $('#pantry-location');
  const current = locSelect.value;
  locSelect.innerHTML = '<option value="">Everywhere</option>'
    + LOCATIONS.map((l) => `<option ${l === current ? 'selected' : ''}>${l}</option>`).join('');
  $('#item-location').innerHTML = LOCATIONS.map((l) => `<option>${l}</option>`).join('');

  const categories = new Set([...DEFAULT_CATEGORIES, ...state.pantry.items.map((i) => i.category).filter(Boolean)]);
  $('#category-options').innerHTML = [...categories].sort().map((c) => `<option value="${esc(c)}">`).join('');
  const units = new Set(Object.values(UNIT_ALIASES));
  $('#unit-options').innerHTML = [...units].map((u) => `<option value="${u}">`).join('');
}

// ======================================================================
// 8. Pantry item pop-up
// ======================================================================
function openItemDialog(item = {}) {
  const f = $('#item-form');
  f.reset();
  for (const field of ['id', 'name', 'unit', 'category', 'notes', 'expires']) f.elements[field].value = item[field] || '';
  f.elements.quantity.value = item.quantity ?? 1;
  f.elements.lowAt.value = item.lowAt ?? '';
  f.elements.location.value = item.location || 'Pantry';
  $('#item-dialog-title').textContent = item.id ? 'Edit item' : 'Add item';
  $('#delete-item-btn').hidden = !item.id;
  $('#item-dialog').showModal();
  f.elements.name.focus();
}

$('#item-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const values = {
    name: f.name.value.trim(),
    quantity: f.quantity.value === '' ? 0 : Number(f.quantity.value),
    unit: f.unit.value.trim(),
    category: f.category.value.trim() || 'Other',
    location: f.location.value,
    lowAt: f.lowAt.value === '' ? '' : Number(f.lowAt.value),
    expires: f.expires.value,
    notes: f.notes.value.trim(),
  };
  const id = f.id.value;
  $('#item-dialog').close();

  if (id) {
    change('pantry', `Update ${values.name}`, (d) => {
      const item = d.items.find((i) => i.id === id);
      if (item) Object.assign(item, values);
    });
    return;
  }

  // Adding something we already have? Offer to just top it up.
  const existing = state.pantry.items.find((i) => norm(i.name) === norm(values.name));
  if (existing && confirm(`You already have ${existing.name}. Add ${fmtQty(values.quantity)} to it instead of making a new entry?`)) {
    change('pantry', `Add ${fmtQty(values.quantity)} ${existing.name}`, (d) => {
      const item = d.items.find((i) => i.id === existing.id);
      if (item) item.quantity = (Number(item.quantity) || 0) + values.quantity;
    });
    return;
  }
  const newItem = { id: newId(), ...values };
  change('pantry', `Add ${values.name}`, (d) => { d.items.push(newItem); });
});

$('#delete-item-btn').addEventListener('click', () => {
  const id = $('#item-form').elements.id.value;
  const item = state.pantry.items.find((i) => i.id === id);
  if (!item || !confirm(`Delete ${item.name} from the pantry?`)) return;
  $('#item-dialog').close();
  change('pantry', `Remove ${item.name}`, (d) => { d.items = d.items.filter((i) => i.id !== id); });
});

$('#pantry-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const item = state.pantry.items.find((i) => i.id === btn.dataset.id);
  if (!item) return;
  if (btn.dataset.act === 'edit') return openItemDialog(item);
  const step = btn.dataset.act === 'inc' ? 1 : -1;
  if (step < 0 && Number(item.quantity) <= 0) return;
  change('pantry', `${step > 0 ? '+1' : '−1'} ${item.name}`, (d) => {
    const it = d.items.find((i) => i.id === item.id);
    if (it) it.quantity = Math.max(0, (Number(it.quantity) || 0) + step);
  });
});

// ======================================================================
// 9. Recipe pop-ups (edit + view)
// ======================================================================
function openRecipeDialog(recipe = {}) {
  const f = $('#recipe-form');
  f.reset();
  f.elements.id.value = recipe.id || '';
  f.elements.name.value = recipe.name || '';
  f.elements.servings.value = recipe.servings || '';
  f.elements.time.value = recipe.time || '';
  f.elements.tags.value = (recipe.tags || []).join(', ');
  f.elements.ingredients.value = (recipe.ingredients || []).map(ingredientToLine).join('\n');
  f.elements.steps.value = (recipe.steps || []).join('\n');
  f.elements.notes.value = recipe.notes || '';
  $('#recipe-dialog-title').textContent = recipe.id ? 'Edit recipe' : 'Add recipe';
  $('#delete-recipe-btn').hidden = !recipe.id;
  $('#view-dialog').close();
  $('#recipe-dialog').showModal();
  f.elements.name.focus();
}

$('#recipe-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);
  const values = {
    name: f.name.value.trim(),
    servings: f.servings.value ? Number(f.servings.value) : '',
    time: f.time.value.trim(),
    tags: f.tags.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
    ingredients: lines(f.ingredients.value).map(parseIngredient),
    steps: lines(f.steps.value).map((s) => s.replace(/^\d+[.)]\s*/, '')),
    notes: f.notes.value.trim(),
  };
  const id = f.id.value || newId();
  const isNew = !f.id.value;
  $('#recipe-dialog').close();
  change('recipes', `${isNew ? 'Add' : 'Update'} recipe: ${values.name}`, (d) => {
    const existing = d.recipes.find((r) => r.id === id);
    if (existing) Object.assign(existing, values);
    else d.recipes.push({ id, ...values, addedBy: settings.name || '' });
  });
  openViewDialog(id);
});

$('#delete-recipe-btn').addEventListener('click', () => {
  const id = $('#recipe-form').elements.id.value;
  const recipe = state.recipes.recipes.find((r) => r.id === id);
  if (!recipe || !confirm(`Delete the recipe "${recipe.name}"?`)) return;
  $('#recipe-dialog').close();
  change('recipes', `Delete recipe: ${recipe.name}`, (d) => { d.recipes = d.recipes.filter((r) => r.id !== id); });
});

function openViewDialog(id) {
  const recipe = state.recipes.recipes.find((r) => r.id === id);
  if (!recipe) return;
  const { missing, canMake } = recipeReadiness(recipe);
  const marks = { have: '✅', short: '⚠️', missing: '❌' };
  const ingredientsHtml = recipe.ingredients.map((ing) => {
    const { status, item } = ingredientStatus(ing);
    const note = status === 'have' ? `you have ${fmtQty(item.quantity)} ${item.unit || ''}`
      : status === 'short' ? `only ${fmtQty(item.quantity)} ${item.unit || ''} left` : 'not in pantry';
    return `<li><span class="mark">${ing.optional ? '➖' : marks[status]}</span>${esc(ingredientToLine(ing))}
      <span class="muted">— ${esc(note)}</span></li>`;
  }).join('');
  const isLink = /^https?:\/\//.test(recipe.notes || '');

  $('#view-body').innerHTML = `
    <h2>${esc(recipe.name)}</h2>
    <p class="muted">${esc([recipe.time, recipe.servings && `serves ${recipe.servings}`, recipe.addedBy && `added by ${recipe.addedBy}`].filter(Boolean).join(' · '))}</p>
    <p>${canMake ? '<span class="badge good">You have everything</span>'
      : `<span class="badge missing">Missing ${missing.length}</span>`}</p>
    <h3>Ingredients</h3>
    <ul class="ing-list">${ingredientsHtml}</ul>
    ${recipe.steps?.length ? `<h3>Steps</h3><ol class="steps">${recipe.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${recipe.notes ? `<h3>Notes</h3><p>${isLink ? `<a href="${esc(recipe.notes)}" target="_blank" rel="noopener">${esc(recipe.notes)}</a>` : esc(recipe.notes)}</p>` : ''}
    <div class="buttons">
      <button class="primary" data-act="cook">We cooked this</button>
      ${missing.length ? '<button data-act="shop">Add missing to shopping list</button>' : ''}
      <button class="ghost" data-act="edit">Edit</button>
      <button class="ghost" data-act="close">Close</button>
    </div>`;
  $('#view-body').dataset.id = id;
  if (!$('#view-dialog').open) $('#view-dialog').showModal();
}

$('#view-body').addEventListener('click', (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  if (!act) return;
  const recipe = state.recipes.recipes.find((r) => r.id === $('#view-body').dataset.id);
  if (!recipe) return;
  if (act === 'close') $('#view-dialog').close();
  if (act === 'edit') openRecipeDialog(recipe);
  if (act === 'shop') addMissingToShopping(recipe);
  if (act === 'cook') cookRecipe(recipe);
});

function addMissingToShopping(recipe) {
  const onList = new Set(state.pantry.shopping.map((s) => norm(s.name)));
  const toAdd = recipeReadiness(recipe).missing
    .filter((ing) => !onList.has(norm(ing.name)))
    .map((ing) => ({ id: newId(), name: ing.name, addedBy: settings.name || '' }));
  if (!toAdd.length) return alert('Everything missing is already on the shopping list.');
  change('pantry', `Shopping list: add ${toAdd.map((s) => s.name).join(', ')}`, (d) => { d.shopping.push(...toAdd); });
  alert(`Added to the shopping list: ${toAdd.map((s) => s.name).join(', ')}`);
}

// Subtracts what the recipe used from the pantry (when the units line up).
function cookRecipe(recipe) {
  const used = [];
  const skipped = [];
  for (const ing of recipe.ingredients) {
    const { item } = ingredientStatus(ing);
    if (!item || Number(item.quantity) <= 0) continue;
    if (ing.quantity && unitKey(item.unit) === unitKey(ing.unit)) used.push({ id: item.id, name: item.name, amount: ing.quantity, unit: item.unit });
    else skipped.push(item.name);
  }
  let msg = `Mark "${recipe.name}" as cooked?\n\n`;
  msg += used.length ? `This will take out:\n${used.map((u) => `• ${fmtQty(u.amount)} ${u.unit || ''} ${u.name}`).join('\n')}` : 'Nothing can be subtracted automatically.';
  if (skipped.length) msg += `\n\nCheck these yourself (different units): ${skipped.join(', ')}`;
  if (!confirm(msg)) return;
  change('pantry', `Cooked ${recipe.name}`, (d) => {
    for (const u of used) {
      const it = d.items.find((i) => i.id === u.id);
      if (it) it.quantity = Math.max(0, Math.round(((Number(it.quantity) || 0) - u.amount) * 100) / 100);
    }
  });
  openViewDialog(recipe.id);
}

$('#recipe-list').addEventListener('click', (e) => {
  const card = e.target.closest('[data-recipe]');
  if (card) openViewDialog(card.dataset.recipe);
});

// ======================================================================
// 10. Shopping list
// ======================================================================
$('#shopping-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#shopping-input').value.trim();
  if (!name) return;
  $('#shopping-input').value = '';
  const entry = { id: newId(), name, addedBy: settings.name || '' };
  change('pantry', `Shopping list: add ${name}`, (d) => { d.shopping.push(entry); });
});

$('#shopping-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const entry = state.pantry.shopping.find((s) => s.id === btn.dataset.id);
  if (!entry) return;
  const removeEntry = (d) => { d.shopping = d.shopping.filter((s) => s.id !== entry.id); };

  if (btn.dataset.act === 'remove') return change('pantry', `Shopping list: remove ${entry.name}`, removeEntry);

  // "Bought it": top up the pantry item, or offer to create one.
  const item = findPantryItem(entry.name);
  if (item) {
    const answer = prompt(`How many ${item.unit || ''} of ${item.name} did you buy?`, '1');
    if (answer === null) return;
    const amount = Number(answer) || 0;
    change('pantry', `Bought ${fmtQty(amount)} ${item.name}`, (d) => {
      const it = d.items.find((i) => i.id === item.id);
      if (it) it.quantity = (Number(it.quantity) || 0) + amount;
      removeEntry(d);
    });
  } else {
    change('pantry', `Bought ${entry.name}`, removeEntry);
    if (confirm(`${entry.name} isn't in the pantry yet. Add it now?`)) openItemDialog({ name: entry.name.charAt(0).toUpperCase() + entry.name.slice(1) });
  }
});

$('#low-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="add-low"]');
  const item = btn && state.pantry.items.find((i) => i.id === btn.dataset.id);
  if (!item) return;
  const entry = { id: newId(), name: item.name, addedBy: settings.name || '' };
  change('pantry', `Shopping list: add ${item.name}`, (d) => { d.shopping.push(entry); });
});

// ======================================================================
// 11. Settings
// ======================================================================
function fillSettingsForm() {
  const f = $('#settings-form').elements;
  for (const key of ['name', 'owner', 'repo', 'branch', 'token']) f[key].value = settings[key] || '';
}

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  settings = {
    name: f.name.value.trim(),
    owner: f.owner.value.trim(),
    repo: f.repo.value.trim(),
    branch: f.branch.value.trim() || 'main',
    token: f.token.value.trim(),
  };
  writeStorage(SETTINGS_KEY, settings);
  loadAll();
});

$('#disconnect-btn').addEventListener('click', () => {
  if (!confirm('Forget the GitHub token on this device? Your data stays safe in GitHub.')) return;
  settings = { name: settings.name };
  writeStorage(SETTINGS_KEY, settings);
  fillSettingsForm();
  loadAll();
});

// ======================================================================
// 12. Tabs, searching, and starting up
// ======================================================================
function showTab(name) {
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== name; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  writeStorage('our-pantry-tab', name);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

$('#add-item-btn').addEventListener('click', () => openItemDialog());
$('#add-recipe-btn').addEventListener('click', () => openRecipeDialog());
$('#pantry-search').addEventListener('input', renderPantry);
$('#pantry-location').addEventListener('change', renderPantry);
$('#recipe-search').addEventListener('input', renderRecipes);
$('#can-make-only').addEventListener('change', renderRecipes);
$('#refresh-btn').addEventListener('click', () => loadAll());
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// When you come back to the app, quietly pick up your partner's changes.
window.addEventListener('focus', () => {
  const dialogOpen = [...document.querySelectorAll('dialog')].some((d) => d.open);
  if (isConnected() && pendingSaves === 0 && !dialogOpen) loadAll({ quiet: true });
});

fillSettingsForm();
showTab(readStorage('our-pantry-tab') || 'pantry');
loadAll();
