/* global songsData */

const songs = Array.isArray(songsData) ? [...songsData] : [];
const state = { type: null, sing: null, oke: null, query: "", sort: "date-desc" };

const $ = (selector) => document.querySelector(selector);

window.addEventListener("DOMContentLoaded", () => {
  buildFilters();
  bindEvents();
  render();
});

function bindEvents() {
  $("#sort-select").addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  $("#search-input").addEventListener("input", (event) => {
    state.query = normalize(event.target.value);
    render();
  });

  $("#reset-btn").addEventListener("click", resetFilters);
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-reset]")) resetFilters();
  });

  $("#close-player").addEventListener("click", () => {
    $("#youtube-player").src = "";
    $("#player-panel").hidden = true;
  });
}

function buildFilters() {
  createFilterButtons("#filter-type", "type", uniqueValues("type"));
  createFilterButtons("#filter-sing", "sing", uniqueValues("sing"));
  createFilterButtons("#filter-oke", "oke", uniqueValues("oke").map(value => ({ value, label: value === "●" ? "あり" : "なし" })));
}

function uniqueValues(key) {
  return [...new Set(songs.map(song => String(song[key] ?? "").trim()))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ja"));
}

function createFilterButtons(selector, key, values) {
  const container = $(selector);
  const entries = values.map(item => typeof item === "string" ? { value: item, label: item } : item);

  if (!entries.length) {
    container.closest("fieldset").hidden = true;
    return;
  }

  entries.forEach(({ value, label }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-btn";
    button.textContent = label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      state[key] = state[key] === value ? null : value;
      container.querySelectorAll("button").forEach(item => {
        const active = item === button && state[key] === value;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      render();
    });
    container.appendChild(button);
  });
}

function resetFilters() {
  Object.assign(state, { type: null, sing: null, oke: null, query: "", sort: "date-desc" });
  $("#search-input").value = "";
  $("#sort-select").value = "date-desc";
  document.querySelectorAll(".filter-btn").forEach(button => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });
  render();
}

function render() {
  const filtered = songs.filter(matchesFilters).sort(compareSongs);
  $("#count").textContent = filtered.length;
  $("#active-summary").textContent = getActiveSummary();
  $("#song-list").replaceChildren(...filtered.map(createCard));
  $("#empty-state").hidden = filtered.length !== 0;
}

function matchesFilters(song) {
  if (state.type && song.type !== state.type) return false;
  if (state.sing && song.sing !== state.sing) return false;
  if (state.oke && song.oke !== state.oke) return false;
  if (!state.query) return true;

  return normalize([song.title, song.artist, song.video, song.memo, song.type, song.sing].join(" ")).includes(state.query);
}

function compareSongs(a, b) {
  const titleA = a.title || "";
  const titleB = b.title || "";
  const artistA = a.artist || "";
  const artistB = b.artist || "";
  const dateA = parseDate(a.date);
  const dateB = parseDate(b.date);

  switch (state.sort) {
    case "date-asc": return dateA - dateB;
    case "title-asc": return titleA.localeCompare(titleB, "ja");
    case "title-desc": return titleB.localeCompare(titleA, "ja");
    case "artist-asc": return artistA.localeCompare(artistB, "ja");
    case "artist-desc": return artistB.localeCompare(artistA, "ja");
    default: return dateB - dateA;
  }
}

function createCard(song) {
  const article = document.createElement("article");
  article.className = "song-card";

  const youtube = getYouTubeInfo(song.url);
  const media = youtube
    ? `<button class="thumbnail-button" type="button" aria-label="${escapeHtml(song.title)}をページ内で再生" data-play>
         <img class="thumbnail" src="https://i.ytimg.com/vi/${youtube.id}/mqdefault.jpg" alt="" loading="lazy">
         <span class="play-mark" aria-hidden="true">▶</span>
       </button>`
    : `<div class="thumbnail-placeholder">${escapeHtml(song.type || "楽曲")}</div>`;

  const badges = [song.type, song.sing, song.oke === "●" ? "オケあり" : ""]
    .filter(Boolean)
    .map(value => `<span class="badge">${escapeHtml(value)}</span>`)
    .join("");

  article.innerHTML = `${media}
    <div class="card-body">
      <div class="card-meta"><time>${escapeHtml(song.date || "日付不明")}</time>${badges}</div>
      <h2 class="song-title">${escapeHtml(song.title || "タイトルなし")}</h2>
      <p class="song-artist">${escapeHtml(song.artist || "アーティスト不明")}</p>
      ${song.video ? `<p class="song-source">${escapeHtml(song.video)}</p>` : ""}
      ${song.memo ? `<p class="memo">${escapeHtml(song.memo)}</p>` : ""}
      <div class="card-actions">
        <a class="secondary-button" href="${escapeAttribute(song.url || "#")}" target="_blank" rel="noopener noreferrer">元ページを開く</a>
      </div>
    </div>`;

  if (youtube) {
    article.querySelector("[data-play]").addEventListener("click", () => playYouTube(song, youtube));
  }
  return article;
}

function playYouTube(song, youtube) {
  const params = new URLSearchParams({ autoplay: "1", playsinline: "1" });
  if (youtube.start) params.set("start", youtube.start);
  $("#youtube-player").src = `https://www.youtube.com/embed/${youtube.id}?${params}`;
  $("#player-title").textContent = song.title || "タイトルなし";
  $("#player-artist").textContent = song.artist || "";
  $("#player-panel").hidden = false;
  $("#player-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function getYouTubeInfo(urlString) {
  if (!urlString) return null;
  try {
    const url = new URL(urlString);
    let id = "";
    if (url.hostname.includes("youtu.be")) id = url.pathname.slice(1);
    if (url.hostname.includes("youtube.com")) id = url.searchParams.get("v") || "";
    if (!id) return null;
    const rawStart = url.searchParams.get("t") || url.searchParams.get("start") || "0";
    return { id, start: String(parseYouTubeTime(rawStart)) };
  } catch { return null; }
}

function parseYouTubeTime(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const hours = Number(value.match(/(\d+)h/)?.[1] || 0);
  const minutes = Number(value.match(/(\d+)m/)?.[1] || 0);
  const seconds = Number(value.match(/(\d+)s/)?.[1] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function parseDate(value) {
  const timestamp = Date.parse(String(value || "").replaceAll("/", "-"));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getActiveSummary() {
  const labels = [state.type, state.sing, state.oke === "●" ? "オケあり" : state.oke, state.query ? `「${state.query}」` : ""].filter(Boolean);
  return labels.length ? `${labels.join("・")}で絞り込み中` : "すべて表示中";
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[character]));
}

function escapeAttribute(value) { return escapeHtml(value); }
