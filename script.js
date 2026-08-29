const songData = [
  { title: "曲名1", artist: "歌手1", ... },
  { title: "曲名2", artist: "歌手2", ... }
];

let songs = [];
let activeFilters = { type: null, vocal: null, oke: null };
let searchQuery = "";
let currentSort = "date-desc";

document.addEventListener("DOMContentLoaded", () => {
  songs = songData;
  initFilters();
  render();

  document.getElementById("sort-select").addEventListener("change", (e) => {
    currentSort = e.target.value;
    render();
  });

  document.getElementById("search-input").addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase();
    render();
  });

  document.getElementById("reset-btn").addEventListener("click", () => {
    activeFilters = { type: null, vocal: null, oke: null };
    searchQuery = "";
    document.getElementById("search-input").value = "";
    document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
    render();
  });
});

function initFilters() {
  setupFilterButtons("filter-type", "type", getUniqueValues("形態"));
  setupFilterButtons("filter-vocal", "vocal", getUniqueValues("歌唱"));
  setupFilterButtons("filter-oke", "oke", getUniqueValues("オケ有無"));
}

function getUniqueValues(key) {
  const values = songs.map(song => song[key]).filter(Boolean);
  return [...new Set(values)];
}

function setupFilterButtons(containerId, filterKey, values) {
  const container = document.getElementById(containerId);
  values.forEach(val => {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.textContent = val;
    btn.addEventListener("click", () => {
      if (activeFilters[filterKey] === val) {
        activeFilters[filterKey] = null;
        btn.classList.remove("active");
      } else {
        container.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
        activeFilters[filterKey] = val;
        btn.classList.add("active");
      }
      render();
    });
    container.appendChild(btn);
  });
}

function render() {
  let filtered = songs.filter(song => {
    if (activeFilters.type && song["形態"] !== activeFilters.type) return false;
    if (activeFilters.vocal && song["歌唱"] !== activeFilters.vocal) return false;
    if (activeFilters.oke && song["オケ有無"] !== activeFilters.oke) return false;
    if (searchQuery) {
      const title = (song["曲名"] || "").toLowerCase();
      const artist = (song["アーティスト名"] || "").toLowerCase();
      if (!title.includes(searchQuery) && !artist.includes(searchQuery)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    switch (currentSort) {
      case "date-desc": return new Date(b["日付"]) - new Date(a["日付"]);
      case "date-asc": return new Date(a["日付"]) - new Date(b["日付"]);
      case "title-asc": return (a["曲名"] || "").localeCompare(b["曲名"] || "", "ja");
      case "title-desc": return (b["曲名"] || "").localeCompare(a["曲名"] || "", "ja");
      case "artist-asc": return (a["アーティスト名"] || "").localeCompare(b["アーティスト名"] || "", "ja");
      case "artist-desc": return (b["アーティスト名"] || "").localeCompare(a["アーティスト名"] || "", "ja");
      default: return 0;
    }
  });

  document.getElementById("count").textContent = filtered.length;
  const listContainer = document.getElementById("song-list");
  listContainer.innerHTML = "";

  filtered.forEach(song => {
    const card = document.createElement("div");
    card.className = "song-card";
    card.innerHTML = `
      <div class="song-header">
        <span>${song["日付"] || ""}</span>
        <span class="badge">${song["形態"] || ""}</span>
        <span class="badge">${song["歌唱"] || ""}</span>
        <span class="badge ${song["オケ有無"] === '有' ? 'oke-yes' : ''}">オケ: ${song["オケ有無"] || "無"}</span>
      </div>
      <div class="song-title">${song["曲名"] || "タイトルなし"}</div>
      <div class="song-artist">${song["アーティスト名"] || ""}</div>
    `;
    listContainer.appendChild(card);
  });
}
