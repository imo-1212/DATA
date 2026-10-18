/* global songsData, YT */

const songs = typeof songsData !== "undefined" && Array.isArray(songsData) ? [...songsData] : [];
const PAGE_SIZE = 60;
const FAVORITES_KEY = "yumeoi-song-favorites-v1";

/* 楽曲タイプ */
const SONG_TYPE_TAGS = [
  "歌ってみた",
  "オリジナル"
];

/* 配信・公開形態 */
const SONG_FORMAT_TAGS = [
  "歌枠",
  "動画",
  "配信",
  "ライブ",
  "サブスク",
  "Twitter",
  "niconico",
  "TikTok",
  "Bilibili",
  "その他"
];

/* 人数 */
const SING_COUNT_TAGS = [
 "コラボ",
  "1人",
  "2人",
  "3人以上",
  "大人数"
];

/* 歌唱形式など */
const SING_STYLE_TAGS = [
  "3D",
  "にじ3D",
  "ラップ",
  "アカペラ",
  "コーラス",
  "ワンフレーズ",
  "ワンコーラス",
  "ジングル",
  "BGM",
  "生演奏",
  "生活音・雑談枠",
  "記念枠",
  "他ライバー歌唱",
  "ピアノ音源"
];

/* ユニット名 */
const SING_UNIT_TAGS = [
  "もやしば",
  "ゆめおいまちた",
  "黒夢町",
  "le jouet",
  "夢星家",
  "VACHSS",
  "イケボホストクラブ",
  "実は同期なんです"
];

const SING_EVENT_TAGS = [
  "にじロック",
  "歌リレー",
  "にじさんじANNIVERSARY FESTIVAL 2021",
  "Light up tones",
  "NIJIROCK NEXT BEAT",
  "NJU歌謡祭2021",
  "JM梅田",
  "FANTASIA",
  "ユニット歌謡祭2022",
  "にじフェス2023前夜祭",
  "ゆめおの夢まつり",
  "ANISAMA V神",
  "にじさんじ歌謡祭2024",
  "NIJISANJI COUNTDOWN LIVE 2024→2025",
  "Singin’ in the Rainbow！　福岡公演",
  "VACHSS_LIVE"
];

const SING_OTHER_TAGS = [
  "絵空事への入口",
  "絵空事に生きる",
  "拝啓、匣庭の中より",
  "音楽が消えた街",
  "廃墟セッション",
  "音楽で遊ぶ企画",
  "夢追ボーカルへの道",
  "サンホラ",
  "プリティシリーズ"
];

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
  on("#mode-all", "click", () => changeMode("all"));
  on("#mode-quick", "click", () => changeMode("quick"));
  on("#sort-select", "change", event => {
    state.sort = event.target.value;
    render({ resetLimit: true });
  });
  on("#search-input", "input", event => {
    state.query = normalize(event.target.value);
    render({ resetLimit: true });
  });
  on("#favorites-only", "change", event => {
    state.favoritesOnly = event.target.checked;
    render({ resetLimit: true });
  });
  on("#reset-btn", "click", resetFilters);
  document.addEventListener("click", event => {
    if (event.target.closest("[data-reset]")) resetFilters();
  });
  on("#load-more", "click", () => {
    renderedLimit += PAGE_SIZE;
    renderCards();
  });
  on("#shuffle-btn", "click", () => playNextShuffleSong(true));
  on("#next-player", "click", () => playNextShuffleSong(true));
  on("#close-player", "click", closePlayer);
  on("#player-favorite-button", "click", () => {
    if (!currentSong) return; toggleFavorite( currentSong.id );
  });
  on("#toggle-player-video", "click", event => {
    const isVisible = event.currentTarget.getAttribute("aria-expanded") === "true";
    setPlayerVideoVisible(!isVisible);
  });
  on("#page-top", "click", event => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    event.currentTarget.blur();
  });
  window.addEventListener("scroll", updatePageTopButton, { passive: true });
  updatePageTopButton();
  const helpDialog = $("#help-dialog");

  on("#help-open", "click", () => {
  if (!helpDialog || helpDialog.open) return;
  helpDialog.showModal();
});

on("#help-close", "click", () => {
  if (!helpDialog) return;
  helpDialog.close();
});

helpDialog?.addEventListener("click", event => {
  if (event.target === helpDialog) {
    helpDialog.close();
  }
});
}

