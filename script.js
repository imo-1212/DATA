/* global songsData, YT */

const songs = Array.isArray(songsData) ? [...songsData] : [];
const PAGE_SIZE = 60;
const FAVORITES_KEY = "yumeoi-song-favorites-v1";

const state = {
  mode: "quick",
  query: "",
  sort: "date-desc",
  selectedTypes: new Set(),
  selectedSings: new Set(),
  favoritesOnly: false
};

let filteredSongs = [];
let renderedLimit = PAGE_SIZE;
let favorites = loadFavorites();

let player = null;
let playerReady = false;
let playerCreating = false;
let youtubeApiReady = false;
let queuedSong = null;
let currentSong = null;
let currentSource = null;
let pendingSeekSeconds = null;
let endMonitor = null;
let shuffleEnabled = false;
let shuffleHistory = [];

const $ = selector => document.querySelector(selector);

window.addEventListener("DOMContentLoaded", () => {
  buildFilters();
  bindEvents();
  updateModeButtons();
  updateFavoriteCount();
  updateSelectedFilters();
  render({ resetLimit: true });
});

function bindEvents() {
  $("#mode-all").addEventListener("click", () => changeMode("all"));
  $("#mode-quick").addEventListener("click", () => changeMode("quick"));

  $("#sort-select").addEventListener("change", event => {
    state.sort = event.target.value;
    render({ resetLimit: true });
  });

  $("#search-input").addEventListener("input", event => {
    state.query = normalize(event.target.value);
    render({ resetLimit: true });
  });

  $("#favorites-only").addEventListener("change", event => {
    state.favoritesOnly = event.target.checked;
    render({ resetLimit: true });
  });

  $("#reset-btn").addEventListener("click", resetFilters);
  document.addEventListener("click", event => {
    if (event.target.closest("[data-reset]")) resetFilters();
  });

  $("#load-more").addEventListener("click", () => {
    renderedLimit += PAGE_SIZE;
    renderCards();
  });

  $("#shuffle-btn").addEventListener("click", () => {
    if (shuffleEnabled) {
      setShuffleEnabled(false);
      return;
    }
    setShuffleEnabled(true);
    playNextShuffleSong();
  });

  $("#next-player").addEventListener("click", () => {
    playNextShuffleSong(true);
  });

  $("#close-player").addEventListener("click", closePlayer);
}

function changeMode(mode) {
  state.mode = mode;
  updateModeButtons();
  render({ resetLimit: true });
}

function updateModeButtons() {
  const isAll = state.mode === "all";
  $("#mode-all").classList.toggle("active", isAll);
  $("#mode-quick").classList.toggle("active", !isAll);
  $("#mode-all").setAttribute("aria-pressed", String(isAll));
  $("#mode-quick").setAttribute("aria-pressed", String(!isAll));
  $("#mode-description").textContent = isAll
    ? "現在視聴できない楽曲を含む、すべての歌唱記録を表示します"
    : "現在Youtube上で視聴できる楽曲を主に表示します";
}

function buildFilters() {
  createFilterButtons("#filter-type", uniqueValues("type"), state.selectedTypes);
  createFilterButtons("#filter-sing", uniqueValues("sing"), state.selectedSings);
}

function uniqueValues(key) {
  return [...new Set(songs.flatMap(song => asArray(song[key])))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ja", { numeric: true }));
}

function createFilterButtons(selector, values, selectedSet) {
  const container = $(selector);
  if (!values.length) {
    container.closest("fieldset").hidden = true;
    return;
  }

  values.forEach(value => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-btn";
    button.textContent = value;
    button.dataset.value = value;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      if (selectedSet.has(value)) selectedSet.delete(value);
      else selectedSet.add(value);
      button.classList.toggle("active", selectedSet.has(value));
      button.setAttribute("aria-pressed", String(selectedSet.has(value)));
      updateSelectedFilters();
      render({ resetLimit: true });
    });
    container.appendChild(button);
  });
}

