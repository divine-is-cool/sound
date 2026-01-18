const $ = (sel) => document.querySelector(sel);

const searchInput = $("#searchInput");
const volumeSlider = $("#volumeSlider");
const volumeValue = $("#volumeValue");
const prevPageBtn = $("#prevPage");
const nextPageBtn = $("#nextPage");
const pageLabel = $("#pageLabel");

const favoritesGrid = $("#favoritesGrid");
const favoritesMeta = $("#favoritesMeta");
const favoritesEmpty = $("#favoritesEmpty");

const resultsTitle = $("#resultsTitle");
const resultsMeta = $("#resultsMeta");
const resultsGrid = $("#resultsGrid");

const chaosBtn = $("#chaosBtn");
const loopBtn = $("#loopBtn");
const stopBtn = $("#stopBtn");

const toastEl = $("#toast");

const STORAGE_KEYS = {
  favorites: "sb:favorites:v1",
  volume: "sb:volume:v1"
};

const state = {
  mode: "popular", // "popular" | "search"
  q: "",
  page: 1,
  chaos: false,
  loop: false,
  volumePercent: 100,
  // favorites as object keyed by id for fast lookup
  favorites: loadFavorites(),
  // currently playing HTMLAudioElements, keyed by sound id
  playing: new Map()
};

let audioCtx = null;
let gainNode = null;

// ---- Toast
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1400);
}

// ---- Favorites persistence
function loadFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.favorites);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveFavorites() {
  localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(state.favorites));
}
function isFavorited(id) {
  return Boolean(state.favorites[String(id)]);
}

// ---- Volume persistence
function loadVolume() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.volume);
    const n = parseInt(raw || "100", 10);
    if (Number.isFinite(n)) return Math.min(200, Math.max(0, n));
    return 100;
  } catch {
    return 100;
  }
}
function saveVolume() {
  localStorage.setItem(STORAGE_KEYS.volume, String(state.volumePercent));
}

// ---- Audio init
function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  gainNode = audioCtx.createGain();
  gainNode.gain.value = state.volumePercent / 100;
  gainNode.connect(audioCtx.destination);
}
function routeAudioElement(audioEl) {
  // Connect element to WebAudio once
  if (audioEl.__routed) return;
  ensureAudio();
  const src = audioCtx.createMediaElementSource(audioEl);
  src.connect(gainNode);
  audioEl.__routed = true;
}

// ---- Cache helpers (service worker cache)
const CACHE_NAME = "sound-previews-v1";

async function isCached(url) {
  if (!("caches" in window)) return false;
  const cache = await caches.open(CACHE_NAME);
  const match = await cache.match(url, { ignoreSearch: false });
  return Boolean(match);
}