function on(selector, eventName, handler) {
  const element = $(selector);
  if (element) element.addEventListener(eventName, handler);
}

function changeMode(mode) {
  state.mode = mode;
  updateModeButtons();
  render({ resetLimit: true });
}

function updateModeButtons() {
  const isAll = state.mode === "all";
  const allButton = $("#mode-all");
  const quickButton = $("#mode-quick");
  if (allButton) {
    allButton.classList.toggle("active", isAll);
    allButton.setAttribute("aria-pressed", String(isAll));
  }
  if (quickButton) {
    quickButton.classList.toggle("active", !isAll);
    quickButton.setAttribute("aria-pressed", String(!isAll));
  }
  const description = $("#mode-description");
  if (description) {
    description.textContent = isAll
      ? "現在視聴できない楽曲を含む、すべての歌唱記録を表示します"
      : "現在YouTube上で視聴できる楽曲を主に表示します";
  }
}

function buildFilters() {
  const allTypeTags =
    uniqueValues("type");

  const songTypeTags =
    SONG_TYPE_TAGS.filter(value =>
      allTypeTags.includes(value)
    );

  const formatTags =
    SONG_FORMAT_TAGS.filter(value =>
      allTypeTags.includes(value)
    );

  const assignedTypeTags = new Set([
    ...SONG_TYPE_TAGS,
    ...SONG_FORMAT_TAGS
  ]);

  const unassignedTypeTags =
    allTypeTags.filter(value =>
      !assignedTypeTags.has(value)
    );

  const finalFormatTags = [
    ...formatTags,
    ...unassignedTypeTags
  ];

  createFilterButtons(
    "#filter-song-type",
    songTypeTags,
    state.selectedTypes
  );

  createFilterButtons(
    "#filter-type",
    finalFormatTags,
    state.selectedTypes
  );

  /*
   * ここから既存のsingタグ処理
   */
  const allSingTags =
    uniqueValues("sing");

  const existingTags = values =>
    values.filter(value =>
      allSingTags.includes(value)
    );

  const countTags =
    existingTags(SING_COUNT_TAGS);

  const styleTags =
    existingTags(SING_STYLE_TAGS);

  const unitTags =
    existingTags(SING_UNIT_TAGS);

  const eventTags =
    existingTags(SING_EVENT_TAGS);

  /*
   * 分類済みのタグをまとめる
   */
  const assignedTags = new Set([
    ...SING_COUNT_TAGS,
    ...SING_STYLE_TAGS,
    ...SING_UNIT_TAGS,
    ...SING_EVENT_TAGS,
    ...SING_OTHER_TAGS
  ]);

  /*
   * OTHER_TAGSに指定したタグ
   */
  const specifiedOtherTags =
    existingTags(SING_OTHER_TAGS);

  /*
   * どの配列にも書かれていないタグは、
   * 自動的に「その他」の最後へ追加
   */
  const unassignedTags =
    allSingTags.filter(value =>
      !assignedTags.has(value)
    );

  const otherTags = [
    ...specifiedOtherTags,
    ...unassignedTags
  ];

  /*
   * 各表示場所へボタンを作る
   */
  createFilterButtons(
    "#filter-sing-count",
    countTags,
    state.selectedSings
  );

  createFilterButtons(
    "#filter-sing-style",
    styleTags,
    state.selectedSings
  );

  createFilterButtons(
    "#filter-sing-unit",
    unitTags,
    state.selectedSings
  );

  createFilterButtons(
    "#filter-sing-event",
    eventTags,
    state.selectedSings
  );

  createFilterButtons(
    "#filter-sing-other",
    otherTags,
    state.selectedSings
  );
}

function uniqueValues(key) {
  return [...new Set(songs.flatMap(song => asArray(song[key])))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ja", { numeric: true }));
}

function createFilterButtons(selector, values, selectedSet) {
  const container = $(selector);
  if (!container) return;
  container.replaceChildren();
  const fieldset = container.closest("fieldset");
  if (!values.length) {
    if (fieldset) fieldset.hidden = true;
    return;
  }
  if (fieldset) fieldset.hidden = false;
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
  const count = $("#selected-filter-count");
  if (!container || !count) return;
  const selections = [
    ...[...state.selectedTypes].map(value => ({ value, group: "type" })),
    ...[...state.selectedSings].map(value => ({ value, group: "sing" }))
  ];
  count.textContent = selections.length;
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
        if (item.dataset.value === value) {
          item.classList.remove("active");
          item.setAttribute("aria-pressed", "false");
        }
      });
      updateSelectedFilters();
      render({ resetLimit: true });
    });
    return button;
  }));
}