function updateSelectedFilters() {
  const container = $("#selected-filters");
  const selections = [
    ...[...state.selectedTypes].map(value => ({ value, group: "type" })),
    ...[...state.selectedSings].map(value => ({ value, group: "sing" }))
  ];

  $("#selected-filter-count").textContent = selections.length;
  container.hidden = selections.length === 0;
  container.replaceChildren(...selections.map(({ value, group }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "selected-filter";
    button.textContent = `${value} ×`;
    button.addEventListener("click", () => {
      const targetSet = group === "type" ? state.selectedTypes : state.selectedSings;
      targetSet.delete(value);
      document.querySelectorAll(".filter-btn").forEach(item => {
        if (item.dataset.value !== value) return;
        item.classList.remove("active");
        item.setAttribute("aria-pressed", "false");
      });
      updateSelectedFilters();
      render({ resetLimit: true });
    });
    return button;
  }));
}

function applyTagSearch(tag) {
  state.query = normalize(tag);
  $("#search-input").value = tag;
  state.selectedTypes.clear();
  state.selectedSings.clear();
  state.favoritesOnly = false;
  $("#favorites-only").checked = false;
  document.querySelectorAll(".filter-btn").forEach(button => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });
  updateSelectedFilters();
  render({ resetLimit: true });
  $(".results").scrollIntoView({ behavior: "smooth", block: "start" });
}


function resetFilters() {
  state.query = "";
  state.sort = "date-desc";
  state.selectedTypes.clear();
  state.selectedSings.clear();
  state.favoritesOnly = false;

  $("#search-input").value = "";
  $("#sort-select").value = "date-desc";
  $("#favorites-only").checked = false;
  document.querySelectorAll(".filter-btn").forEach(button => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });
  updateSelectedFilters();
  render({ resetLimit: true });
}

function render({ resetLimit = false } = {}) {
  if (resetLimit) renderedLimit = PAGE_SIZE;
  filteredSongs = songs.filter(matchesFilters).sort(compareSongs);
  $("#count").textContent = filteredSongs.length.toLocaleString("ja-JP");
  $("#active-summary").textContent = getActiveSummary();
  $("#empty-state").hidden = filteredSongs.length !== 0;
  updateShuffleButton();
  renderCards();
}

function renderCards() {
  const displayed = filteredSongs.slice(0, renderedLimit);
  $("#song-list").replaceChildren(...displayed.map(createCard));

  const loadMore = $("#load-more");
  const loadMoreWrap = loadMore.closest(".load-more-wrap");
  const hasMore = renderedLimit < filteredSongs.length;

  loadMore.hidden = !hasMore;
  loadMoreWrap.hidden = !hasMore;

  if (hasMore) {
    const remaining = filteredSongs.length - renderedLimit;

    loadMore.textContent =
      `さらに表示（残り${remaining.toLocaleString("ja-JP")}件）`;
  }
}

function matchesFilters(song) {
  if (state.mode === "quick" && !isQuickPlayable(song)) return false;
  if (state.favoritesOnly && !favorites.has(song.id)) return false;
  if (state.selectedTypes.size && !hasAll(asArray(song.type), state.selectedTypes)) return false;
  if (state.selectedSings.size && !hasAll(asArray(song.sing), state.selectedSings)) return false;
  if (!state.query) return true;

  const searchable = [
    song.title,
    song.titleYomi,
    song.artist,
    song.artistYomi,
    song.sourceTitle,
    song.memo,
    song.recordStatus,
    ...asArray(song.type),
    ...asArray(song.sing),
    ...asArray(song.collabo),
    ...asArray(song.keyword)
  ].join(" ");

  return normalize(searchable).includes(state.query);
}

function hasAll(values, selectedSet) {
  return [...selectedSet].every(selected => values.includes(selected));
}

function isBlockedSource(source) {
  return ["deleted", "private", "regionBlocked"].includes(source.availability);
}

function isQuickPlayable(song) {
  return asArray(song.sources).some(source =>
    Boolean(source.url) &&
    source.quickPlay === true &&
    source.availability === "available"
  );
}