async function cacheSoundPreview(url) {
  if (!("caches" in window)) {
    toast("Caching not supported in this browser.");
    return false;
  }
  const cache = await caches.open(CACHE_NAME);
  const existing = await cache.match(url, { ignoreSearch: false });
  if (existing) return "already";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cache fetch failed: ${res.status}`);
  await cache.put(url, res.clone());
  return "cached";
}

// ---- API
async function apiGet(path) {
  const res = await fetch(path, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

function currentListTitle() {
  return state.mode === "search" ? `Search: “${state.q}”` : "Popular";
}

function previewUrlFor(id) {
  return `/api/sound/${encodeURIComponent(id)}/preview`;
}

// ---- Rendering
function clearGrid(el) {
  el.innerHTML = "";
}

function renderFavorites() {
  const favEntries = Object.values(state.favorites);
  favoritesMeta.textContent = `${favEntries.length} saved`;

  clearGrid(favoritesGrid);

  if (favEntries.length === 0) {
    favoritesEmpty.style.display = "block";
    return;
  }
  favoritesEmpty.style.display = "none";

  // Render favorites in insertion order stored in object keys (not guaranteed),
  // so store as {id:meta, ...}. We'll sort by a saved timestamp if present.
  favEntries.sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));

  for (const sound of favEntries) {
    favoritesGrid.appendChild(createTile(sound, { section: "favorites" }));
  }
}

function renderResults(items, metaText) {
  resultsTitle.textContent = currentListTitle();
  resultsMeta.textContent = metaText || `${items.length} sounds`;
  pageLabel.textContent = `Page ${state.page}`;

  clearGrid(resultsGrid);
  for (const sound of items) {
    resultsGrid.appendChild(createTile(sound, { section: "results" }));
  }
}

function createTile(sound, { section }) {
  const id = String(sound.id);
  const tile = document.createElement("article");
  tile.className = "tile";
  tile.dataset.soundId = id;

  const top = document.createElement("div");
  top.className = "tile-top";

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.className = "tile-title";
  title.textContent = sound.name || `Sound ${id}`;

  const sub = document.createElement("div");
  sub.className = "tile-sub";
  const by = sound.username ? `by ${sound.username}` : "";
  const dur = Number.isFinite(sound.duration) ? `${sound.duration.toFixed(1)}s` : "";
  sub.textContent = [by, dur].filter(Boolean).join(" • ");

  left.appendChild(title);
  left.appendChild(sub);

  const playBtn = document.createElement("button");
  playBtn.className = "play-btn";
  playBtn.type = "button";
  playBtn.textContent = "▶";
  playBtn.title = "Play";

  playBtn.addEventListener("click", async () => {
    await playSound(sound, tile);
  });

  top.appendChild(left);
  top.appendChild(playBtn);

  const actions = document.createElement("div");
  actions.className = "tile-actions";

  const starBtn = document.createElement("button");
  starBtn.className = "action-btn star";
  starBtn.type = "button";

  const updateStar = () => {
    const fav = isFavorited(id);
    starBtn.textContent = fav ? "★" : "☆";
    starBtn.classList.toggle("filled", fav);
    starBtn.title = fav ? "Unfavorite" : "Favorite";
  };
  updateStar();

  starBtn.addEventListener("click", () => {
    if (isFavorited(id)) {
      delete state.favorites[id];
      saveFavorites();
      renderFavorites();
      updateStar();
      toast("Removed from favorites");
    } else {
      state.favorites[id] = {
        id: sound.id,
        name: sound.name,
        username: sound.username,
        duration: sound.duration,
        favoritedAt: Date.now()
      };
      saveFavorites();
      renderFavorites();
      updateStar();
      toast("Added to favorites");
    }
  });

  const dlBtn = document.createElement("button");
  dlBtn.className = "action-btn";
  dlBtn.type = "button";
  dlBtn.textContent = "⬇";
  dlBtn.title = "Cache for offline";

  dlBtn.addEventListener("click", async () => {
    const url = previewUrlFor(id);
    try {
      const cached = await isCached(url);
      if (cached) {
        toast("You've already downloaded this sound!");
        return;
      }
      const result = await cacheSoundPreview(url);
      if (result === "already") {
        toast("You've already downloaded this sound!");
      } else {
        toast("Cached for offline");
      }
    } catch (e) {
      toast("Cache failed");
      console.error(e);
    }
  });

  actions.appendChild(starBtn);
  actions.appendChild(dlBtn);

  tile.appendChild(top);
  tile.appendChild(actions);

  // reflect playing state
  if (state.playing.has(id)) tile.classList.add("playing");

  return tile;
}

// ---- Playback control
function stopAll() {
  for (const [id, audio] of state.playing.entries()) {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // ignore
    }
    state.playing.delete(id);
    // update tile highlight
    document.querySelectorAll(`[data-sound-id="${CSS.escape(id)}"]`).forEach((t) => t.classList.remove("playing"));
  }
}

async function playSound(sound, tileEl) {
  ensureAudio();

  // resume audio context on user gesture
  if (audioCtx.state === "suspended") {
    await audioCtx.resume().catch(() => {});
  }

  const id = String(sound.id);

  if (!state.chaos) {
    // stop all other sounds (single sound mode)
    stopAll();
  }

  // If this sound is already playing, restart it
  const existing = state.playing.get(id);
  if (existing) {
    try {
      existing.pause();
      existing.currentTime = 0;
    } catch {
      // ignore
    }
    state.playing.delete(id);
  }

  const audio = new Audio(previewUrlFor(id));
  audio.loop = state.loop;

  routeAudioElement(audio);

  audio.addEventListener("ended", () => {
    // if loop=false, it ends; remove from playing
    if (!audio.loop) {
      state.playing.delete(id);
      tileEl.classList.remove("playing");
    }
  });

  audio.addEventListener("pause", () => {
    // if paused (stop all), clear highlight
    if (audio.currentTime === 0 || audio.ended) {
      tileEl.classList.remove("playing");
    }
  });

  // Mark playing
  state.playing.set(id, audio);
  tileEl.classList.add("playing");

  try {
    await audio.play();
  } catch (e) {
    tileEl.classList.remove("playing");
    state.playing.delete(id);
    toast("Playback blocked (click anywhere then try again)");
    console.error(e);
  }
}

// ---- Fetch + load list
async function loadPage() {
  resultsMeta.textContent = "Loading…";
  const page = state.page;

  try {
    let data;
    if (state.mode === "search" && state.q) {
      data = await apiGet(`/api/search?q=${encodeURIComponent(state.q)}&page=${page}`);
    } else {
      data = await apiGet(`/api/popular?page=${page}`);
    }

    const items = Array.isArray(data.results) ? data.results : [];
    const count = data.count ?? null;
    const pages = data.num_pages ?? null;

    const meta = [];
    meta.push(`${items.length} shown`);
    if (typeof count === "number") meta.push(`${count.toLocaleString()} total`);
    if (typeof pages === "number") meta.push(`${pages} pages`);
    renderResults(items, meta.join(" • "));
  } catch (e) {
    resultsMeta.textContent = "Failed to load.";
    clearGrid(resultsGrid);
    console.error(e);
  }
}

// ---- Events
function setPressed(btn, pressed) {
  btn.setAttribute("aria-pressed", pressed ? "true" : "false");
}

chaosBtn.addEventListener("click", () => {
  state.chaos = !state.chaos;
  setPressed(chaosBtn, state.chaos);
  toast(state.chaos ? "Chaos: ON" : "Chaos: OFF");
});

loopBtn.addEventListener("click", () => {
  state.loop = !state.loop;
  setPressed(loopBtn, state.loop);
  // apply to currently playing
  for (const audio of state.playing.values()) audio.loop = state.loop;
  toast(state.loop ? "Loop: ON" : "Loop: OFF");
});

stopBtn.addEventListener("click", () => {
  stopAll();
  toast("Stopped");
});

prevPageBtn.addEventListener("click", () => {
  if (state.page > 1) {
    state.page -= 1;
    stopAll();
    loadPage();
  }
});

nextPageBtn.addEventListener("click", () => {
  state.page += 1;
  stopAll();
  loadPage();
});

let searchDebounce = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    const q = searchInput.value.trim();
    state.q = q;
    state.page = 1;
    state.mode = q ? "search" : "popular";
    stopAll();
    loadPage();
  }, 250);
});

volumeSlider.addEventListener("input", () => {
  const v = parseInt(volumeSlider.value, 10);
  state.volumePercent = Number.isFinite(v) ? v : 100;
  volumeValue.textContent = `${state.volumePercent}%`;

  ensureAudio();
  gainNode.gain.value = state.volumePercent / 100;

  saveVolume();
});

// Keyboard shortcuts: ignore when typing in inputs
window.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea") return;

  if (e.key === "c" || e.key === "C") chaosBtn.click();
  if (e.key === "l" || e.key === "L") loopBtn.click();
  if (e.key === "s" || e.key === "S") stopBtn.click();
});

// ---- Service worker registration
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch (e) {
    console.warn("SW registration failed", e);
  }
}

// ---- Init
(function init() {
  state.volumePercent = loadVolume();
  volumeSlider.value = String(state.volumePercent);
  volumeValue.textContent = `${state.volumePercent}%`;

  renderFavorites();

  setPressed(chaosBtn, state.chaos);
  setPressed(loopBtn, state.loop);

  registerSW();
  loadPage();
})();