function applyCardTagFilter(tag) {
  const targetButton = [
    ...document.querySelectorAll(
      ".filter-btn"
    )
  ].find(button =>
    button.dataset.value === tag
  );
  if (!targetButton) {
    applyTagSearch(tag);
    return;
  }
  const tagPanel =
    $("#tag-filter-panel");
  if (tagPanel) {
    tagPanel.open = true;
  }
  if (
    !targetButton.classList.contains(
      "active"
    )
  ) {
    targetButton.click();
  }
  targetButton.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

function applyTagSearch(tag) {
  state.query = normalize(tag);
  const input = $("#search-input");
  if (input) input.value = tag;
  state.selectedTypes.clear();
  state.selectedSings.clear();
  state.favoritesOnly = false;
  const favoriteToggle = $("#favorites-only");
  if (favoriteToggle) favoriteToggle.checked = false;
  clearFilterButtonStates();
  updateSelectedFilters();
  render({ resetLimit: true });
  $(".results")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetFilters() {
  state.query = "";
  state.sort = "date-desc";
  state.selectedTypes.clear();
  state.selectedSings.clear();
  state.favoritesOnly = false;
  if ($("#search-input")) $("#search-input").value = "";
  if ($("#sort-select")) $("#sort-select").value = "date-desc";
  if ($("#favorites-only")) $("#favorites-only").checked = false;
  clearFilterButtonStates();
  updateSelectedFilters();
  render({ resetLimit: true });
}

function clearFilterButtonStates() {
  document.querySelectorAll(".filter-btn").forEach(button => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });
}

function render({ resetLimit = false } = {}) {
  if (resetLimit) renderedLimit = PAGE_SIZE;
  filteredSongs = songs.filter(matchesFilters).sort(compareSongs);
  if ($("#count")) $("#count").textContent = filteredSongs.length.toLocaleString("ja-JP");
  if ($("#active-summary")) $("#active-summary").textContent = getActiveSummary();
  if ($("#empty-state")) $("#empty-state").hidden = filteredSongs.length !== 0;
  updateShuffleButton();
  renderCards();
}

function renderCards() {
  const list = $("#song-list");
  if (!list) return;
  const displayed = filteredSongs.slice(0, renderedLimit);
  list.replaceChildren(...displayed.map(createCard));
  const loadMore = $("#load-more");
  if (!loadMore) return;
  const loadMoreWrap = loadMore.closest(".load-more-wrap");
  const hasMore = renderedLimit < filteredSongs.length;
  loadMore.hidden = !hasMore;
  if (loadMoreWrap) loadMoreWrap.hidden = !hasMore;
  if (hasMore) {
    const remaining = filteredSongs.length - renderedLimit;
    loadMore.textContent = `さらに表示（残り${remaining.toLocaleString("ja-JP")}件）`;
  }
}

function matchesFilters(song) {
  if (state.mode === "quick" && !isQuickPlayable(song)) return false;
  if (state.favoritesOnly && !favorites.has(song.id)) return false;
  if (state.selectedTypes.size && !hasAll(asArray(song.type), state.selectedTypes)) return false;
  if (state.selectedSings.size && !hasAll(asArray(song.sing), state.selectedSings)) return false;
  if (!state.query) return true;
  const searchable = [
    song.title, song.titleYomi, song.artist, song.artistYomi, song.sourceTitle,
    song.memo, song.recordStatus, ...asArray(song.type), ...asArray(song.sing),
    ...asArray(song.collabo), ...asArray(song.keyword)
  ].join(" ");
  return normalize(searchable).includes(state.query);
}

function hasAll(values, selectedSet) {
  return [...selectedSet].every(selected => values.includes(selected));
}

function isBlockedSource(source) {
  return ["deleted", "private", "regionBlocked"].includes(source?.availability);
}

function isQuickPlayable(song) {
  return asArray(song.sources).some(source =>
    Boolean(source.url) && source.quickPlay === true && source.availability === "available"
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
    media = `<button class="thumbnail-button" type="button" data-play aria-label="${escapeAttribute(song.title || "楽曲")}をサイト内で再生">
      <img class="thumbnail" src="${escapeAttribute(youtubeThumbnailUrl(youtube.id, "mqdefault.jpg"))}" alt="" loading="lazy" data-thumbnail-id="${escapeAttribute(youtube.id)}">
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
  const tagHtml = tags.slice(0, 10)
    .map(value => `<button class="tag tag-button" type="button" data-search-tag="${escapeAttribute(value)}">${escapeHtml(value)}</button>`).join("");
  const isFavorite = favorites.has(song.id);
  const isYouTubeSource = openableSource?.platform === "youtube";
  const sourceLabel = isYouTubeSource ? "YouTubeで開く" : "元配信を開く";
  const targetAttributes = isYouTubeSource ? "" : `target="_blank" rel="noopener noreferrer"`;
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
      <img
        class="url-icon"
        src="./url-icon.svg"
        alt=""
        aria-hidden="true"
      >

      <span class="action-label">
        元配信
      </span>
    </a>
  `
  : "";
  
  const lyricsAction = song.kasi
  ? `
    <a
      class="action-button lyrics-action"
      href="${escapeAttribute(song.kasi)}"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="歌詞ページを開く"
      title="歌詞ページを開く"
      data-tooltip="歌詞ページを開く"
    >
      <span aria-hidden="true">
        歌詞
      </span>

      <span class="action-label">
        歌詞
      </span>
    </a>
  `
  : "";
  
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

      <span class="action-label">
        LINK
      </span>
    </a>
  `
  : "";
  
  article.innerHTML = `${media}
    <div class="card-body">
      <div class="card-meta"><time>${escapeHtml(song.date || "日付不明")}</time>${typeBadges}${statusBadge}</div>
      <h2 class="song-title">${escapeHtml(song.title || "タイトルなし")}</h2>
      <p class="song-artist">${escapeHtml(song.artist || "アーティスト不明")}</p>
      ${song.sourceTitle ? `<p class="song-source">${escapeHtml(song.sourceTitle)}</p>` : ""}
      ${tagHtml ? `<div class="tag-list">${tagHtml}</div>` : ""}
${song.memo
  ? `<p class="memo">${renderMemo(song.memo)}</p>`
  : ""
}

</div>

<div class="card-actions">
  ${sourceAction}
  ${lyricsAction}
  ${streamingAction}

  <button
    class="favorite-button${isFavorite ? " active" : ""}"
    type="button"
    data-favorite
    aria-pressed="${isFavorite}"
    aria-label="${isFavorite
      ? "お気に入りから削除"
      : "お気に入りに追加"
    }"
    title="${isFavorite
      ? "お気に入りから削除"
      : "お気に入りに追加"
    }"
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

    <span class="action-label">
      保存
    </span>
  </button>
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
article.querySelectorAll("[data-search-tag]").forEach(button => {button.addEventListener("click",() =>
        applyCardTagFilter(button.dataset.searchTag)
    );
  });
  article.querySelector("[data-favorite]")?.addEventListener("click", () => toggleFavorite(song.id));
  return article;
}