function compareSongs(a, b) {
  const titleA = normalizeSortText(a.titleYomi || a.title);
  const titleB = normalizeSortText(b.titleYomi || b.title);
  const artistA = normalizeSortText(a.artistYomi || a.artist);
  const artistB = normalizeSortText(b.artistYomi || b.artist);
  const dateA = parseDate(a.date);
  const dateB = parseDate(b.date);
  const options = { sensitivity: "base", numeric: true };

  switch (state.sort) {
    case "date-asc": return dateA - dateB || titleA.localeCompare(titleB, "ja", options);
    case "title-asc": return titleA.localeCompare(titleB, "ja", options) || dateB - dateA;
    case "title-desc": return titleB.localeCompare(titleA, "ja", options) || dateB - dateA;
    case "artist-asc": return artistA.localeCompare(artistB, "ja", options) || titleA.localeCompare(titleB, "ja", options);
    case "artist-desc": return artistB.localeCompare(artistA, "ja", options) || titleA.localeCompare(titleB, "ja", options);
    default: return dateB - dateA || titleA.localeCompare(titleB, "ja", options);
  }
}

function createCard(song) {
  const article = document.createElement("article");
  const youtubeSource = getYouTubeSource(song);
  const openableSource = getOpenableSource(song);
  article.className = `song-card${openableSource ? "" : " record-only"}`;

  let media;
  if (youtubeSource) {
    const youtube = getYouTubeInfo(youtubeSource.url);
    media = `<button class="thumbnail-button" type="button" data-play aria-label="${escapeHtml(song.title)}をサイト内で再生">
      <img class="thumbnail" src="${escapeAttribute(youtubeThumbnailUrl(youtube.id, "hqdefault.jpg"))}" alt="" loading="lazy" data-thumbnail-id="${escapeAttribute(youtube.id)}">
      <span class="play-mark" aria-hidden="true">▶</span>
    </button>`;
  } else {
    const label = openableSource ? platformLabel(openableSource.platform) : "記録のみ";
    media = `<div class="thumbnail-placeholder">${escapeHtml(label)}</div>`;
  }

  const typeBadges = asArray(song.type).slice(0, 4)
    .map(value => `<button class="badge tag-button" type="button" data-search-tag="${escapeAttribute(value)}">${escapeHtml(value)}</button>`).join("");
  const statusBadge = openableSource ? "" : `<span class="badge warning">${escapeHtml(song.recordStatus || "現在視聴不可")}</span>`;
  const tags = [...asArray(song.sing), ...asArray(song.collabo), ...asArray(song.keyword)];
  const tagHtml = tags.slice(0, 10).map(value =>
    `<button class="tag tag-button" type="button" data-search-tag="${escapeAttribute(value)}">${escapeHtml(value)}</button>`
  ).join("");
  const isFavorite = favorites.has(song.id);

const isYouTubeSource = openableSource?.platform === "youtube";

const sourceLabel = isYouTubeSource
  ? "YouTubeで開く"
  : "元配信を開く";

const targetAttributes = isYouTubeSource
  ? ""
  : `target="_blank" rel="noopener noreferrer"`;

const sourceAction = openableSource
  ? `
    <a
      class="action-button icon-action"
      href="${escapeAttribute(openableSource.url)}"
      ${targetAttributes}
      aria-label="${sourceLabel}"
      title="${sourceLabel}"
      data-tooltip="${sourceLabel}"
    >
      ▶
    </a>
  `
  : "";
 const lyricsAction = song.kasi
  ? `
    <a
      class="action-button"
      href="${escapeAttribute(song.kasi)}"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="歌詞ページを開く"
      title="歌詞ページを開く"
      data-tooltip="歌詞ページを開く"
    >
      歌詞
    </a>
  `
  : "";

/* ここを追加 */
const streamingAction = song.link
  ? `
    <a
      class="action-button link-icon-button"
      href="${escapeAttribute(song.link)}"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="楽曲配信ページを開く"
      title="楽曲配信ページを開く"
      data-tooltip="楽曲配信ページを開く"
    >
      <img
        src="./link-icon.svg"
        alt=""
        aria-hidden="true"
      >
    </a>
  `
  : "";

  article.innerHTML = `${media}
    <div class="card-body">
      <div class="card-meta">
        <time>${escapeHtml(song.date || "日付不明")}</time>
        ${typeBadges}${statusBadge}
      </div>
      <h2 class="song-title">${escapeHtml(song.title || "タイトルなし")}</h2>
      <p class="song-artist">${escapeHtml(song.artist || "アーティスト不明")}</p>
      ${song.sourceTitle ? `<p class="song-source">${escapeHtml(song.sourceTitle)}</p>` : ""}
      ${tagHtml ? `<div class="tag-list">${tagHtml}</div>` : ""}
      ${song.memo ? `<p class="memo">${renderMemo(song.memo)}</p>` : ""}
      <div class="card-actions">
        ${sourceAction}${lyricsAction}${streamingAction}
<button
  class="favorite-button${isFavorite ? " active" : ""}"
  type="button"
  data-favorite
  aria-pressed="${isFavorite}"
  aria-label="${isFavorite ? "お気に入りから削除" : "お気に入りに追加"}"
  title="${isFavorite ? "お気に入りから削除" : "お気に入りに追加"}"
  data-tooltip="${isFavorite ? "お気に入りから削除" : "お気に入りに追加"}"
>
  <svg
    class="favorite-star"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M12 3.5
             L14.7 8.9
             L20.7 9.8
             L16.3 14
             L17.4 20
             L12 17.2
             L6.6 20
             L7.7 14
             L3.3 9.8
             L9.3 8.9
             Z">
    </path>
  </svg>
</button>
</div>
    </div>`;

  const image = article.querySelector(".thumbnail");
  image?.addEventListener("error", () => {
    if (image.dataset.fallbackApplied === "true") {
      image.remove();
      return;
    }
    image.dataset.fallbackApplied = "true";
    image.src = youtubeThumbnailUrl(image.dataset.thumbnailId, "0.jpg");
  });

article.querySelector("[data-play]")?.addEventListener("click", () => {
  setShuffleEnabled(false);
  playSong(song);
});

  article.querySelectorAll("[data-search-tag]").forEach(button => {
    button.addEventListener("click", () => applyTagSearch(button.dataset.searchTag));
  });

  article.querySelector("[data-favorite]").addEventListener("click", () => {
    toggleFavorite(song.id);
  });

  return article;
}

