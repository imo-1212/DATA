/* global songsData, YT */

const songs = Array.isArray(songsData) ? [...songsData] : [];
const state = { type: null, sing: null, oke: null, query: "", sort: "date-desc" };

let visibleSongs = [];
let player = null;
let playerReady = false;
let playerCreating = false;
let youtubeApiReady = false;
let queuedSong = null;
let currentSong = null;
let pendingSeekSeconds = null;
let shuffleEnabled = false;
let shuffleHistory = [];

const $ = (selector) => document.querySelector(selector);

window.addEventListener("DOMContentLoaded", () => {
  buildFilters();
  bindEvents();
  render();
  loadYouTubeApi();
});

/*
 * YouTube IFrame Player APIが読み込み終わると自動で呼ばれます。
 * youtube-nocookie.comは使用せず、通常のYouTubeプレーヤーを生成します。
 */
window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
  youtubeApiReady = true;
  if (queuedSong) createYouTubePlayer();
};

function loadYouTubeApi() {
  if (window.YT?.Player) {
    window.onYouTubeIframeAPIReady();
    return;
  }
  if (document.querySelector('script[data-youtube-api]')) return;

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

function handlePlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING && pendingSeekSeconds !== null) {
    // 配信アーカイブで開始位置が無視される場合への補正です。
    const seconds = pendingSeekSeconds;
    pendingSeekSeconds = null;
    if (seconds > 0 && Math.abs(player.getCurrentTime() - seconds) > 2) {
      player.seekTo(seconds, true);
    }
  }

  if (event.data === YT.PlayerState.ENDED && shuffleEnabled) {
    playNextShuffleSong();
  }
}

function handlePlayerError() {
  $("#player-title").textContent = "この動画は埋め込み再生できません";
  $("#player-artist").textContent = "「元ページを開く」から視聴してください";

  // シャッフル中に再生不可動画へ当たった場合は次の曲へ進みます。
  if (shuffleEnabled) {
    window.setTimeout(playNextShuffleSong, 900);
  }
}

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

  $("#shuffle-btn").addEventListener("click", () => {
    if (shuffleEnabled) {
      setShuffleEnabled(false);
      return;
    }

    setShuffleEnabled(true);
    playNextShuffleSong();
  });

  $("#close-player").addEventListener("click", () => {
    setShuffleEnabled(false);
    queuedSong = null;
    pendingSeekSeconds = null;
    if (playerReady) player.stopVideo();
    $("#player-panel").hidden = true;
  });
}

function buildFilters() {
  createFilterButtons("#filter-type", "type", uniqueValues("type"));
  createFilterButtons("#filter-sing", "sing", uniqueValues("sing"));

  const okeValues = [];
  if (songs.some(song => song.oke === "●")) okeValues.push({ value: "●", label: "あり" });
  if (songs.some(song => !song.oke)) okeValues.push({ value: "__NONE__", label: "なし" });
  createFilterButtons("#filter-oke", "oke", okeValues);
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
  visibleSongs = songs.filter(matchesFilters).sort(compareSongs);
  $("#count").textContent = visibleSongs.length;
  $("#active-summary").textContent = getActiveSummary();
  $("#song-list").replaceChildren(...visibleSongs.map(createCard));
  $("#empty-state").hidden = visibleSongs.length !== 0;

  const playableCount = getPlayableVisibleSongs().length;
  $("#shuffle-btn").disabled = playableCount === 0;
  if (playableCount === 0) setShuffleEnabled(false);
}

function matchesFilters(song) {
  if (state.type && song.type !== state.type) return false;
  if (state.sing && song.sing !== state.sing) return false;
  if (state.oke === "●" && song.oke !== "●") return false;
  if (state.oke === "__NONE__" && song.oke) return false;
  if (!state.query) return true;

  return normalize([
    song.title,
    song.artist,
    song.video,
    song.memo,
    song.type,
    song.sing
  ].join(" ")).includes(state.query);
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
         <img class="thumbnail" src="https://i.ytimg.com/vi/${youtube.id}/mqdefault.jpg" alt="" loading="lazy" onerror="this.remove()">
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
    article.querySelector("[data-play]").addEventListener("click", () => {
      setShuffleEnabled(false);
      playSong(song);
    });
  }

  return article;
}

function playSong(song) {
  const youtube = getYouTubeInfo(song.url);
  if (!youtube) return;

  currentSong = song;
  pendingSeekSeconds = youtube.start;
  $("#player-title").textContent = song.title || "タイトルなし";
  $("#player-artist").textContent = song.artist || "";
  $("#player-panel").hidden = false;
  $("#player-panel").scrollIntoView({ behavior: "smooth", block: "start" });

  if (!playerReady) {
    queuedSong = song;
    $("#player-title").textContent = `${song.title || "タイトルなし"}（準備中…）`;
    if (youtubeApiReady) createYouTubePlayer();
    return;
  }

  loadSongIntoPlayer(song);
}

function loadSongIntoPlayer(song) {
  const youtube = getYouTubeInfo(song.url);
  if (!youtube || !playerReady) return;

  pendingSeekSeconds = youtube.start;
  player.loadVideoById({
    videoId: youtube.id,
    startSeconds: youtube.start
  });
}

function setShuffleEnabled(enabled) {
  shuffleEnabled = enabled;
  if (!enabled) shuffleHistory = [];

  const button = $("#shuffle-btn");
  button.textContent = enabled ? "シャッフル停止" : "シャッフル再生";
  button.setAttribute("aria-pressed", String(enabled));
}

function playNextShuffleSong() {
  if (!shuffleEnabled) return;

  const candidates = getPlayableVisibleSongs();
  if (!candidates.length) {
    setShuffleEnabled(false);
    return;
  }

  // 全曲を一巡するまで同じ曲を選びにくくします。
  let remaining = candidates.filter(song => !shuffleHistory.includes(song));
  if (!remaining.length) {
    shuffleHistory = [];
    remaining = [...candidates];
  }

  if (remaining.length > 1 && currentSong) {
    const withoutCurrent = remaining.filter(song => song !== currentSong);
    if (withoutCurrent.length) remaining = withoutCurrent;
  }

  const nextSong = remaining[Math.floor(Math.random() * remaining.length)];
  shuffleHistory.push(nextSong);
  playSong(nextSong);
}

function getPlayableVisibleSongs() {
  return visibleSongs.filter(song => getYouTubeInfo(song.url));
}

function getYouTubeInfo(urlString) {
  if (!urlString) return null;

  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^www\./, "");
    let id = "";

    if (hostname === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] || "";
    } else if (hostname === "youtube.com" || hostname === "m.youtube.com") {
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

function parseDate(value) {
  const timestamp = Date.parse(String(value || "").replaceAll("/", "-"));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getActiveSummary() {
  const okeLabel = state.oke === "●" ? "オケあり" : state.oke === "__NONE__" ? "オケなし" : "";
  const labels = [state.type, state.sing, okeLabel, state.query ? `「${state.query}」` : ""].filter(Boolean);
  return labels.length ? `${labels.join("・")}で絞り込み中` : "すべて表示中";
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").trim();
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