function getSortedSources(song) {
  return [...asArray(song.sources)].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}

function getYouTubeSource(song) {
  return getSortedSources(song).find(source =>
    source.platform === "youtube" && Boolean(source.url) && source.embed === true &&
    !isBlockedSource(source) && getYouTubeInfo(source.url)
  ) || null;
}

function getOpenableSource(song) {
  const sources = getSortedSources(song).filter(source => Boolean(source.url) && !isBlockedSource(source));
  return sources.find(source => source.quickPlay === true) || sources[0] || null;
}

function platformLabel(platform) {
  const labels = {
    youtube: "Youtube", niconico: "ニコニコ動画", twitter: "X（Twitter）",
    tiktok: "Tiktok", twitcasting: "ツイキャス", bilibili: "Bilibili",
    spotify: "SPOTIFY", appleMusic: "APPLE MUSIC", other: "外部サイト"
  };
  return labels[platform] || "外部サイト";
}

function updatePlayerFavoriteButton() {
  const button =
    $("#player-favorite-button");

  if (!button) return;

  /*
   * 再生中の曲があり、
   * お気に入りに入っているか確認
   */
  const isFavorite =
    Boolean(currentSong) &&
    favorites.has(currentSong.id);

  button.classList.toggle(
    "active",
    isFavorite
  );

  button.setAttribute(
    "aria-pressed",
    String(isFavorite)
  );

  const label = isFavorite
    ? "お気に入りから削除"
    : "お気に入りに追加";

  button.setAttribute(
    "aria-label",
    label
  );

  button.setAttribute(
    "title",
    label
  );
}