function getSortedSources(song) {
  return [...asArray(song.sources)].sort((a, b) =>
    (a.priority ?? 999) - (b.priority ?? 999)
  );
}

function getYouTubeSource(song) {
  return getSortedSources(song).find(source =>
    source.platform === "youtube" &&
    Boolean(source.url) &&
    source.embed === true &&
    !isBlockedSource(source) &&
    getYouTubeInfo(source.url)
  ) || null;
}

function getOpenableSource(song) {
  const sources = getSortedSources(song).filter(source =>
    Boolean(source.url) && !isBlockedSource(source)
  );
  return sources.find(source => source.quickPlay === true) || sources[0] || null;
}

function platformLabel(platform) {
  const labels = {
    youtube: "YOUTUBE",
    niconico: "ニコニコ動画",
    twitter: "X / TWITTER",
    tiktok: "TIKTOK",
    twitcasting: "ツイキャス",
    bilibili: "BILIBILI",
    spotify: "SPOTIFY",
    appleMusic: "APPLE MUSIC",
    other: "外部サイト"
  };
  return labels[platform] || "外部サイト";
}

function toggleFavorite(id) {
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  saveFavorites();
  updateFavoriteCount();
  render();
}

function loadFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch {
    // localStorageが使えない環境でも一覧表示は継続します。
  }
}

function updateFavoriteCount() {
  $("#favorite-count").textContent = favorites.size.toLocaleString("ja-JP");
}

function updateShuffleButton() {
  const button = $("#shuffle-btn");
  button.disabled = getShuffleCandidates().length === 0;
  if (button.disabled) setShuffleEnabled(false);
}

function setShuffleEnabled(enabled) {
  shuffleEnabled = enabled;
  if (!enabled) shuffleHistory = [];
  const button = $("#shuffle-btn");
  button.textContent = enabled ? "シャッフル停止" : "シャッフル再生";
  button.setAttribute("aria-pressed", String(enabled));
}

function getShuffleCandidates() {
  return filteredSongs.filter(song => Boolean(getYouTubeSource(song)));
}

function playNextShuffleSong(force = false) {
  if (!shuffleEnabled && !force) return;
  const candidates = getShuffleCandidates();
  if (!candidates.length) return;

  let remaining = candidates.filter(song => !shuffleHistory.includes(song.id));
  if (!remaining.length) {
    shuffleHistory = [];
    remaining = [...candidates];
  }
  if (remaining.length > 1 && currentSong) {
    const withoutCurrent = remaining.filter(song => song.id !== currentSong.id);
    if (withoutCurrent.length) remaining = withoutCurrent;
  }

  const nextSong = remaining[Math.floor(Math.random() * remaining.length)];
  shuffleHistory.push(nextSong.id);
  playSong(nextSong, { preserveShuffle: true });
}

function playSong(song, { preserveShuffle = false } = {}) {
  const source = getYouTubeSource(song);
  if (!source) return;
  if (!preserveShuffle) setShuffleEnabled(false);

  currentSong = song;
  currentSource = source;
  pendingSeekSeconds = getSourceStartSeconds(source);
  queuedSong = song;

  $("#player-panel").hidden = false;
  $("#player-title").textContent = `${song.title || "タイトルなし"}（準備中…）`;
  $("#player-artist").textContent = song.artist || "";
  $("#player-panel").scrollIntoView({ behavior: "smooth", block: "start" });

  if (!youtubeApiReady) {
    loadYouTubeApi();
    return;
  }
  if (!playerReady) {
    createYouTubePlayer();
    return;
  }
  queuedSong = null;
  loadSongIntoPlayer(song);
}

function loadYouTubeApi() {
  if (window.YT?.Player) {
    youtubeApiReady = true;
    createYouTubePlayer();
    return;
  }
  if (document.querySelector("script[data-youtube-api]")) return;

  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  tag.async = true;
  tag.dataset.youtubeApi = "true";
  tag.onerror = () => {
    $("#player-title").textContent = "YouTubeプレーヤーを読み込めませんでした";
    $("#player-artist").textContent = "通信設定やコンテンツブロッカーを確認してください";
  };
  document.head.appendChild(tag);
}

window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
  youtubeApiReady = true;
  createYouTubePlayer();
};

function createYouTubePlayer() {
  if (!youtubeApiReady || player || playerCreating || !queuedSong) return;
  playerCreating = true;

  const playerVars = { playsinline: 1, rel: 0 };
  if (location.protocol === "https:" || location.protocol === "http:") {
    playerVars.origin = location.origin;
  }

  player = new YT.Player("youtube-player", {
    width: "100%",
    height: "100%",
    playerVars,
    events: {
      onReady: handlePlayerReady,
      onStateChange: handlePlayerStateChange,
      onError: handlePlayerError
    }
  });
}

function handlePlayerReady() {
  playerReady = true;
  playerCreating = false;
  if (queuedSong) {
    const song = queuedSong;
    queuedSong = null;
    loadSongIntoPlayer(song);
  }
}

function loadSongIntoPlayer(song) {
  const source = getYouTubeSource(song);
  const youtube = source && getYouTubeInfo(source.url);
  if (!youtube || !playerReady) return;

  currentSong = song;
  currentSource = source;
  pendingSeekSeconds = getSourceStartSeconds(source);
  $("#player-title").textContent = song.title || "タイトルなし";
  $("#player-artist").textContent = song.artist || "";

  player.loadVideoById({
    videoId: youtube.id,
    startSeconds: pendingSeekSeconds || 0
  });
}

function handlePlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    if (pendingSeekSeconds !== null) {
      const seconds = pendingSeekSeconds;
      pendingSeekSeconds = null;
      if (seconds > 0 && Math.abs(player.getCurrentTime() - seconds) > 2) {
        player.seekTo(seconds, true);
      }
    }
    startEndMonitor();
  } else {
    stopEndMonitor();
  }

  if (event.data === YT.PlayerState.ENDED && shuffleEnabled) {
    playNextShuffleSong();
  }
}