function toggleFavorite(id) {
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  saveFavorites();
  updateFavoriteCount();
  updatePlayerFavoriteButton();
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
    // localStorageが使えなくても一覧表示は継続します。
  }
}

function updateFavoriteCount() {
  if ($("#favorite-count")) $("#favorite-count").textContent = favorites.size.toLocaleString("ja-JP");
}

function updateShuffleButton() {
  const button = $("#shuffle-btn");
  if (!button) return;
  button.disabled = getShuffleCandidates().length === 0;
  if (button.disabled) setShuffleEnabled(false);
}

function setShuffleEnabled(enabled) {
  shuffleEnabled = enabled;
  if (!enabled) shuffleHistory = [];
  const button = $("#shuffle-btn");
  if (!button) return;
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
  updatePlayerDetails(
  song,
  source
);
  queuedSong = song;
  const panel = $("#player-panel");
  if (panel) panel.hidden = false;
  if (!preserveShuffle) setPlayerVideoVisible(true);
  if ($("#player-title")) $("#player-title").textContent = `${song.title || "タイトルなし"}（準備中…）`;
  if ($("#player-artist")) $("#player-artist").textContent = song.artist || "";
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });
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

function updatePlayerDetails(
  song,
  source
) {
  const dateElement =
    $("#player-detail-date");

  const typeElement =
    $("#player-detail-types");

  const sourceElement =
    $("#player-detail-source");

  const tagsElement =
    $("#player-detail-tags");

  const linkElement =
    $("#player-detail-link");

  const streamingLinkElement =
  $("#player-detail-streaming-link");

  /*
   * 日付
   */
  if (dateElement) {
    dateElement.textContent =
      song.date || "日付不明";
  }

  /*
   * 楽曲タイプ・形態
   */
  if (typeElement) {
typeElement.innerHTML =
  asArray(song.type)
    .map(value => `
      <button
        class="player-detail-tag type"
        type="button"
        data-player-tag="${escapeAttribute(value)}"
      >
        ${escapeHtml(value)}
      </button>
    `)
    .join("");
  }

  /*
   * 配信・動画タイトル
   */
  if (sourceElement) {
    sourceElement.textContent =
      song.sourceTitle || "";
  }

  /*
   * sing・collabo・keyword
   */
  if (tagsElement) {
    const tags = [
      ...asArray(song.sing),
      ...asArray(song.collabo),
      ...asArray(song.keyword)
    ];

tagsElement.innerHTML =
  tags
    .map(value => `
      <button
        class="player-detail-tag"
        type="button"
        data-player-tag="${escapeAttribute(value)}"
      >
        ${escapeHtml(value)}
      </button>
    `)
    .join("");
  }

  document
  .querySelectorAll(
    ".player-desktop-details [data-player-tag]"
  )
  .forEach(button => {
    button.addEventListener(
      "click",
      () => {
        applyCardTagFilter(
          button.dataset.playerTag
        );
      }
    );
  });

  /*
   * 元配信リンク
   */
  if (linkElement) {
    if (source?.url) {
      linkElement.href =
        source.url;

      linkElement.hidden = false;
    } else {
      linkElement.removeAttribute(
        "href"
      );

      linkElement.hidden = true;
    }
  }
  /*
 * サブスク・配信サイトへのLINK
 */
if (streamingLinkElement) {
  if (song.link) {
    streamingLinkElement.href =
      song.link;

    streamingLinkElement.hidden =
      false;
  } else {
    streamingLinkElement
      .removeAttribute("href");

    streamingLinkElement.hidden =
      true;
  }
}
  updatePlayerFavoriteButton();
}

function setPlayerVideoVisible(visible) {
  const panel =
    $("#player-panel");

  const videoArea =
    $("#player-video-area");

  const toggleButton =
    $("#toggle-player-video");

  if (
    !videoArea ||
    !toggleButton
  ) {
    return;
  }

  /*
   * YouTube動画を収納
   */
  videoArea.classList.toggle(
    "is-collapsed",
    !visible
  );

  /*
   * PC用詳細欄も同時に収納
   */
  if (panel) {
    panel.classList.toggle(
      "is-collapsed",
      !visible
    );
  }

  toggleButton.setAttribute(
    "aria-expanded",
    String(visible)
  );

  const label =
    visible
      ? "動画を収納"
      : "動画を表示";

  toggleButton.setAttribute(
    "aria-label",
    label
  );

  toggleButton.setAttribute(
    "title",
    label
  );
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
    if ($("#player-title")) $("#player-title").textContent = "YouTubeプレーヤーを読み込めませんでした";
    if ($("#player-artist")) $("#player-artist").textContent = "通信設定やコンテンツブロッカーを確認してください";
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
  if (["http:", "https:"].includes(location.protocol)) playerVars.origin = location.origin;
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
  if ($("#player-title")) $("#player-title").textContent = song.title || "タイトルなし";
  if ($("#player-artist")) $("#player-artist").textContent = song.artist || "";
  player.loadVideoById({ videoId: youtube.id, startSeconds: pendingSeekSeconds || 0 });
}

function handlePlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    if (pendingSeekSeconds !== null) {
      const seconds = pendingSeekSeconds;
      pendingSeekSeconds = null;
      if (seconds > 0 && Math.abs(player.getCurrentTime() - seconds) > 2) player.seekTo(seconds, true);
    }
    startEndMonitor();
  } else {
    stopEndMonitor();
  }
  if (event.data === YT.PlayerState.ENDED && shuffleEnabled) playNextShuffleSong();
}

function handlePlayerError() {
  stopEndMonitor();
  if ($("#player-title")) $("#player-title").textContent = "この動画は埋め込み再生できません";
  if ($("#player-artist")) $("#player-artist").textContent = "元配信リンクから視聴してください";
  if (shuffleEnabled) window.setTimeout(playNextShuffleSong, 900);
}

function startEndMonitor() {
  stopEndMonitor();
  const endSeconds = Number(currentSource?.endSeconds);
  if (!Number.isFinite(endSeconds) || endSeconds <= 0) return;
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
  if (playerReady && player) player.stopVideo();
  if ($("#player-panel")) $("#player-panel").hidden = true;
  setPlayerVideoVisible(true);
}

function getYouTubeInfo(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");
    let id = "";
    if (host === "youtu.be") id = parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (host.endsWith("youtube.com")) {
      if (parsed.pathname === "/watch") id = parsed.searchParams.get("v") || "";
      else {
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (["embed", "shorts", "live"].includes(parts[0])) id = parts[1] || "";
      }
    }
    return /^[\w-]{6,}$/.test(id) ? { id } : null;
  } catch {
    return null;
  }
}

function youtubeThumbnailUrl(id, fileName = "hqdefault.jpg") {
  return "https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/" + fileName;
}

function getSourceStartSeconds(source) {
  const direct = Number(source?.startSeconds);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  try {
    const parsed = new URL(source?.url || "");
    return parseTimeValue(parsed.searchParams.get("t") || parsed.searchParams.get("start"));
  } catch {
    return 0;
  }
}

function parseTimeValue(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = String(value).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function getActiveSummary() {
  const parts = [state.mode === "quick" ? "すぐ聴ける曲" : "全記録"];
  if (state.selectedTypes.size) parts.push([...state.selectedTypes].join("・"));
  if (state.selectedSings.size) parts.push([...state.selectedSings].join("・"));
  if (state.favoritesOnly) parts.push("お気に入り");
  if (state.query) parts.push(`「${state.query}」`);
  return `${parts.join(" / ")}を表示中`;
}

function updatePageTopButton() {
  const button = $("#page-top");
  if (button) button.classList.toggle("is-visible", window.scrollY > 500);
}

function parseDate(value) {
  if (!value) return 0;
  const time = Date.parse(String(value).replace(/\//g, "-"));
  return Number.isFinite(time) ? time : 0;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLowerCase().trim();
}

function normalizeSortText(value) {
  return String(value || "").normalize("NFKC").trim();
}

function asArray(value) {
  if (Array.isArray(value)) { return value.filter(
        item =>
        item !== null &&
        item !== undefined &&
        item !== ""
    );
  }
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) { return [];}
  return String(value) .split(",") .map(item => item.trim()) .filter(Boolean);}

function renderMemo(value) {
  return escapeHtml(value).replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label, url) => `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