function handlePlayerError() {
  stopEndMonitor();
  $("#player-title").textContent = "この動画は埋め込み再生できません";
  $("#player-artist").textContent = "「元ページ」から視聴してください";
  if (shuffleEnabled) window.setTimeout(playNextShuffleSong, 900);
}

function startEndMonitor() {
  stopEndMonitor();
  const endSeconds = currentSource?.endSeconds;
  if (!Number.isFinite(endSeconds)) return;

  endMonitor = window.setInterval(() => {
    if (!playerReady || player.getPlayerState() !== YT.PlayerState.PLAYING) return;
    if (player.getCurrentTime() >= endSeconds) {
      stopEndMonitor();
      if (shuffleEnabled) playNextShuffleSong();
      else player.pauseVideo();
    }
  }, 500);
}

function stopEndMonitor() {
  if (endMonitor) window.clearInterval(endMonitor);
  endMonitor = null;
}

function closePlayer() {
  setShuffleEnabled(false);
  stopEndMonitor();
  queuedSong = null;
  pendingSeekSeconds = null;
  if (playerReady) player.stopVideo();
  $("#player-panel").hidden = true;
}

function getSourceStartSeconds(source) {
  if (Number.isFinite(source.startSeconds)) return source.startSeconds;
  return getYouTubeInfo(source.url)?.start || 0;
}

function youtubeThumbnailUrl(videoId, fileName) {
  return "https:" + "//i.ytimg.com/vi/" + encodeURIComponent(videoId) + "/" + fileName;
}

function getYouTubeInfo(urlString) {
  if (!urlString) return null;
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^www\./, "");
    let id = "";

    if (hostname === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
      if (url.pathname.startsWith("/live/")) id = url.pathname.split("/")[2] || "";
      if (url.pathname.startsWith("/shorts/")) id = url.pathname.split("/")[2] || "";
      if (url.pathname.startsWith("/embed/")) id = url.pathname.split("/")[2] || "";
    }
    if (!id) return null;

    const rawStart = url.searchParams.get("t") || url.searchParams.get("start") || "0";
    return { id, start: parseYouTubeTime(rawStart) };
  } catch {
    return null;
  }
}

function parseYouTubeTime(value) {
  const text = String(value || "0");
  if (/^\d+$/.test(text)) return Number(text);
  const hours = Number(text.match(/(\d+)h/)?.[1] || 0);
  const minutes = Number(text.match(/(\d+)m/)?.[1] || 0);
  const seconds = Number(text.match(/(\d+)s/)?.[1] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function getActiveSummary() {
  const parts = [];
  parts.push(state.mode === "quick" ? "すぐ聴ける曲" : "全記録");
  if (state.selectedTypes.size) parts.push([...state.selectedTypes].join("・"));
  if (state.selectedSings.size) parts.push([...state.selectedSings].join("・"));
  if (state.favoritesOnly) parts.push("お気に入り");
  if (state.query) parts.push(`「${state.query}」`);
  return `${parts.join(" / ")}を表示中`;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return String(value).split(",").map(item => item.trim()).filter(Boolean);
}

function parseDate(value) {
  const timestamp = Date.parse(String(value || "").replaceAll("/", "-"));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").trim();
}

function normalizeSortText(value) {
  return normalize(value).replace(/\s+/g, "");
}

function renderMemo(text) {
  return escapeHtml(text || "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, "<br>");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[character]));
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

const pageTopButton = document.querySelector("#page-top");

function updatePageTopButton() {
  const shouldShow = window.scrollY > 300;

  pageTopButton.classList.toggle("is-visible", shouldShow);
}

window.addEventListener("scroll", updatePageTopButton, {
  passive: true
});

pageTopButton.addEventListener("click", () => {
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  window.scrollTo({
    top: 0,
    behavior: reduceMotion ? "auto" : "smooth"
  });

  /* タップ後のフォーカス状態を解除 */
  pageTopButton.blur();
});

updatePageTopButton();
