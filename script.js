let animeList = JSON.parse(localStorage.getItem('myAnimeList FullstackV5')) || [];
let currentSelectedAnime = null;
let currentSortCriteria = localStorage.getItem('myAnimeListSort') || 'last_active';
let currentViewTab = 'active'; 
let typingTimer;
const doneTypingInterval = 500;
let currentRecommendations = [];

const API_BASE = '/api/anime';
const episodeCache = {};
const CACHE_TTL_MS = 10 * 60 * 1000;

function generateSlug(title) {
    return title.toLowerCase()
        .replace(/\([^)]+\)/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function bigrams(str) {
    const s = str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const b = new Set();
    for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2));
    return b;
}

function similarity(a, b) {
    const ba = bigrams(a);
    const bb = bigrams(b);
    if (ba.size === 0 && bb.size === 0) return 1;
    if (ba.size === 0 || bb.size === 0) return 0;
    const intersection = [...ba].filter(x => bb.has(x)).length;
    const union = new Set([...ba, ...bb]).size;
    return intersection / union;
}

function pickBestSlug(searchResults, queryName) {
    const generated = generateSlug(queryName);
    let best = null;
    let bestScore = -1;
    for (const r of searchResults) {
        const slugScore = similarity(r.slug, generated);
        const titleScore = r.title ? similarity(r.title, queryName) : 0;
        const combined = Math.max(slugScore, titleScore * 0.9);
        if (combined > bestScore) {
            bestScore = combined;
            best = r.slug;
        }
    }
    return best;
}

// --- SUCHFUNKTION (AniList API statt Jikan/MAL) ---
// Jikan/MyAnimeList verarbeitet keine Suchanfragen unter 3 Zeichen und liefert
// dann immer ein leeres Ergebnis. AniList (GraphQL, kostenlos, kein Auth nötig)
// hat dieses Limit nicht und liefert Romaji-, Englisch- und Originaltitel mit,
// wodurch Suche ab 1 Buchstaben und in mehreren Sprachen funktioniert.
const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const ANILIST_SEARCH_QUERY = `
query ($search: String) {
  Page(perPage: 8) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      title {
        romaji
        english
        native
      }
      coverImage {
        large
      }
    }
  }
}`;

function renderSuggestionItems(list, items) {
    list.innerHTML = '';
    items.forEach(({ name, displayTitle, imageUrl, jpTitle }) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.innerText = displayTitle;
        item.onclick = () => selectAnime(name, imageUrl, jpTitle);
        list.appendChild(item);
    });
}

function normalizeAniListResults(media) {
    return media.map(anime => {
        const romaji = anime.title.romaji;
        const engTitle = anime.title.english;
        const nativeTitle = anime.title.native;
        const displayTitle = engTitle && engTitle !== romaji
            ? `${engTitle} (${romaji})`
            : romaji || engTitle || nativeTitle;
        return {
            name: engTitle || romaji || nativeTitle,
            displayTitle,
            imageUrl: anime.coverImage?.large || null,
            jpTitle: romaji || nativeTitle
        };
    });
}

function normalizeJikanResults(entries) {
    return entries.map(anime => {
        const jpTitle = anime.title;
        const engTitle = anime.title_english;
        return {
            name: engTitle || jpTitle,
            displayTitle: engTitle ? `${engTitle} (${jpTitle})` : jpTitle,
            imageUrl: anime.images?.jpg?.large_image_url || null,
            jpTitle
        };
    });
}

async function fetchAniListSuggestions(query) {
    const res = await fetch(ANILIST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: ANILIST_SEARCH_QUERY, variables: { search: query } })
    });
    const json = await res.json();
    console.log('[AniList] response:', json);
    if (json.errors && json.errors.length > 0) {
        throw new Error('AniList: ' + json.errors.map(e => e.message).join(', '));
    }
    const media = json?.data?.Page?.media || [];
    return normalizeAniListResults(media);
}

async function fetchJikanSuggestions(query) {
    const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=6`);
    const json = await res.json();
    console.log('[Jikan] response:', json);
    return normalizeJikanResults(json.data || []);
}

function showSuggestions() {
    clearTimeout(typingTimer);
    const input = document.getElementById('animeName').value.trim();
    const list = document.getElementById('autocompleteList');

    if (input.length === 0) {
        list.innerHTML = '';
        list.style.display = 'none';
        return;
    }

    list.innerHTML = '<div class="autocomplete-info">Suche läuft...</div>';
    list.style.display = 'block';

    typingTimer = setTimeout(async () => {
        let results = [];
        let aniListError = null;

        try {
            results = await fetchAniListSuggestions(input);
        } catch (e) {
            aniListError = e.message;
            console.error('[AniList] Fehler:', e);
        }

        // Fallback auf Jikan, falls AniList nichts liefert (z.B. bei >=3 Zeichen)
        if (results.length === 0 && input.length >= 3) {
            try {
                results = await fetchJikanSuggestions(input);
            } catch (e) {
                console.error('[Jikan] Fehler:', e);
            }
        }

        if (results.length > 0) {
            renderSuggestionItems(list, results);
        } else if (aniListError) {
            list.innerHTML = `<div class="autocomplete-info">! Fehler: ${aniListError}</div>`;
        } else {
            list.innerHTML = '<div class="autocomplete-info">Keine Ergebnisse gefunden</div>';
        }
    }, doneTypingInterval);
}

function selectAnime(name, image, jpTitle) {
    document.getElementById('animeName').value = name;
    currentSelectedAnime = { name, image, jpTitle, slug: null };
    document.getElementById('autocompleteList').style.display = 'none';
}
// -----------------------------------------------------------

async function addAnime() {
    const nameInput = document.getElementById('animeName');
    const inputVal = nameInput.value.trim();
    if (!currentSelectedAnime && inputVal === "") return;

    const name = currentSelectedAnime?.name || inputVal;
    const image = currentSelectedAnime?.image || null;
    const jpTitle = currentSelectedAnime?.jpTitle || null;

    const newAnime = {
        id: Date.now(),
        name,
        slug: generateSlug(name),
        image,
        activeTab: 1,
        isLoading: true,
        isEditing: false,
        hasWarning: false,
        notOnAniworld: false,
        seasons: [{ number: 1, episodes: 0, isVerified: false, isFilm: false, displayName: 'St. 1', aniWorldSeason: 1 }],
        watchedEpisodes: [],
        lastActive: Date.now()
    };

    animeList.unshift(newAnime);
    nameInput.value = "";
    currentSelectedAnime = null;
    
    switchMainTab('active');

    const searchQuery = jpTitle || name;
    try {
        const searchResp = await fetch(`${API_BASE}?search=${encodeURIComponent(searchQuery)}`).then(r => r.json());
        const anime = animeList.find(a => a.id === newAnime.id);
        if (!anime) return;

        if (searchResp.results && searchResp.results.length > 0) {
            let allResults = searchResp.results;
            if (jpTitle && jpTitle !== name) {
                try {
                    const r2 = await fetch(`${API_BASE}?search=${encodeURIComponent(name)}`).then(r => r.json());
                    if (r2.results?.length) allResults = [...allResults, ...r2.results];
                } catch (e) {}
            }

            let bestSlug = pickBestSlug(allResults, name);
            if (!bestSlug) bestSlug = generateSlug(name);
            anime.slug = bestSlug;

            const dataResp = await fetch(`${API_BASE}?slug=${anime.slug}`).then(r => r.json());

            if (dataResp.exists) {
                anime.seasons = dataResp.seasons;
                anime.notOnAniworld = false;
                if (dataResp.fallback) anime.hasWarning = true;
                const firstTab = anime.seasons[0];
                if (firstTab) loadEpisodesOnDemand(anime.id, firstTab.number);
            } else {
                anime.isLoading = false;
                anime.notOnAniworld = true;
                anime.hasWarning = false;
                anime.seasons = [];
                saveAndRender();
            }
        } else {
            anime.slug = generateSlug(name);
            const dataResp = await fetch(`${API_BASE}?slug=${anime.slug}`).then(r => r.json());
            
            if (dataResp.exists) {
                anime.seasons = dataResp.seasons;
                anime.notOnAniworld = false;
                if (dataResp.fallback) anime.hasWarning = true;
                const firstTab = anime.seasons[0];
                if (firstTab) loadEpisodesOnDemand(anime.id, firstTab.number);
            } else {
                anime.isLoading = false;
                anime.notOnAniworld = true;
                anime.hasWarning = false;
                anime.seasons = [];
                saveAndRender();
            }
        }
    } catch (e) {
        const anime = animeList.find(a => a.id === newAnime.id);
        if (anime) {
            anime.isLoading = false;
            anime.hasWarning = true;
            saveAndRender();
        }
    }
}

async function loadEpisodesOnDemand(animeId, tabNumber) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const seasonData = anime.seasons.find(s => s.number === tabNumber);
    if (!seasonData || seasonData.isVerified) {
        anime.isLoading = false;
        saveAndRender();
        return;
    }

    anime.isLoading = true;
    renderList();

    try {
        let res;
        if (seasonData.isFilm) {
            res = await fetch(`${API_BASE}?slug=${anime.slug}&getEpisodesForSeason=film`).then(r => r.json());
        } else {
            const aniWorldSeason = seasonData.aniWorldSeason || seasonData.number;
            res = await fetch(`${API_BASE}?slug=${anime.slug}&getEpisodesForSeason=${aniWorldSeason}`).then(r => r.json());
        }
        seasonData.episodes = res.episodes !== undefined ? res.episodes : (seasonData.isFilm ? 1 : 12);
        seasonData.isVerified = true;
    } catch (e) {
        seasonData.episodes = seasonData.isFilm ? 1 : 12;
        seasonData.isVerified = true;
    }
    anime.isLoading = false;
    saveAndRender();
}

async function checkForNewEpisodes(animeId, tabNumber) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime || anime.notOnAniworld) return;

    const seasonData = anime.seasons.find(s => s.number === tabNumber);
    if (!seasonData || seasonData.isFilm || !seasonData.isVerified) return;

    const cacheKey = `${anime.slug}_s${seasonData.aniWorldSeason}`;
    const cached = episodeCache[cacheKey];

    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) return;

    try {
        const aniWorldSeason = seasonData.aniWorldSeason || seasonData.number;
        const res = await fetch(`${API_BASE}?slug=${anime.slug}&getEpisodesForSeason=${aniWorldSeason}`).then(r => r.json());
        const freshCount = res.episodes;
        episodeCache[cacheKey] = { count: freshCount, timestamp: Date.now() };

        if (freshCount && freshCount > seasonData.episodes) {
            seasonData.episodes = freshCount;
            saveAndRender();
            showToast(`${anime.name} - ${seasonData.displayName}: ${freshCount} Folgen verfügbar!`);
        }
    } catch (e) {}
}

function addAnimeFromData(name, slug, image) {
    if (animeList.some(a => a.slug === slug)) {
        alert('Diesen Anime hast du bereits auf deiner Liste!');
        return;
    }
    currentSelectedAnime = { name, image, jpTitle: null, slug };
    addAnime();
}

function switchTab(animeId, tabNumber) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    anime.activeTab = tabNumber;
    checkForNewEpisodes(animeId, tabNumber);
    loadEpisodesOnDemand(animeId, tabNumber);
}

function watchEpisodeAuto(animeId, tabNum, epNum) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const epKey = `s${tabNum}e${epNum}`;
    if (!anime.watchedEpisodes.includes(epKey)) {
        anime.watchedEpisodes.push(epKey);
        anime.lastActive = Date.now();
    }
    
    const seasonData = anime.seasons.find(s => s.number === tabNum);
    const maxBoxen = seasonData ? seasonData.episodes : 12;

    if (epNum === maxBoxen && tabNum < anime.seasons.length) {
        anime.activeTab = tabNum + 1;
        saveAndRender();
        switchTab(animeId, tabNum + 1);
    } else {
        saveAndRender();
    }
}

function toggleEdit(id) {
    const anime = animeList.find(a => a.id === id);
    if (anime) { 
        anime.isEditing = !anime.isEditing; 
        saveAndRender(); 
    }
}

function resyncAnime(id) {
    const anime = animeList.find(a => a.id === id);
    if (!anime) return;

    const newSlug = document.getElementById(`editSlug_${id}`).value.trim();
    if (newSlug !== "") anime.slug = newSlug;

    anime.isLoading = true;
    anime.isEditing = false;
    anime.hasWarning = false;
    anime.notOnAniworld = false;
    renderList();

    fetch(`${API_BASE}?slug=${anime.slug}`)
        .then(r => r.json())
        .then(data => {
            if (data.exists === false) {
                anime.isLoading = false;
                anime.notOnAniworld = true;
                saveAndRender();
            } else {
                anime.seasons = data.seasons;
                anime.notOnAniworld = false;
                anime.activeTab = anime.seasons[0].number || 1;
                loadEpisodesOnDemand(id, anime.activeTab);
            }
        }).catch(() => {
            anime.isLoading = false;
            anime.hasWarning = true;
            saveAndRender();
        });
}

function saveManualEps(id, tabNum) {
    const anime = animeList.find(a => a.id === id);
    if (!anime) return;

    let eps = parseInt(document.getElementById(`editEps_${id}_${tabNum}`).value);
    if (isNaN(eps) || eps < 1) eps = 1;

    const s = anime.seasons.find(s => s.number === tabNum);
    if (s) { s.episodes = eps; s.isVerified = true; }

    anime.isEditing = false;
    anime.hasWarning = false;
    saveAndRender();
}

function addManualSeason(id, isFilm = false) {
    const anime = animeList.find(a => a.id === id);
    if (!anime) return;

    const nextTabNum = anime.seasons.length + 1;
    const existingSeasons = anime.seasons.filter(s => !s.isFilm).length;

    anime.seasons.push({
        number: nextTabNum,
        episodes: isFilm ? 1 : 12,
        isVerified: true,
        isFilm: isFilm,
        displayName: isFilm ? 'Filme' : `St. ${existingSeasons + 1}`,
        aniWorldSeason: isFilm ? null : existingSeasons + 1
    });
    anime.activeTab = nextTabNum;
    saveAndRender();
}

function toggleEpisode(btnElement, animeId, tabNum, epNum) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const epKey = `s${tabNum}e${epNum}`;
    const index = anime.watchedEpisodes.indexOf(epKey);

    if (index === -1) {
        anime.watchedEpisodes.push(epKey);
    } else {
        anime.watchedEpisodes.splice(index, 1);
    }
    
    anime.lastActive = Date.now();
    saveAndRender();
}

function removeAnime(id) {
    animeList = animeList.filter(a => a.id !== id);
    saveAndRender();
}

function changeSort(criteria) {
    currentSortCriteria = criteria;
    localStorage.setItem('myAnimeListSort', currentSortCriteria);
    updateSortPillsUI();
    renderList();
}

function updateSortPillsUI() {
    const pills = document.querySelectorAll('.sort-pill');
    pills.forEach(p => p.classList.remove('active'));
    
    const activePill = document.getElementById('sort_' + currentSortCriteria);
    if (activePill) activePill.classList.add('active');
}

function saveAndRender() {
    localStorage.setItem('myAnimeList FullstackV5', JSON.stringify(animeList));
    renderList();
    renderRecommendations();
}

function showToast(msg) {
    let toast = document.getElementById('toast-container');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-container';
        document.body.appendChild(toast);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerText = msg;
    toast.appendChild(t);

    setTimeout(() => t.classList.add('toast-visible'), 10);
    setTimeout(() => {
        t.classList.remove('toast-visible');
        setTimeout(() => t.remove(), 400);
    }, 4000);
}

function switchMainTab(tabName) {
    currentViewTab = tabName;
    const tabActive = document.getElementById('tab-active');
    const tabCompleted = document.getElementById('tab-completed');
    if(tabActive) tabActive.classList.toggle('active', tabName === 'active');
    if(tabCompleted) tabCompleted.classList.toggle('active', tabName === 'completed');
    renderList(); 
}

function renderList() {
    const grid = document.getElementById('animeGrid');
    if (!grid) return;
    
    const scrollPositions = {};

    animeList.forEach(a => {
        const c = document.getElementById(`epScroll_${a.id}`);
        if (c) scrollPositions[a.id] = c.scrollTop;
    });

    grid.innerHTML = '';
    let sorted = [...animeList];

    if (currentViewTab === 'active') {
        sorted = sorted.filter(a => !isAnimeCompletelyFinished(a));
    } else {
        sorted = sorted.filter(a => isAnimeCompletelyFinished(a));
    }

    if (sorted.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px; font-weight: 600;">Keine Animes in diesem Bereich.</div>`;
        return;
    }

    switch (currentSortCriteria) {
        case 'last_active': 
            sorted.sort((a, b) => (b.lastActive || b.id) - (a.lastActive || a.id)); 
            break;
        case 'progress_percent': 
            sorted.sort((a, b) => {
                const totalA = a.seasons.reduce((sum, s) => sum + s.episodes, 0);
                const pctA = totalA ? a.watchedEpisodes.length / totalA : 0;
                const totalB = b.seasons.reduce((sum, s) => sum + s.episodes, 0);
                const pctB = totalB ? b.watchedEpisodes.length / totalB : 0;
                return pctB - pctA;
            }); 
            break;
        case 'date_desc': 
            sorted.sort((a, b) => b.id - a.id); 
            break;
        case 'name_asc': 
            sorted.sort((a, b) => a.name.localeCompare(b.name)); 
            break;
        default: 
            sorted.sort((a, b) => (b.lastActive || b.id) - (a.lastActive || a.id)); 
            break;
    }

    sorted.forEach(anime => {
        if (anime.notOnAniworld) {
            const card = document.createElement('div');
            card.className = 'anime-card';
            const posterHtml = anime.image
                ? `<img class="anime-poster" src="${anime.image}" alt="Poster" onerror="this.outerHTML='<div class=\\'placeholder-poster\\'></div>'">`
                : '<div class="placeholder-poster"></div>';

            card.innerHTML = `
                <div class="anime-header-block">
                    ${posterHtml}
                    <div class="anime-info">
                        <h3 class="anime-title">${anime.name}</h3>
                        <div class="not-on-aniworld-badge">! Nicht auf AniWorld verfügbar</div>
                        <div class="anime-meta" style="font-size:11px; margin-top:6px;">Der Anime wurde in der Datenbank nicht gefunden.</div>
                    </div>
                </div>
                <div class="card-actions">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <button onclick="toggleEdit(${anime.id})" style="background:transparent;border:1px solid var(--border-color);color:var(--text-muted); font-size:12px; cursor:pointer;font-weight:600;padding:8px 14px;border-radius:8px;">Slug bearbeiten</button>
                        <button onclick="removeAnime(${anime.id})" style="background:transparent; border:none;color:#ff4757;font-size:12px;cursor:pointer;font-weight:600;">Löschen</button>
                    </div>
                    ${anime.isEditing ? `
                    <div style="display: flex; gap:8px;margin-top:10px;">
                        <input type="text" id="editSlug_${anime.id}" value="${anime.slug}" style="padding:8px 12px;font-size:13px; flex-grow:1;background:var(--bg-main);color:white; border:1px solid var(--border-color); border-radius:8px;">
                        <button onclick="resyncAnime(${anime.id})" style="padding:8px 16px;background:var(--accent); color:white; border:none; border-radius:8px;cursor:pointer;font-weight:bold;">Sync</button>
                    </div>` : ''}
                </div>`;
            grid.appendChild(card);
            return;
        }

        const curTab = anime.activeTab || (anime.seasons[0] ? anime.seasons[0].number : 1);
        const seasonData = anime.seasons.find(s => s.number === curTab) || anime.seasons[0];
        if (!seasonData) return;

        const maxBoxen = seasonData.episodes;
        const isFilmType = seasonData.isFilm === true;
        let nachsteFolge = 1;
        while (anime.watchedEpisodes.includes(`s${curTab}e${nachsteFolge}`) && nachsteFolge <= maxBoxen) nachsteFolge++;
        if (nachsteFolge > maxBoxen) nachsteFolge = maxBoxen;

        const isAllFinished = isAnimeCompletelyFinished(anime);
        const geschaut = anime.watchedEpisodes.filter(k => k.startsWith(`s${curTab}e`)).length;
        const prozent = maxBoxen > 0 ? Math.min(100, Math.round((geschaut / maxBoxen) * 100)) : 0;
        const curSeasonFinished = maxBoxen > 0 && geschaut >= maxBoxen;

        let streamUrl;
        if (isFilmType) {
            streamUrl = `https://aniworld.to/anime/stream/${anime.slug}/filme/film-${nachsteFolge}`;
        } else {
            const aniWorldSeason = seasonData.aniWorldSeason || seasonData.number;
            streamUrl = `https://aniworld.to/anime/stream/${anime.slug}/staffel-${aniWorldSeason}/episode-${nachsteFolge}`;
        }

        const searchUrl = `https://aniworld.to/support/suche?q=${encodeURIComponent(anime.name)}`;
        const card = document.createElement('div');
        card.className = 'anime-card';
        if (isAllFinished) {
            card.style.opacity = '0.45';
            card.style.borderColor = 'var(--success)';
        }

        const posterHtml = anime.image
            ? `<img class="anime-poster" src="${anime.image}" alt="Poster" onerror="this.outerHTML='<div class=\\'placeholder-poster\\'></div>'">`
            : '<div class="placeholder-poster"></div>';

        const tabsHtml = anime.seasons.map(s => {
            const active = s.number === curTab ? 'active' : '';
            const tabName = s.displayName || (s.isFilm ? 'Filme' : `St. ${s.aniWorldSeason || s.number}`);
            return `<button class="tab-btn ${active}" onclick="switchTab(${anime.id}, ${s.number})">${tabName}</button>`;
        }).join('');

        const warningHtml = anime.hasWarning
            ? '<div style="color:#ffaa00;font-size:11px;margin-top:4px;font-weight:bold;">! Link unbestätigt</div>'
            : '';

        let statusMetaHtml;
        if (isAllFinished) {
            statusMetaHtml = '<div style="color:#d4af37;font-weight:800;font-size:12px;margin-top:4px;">SERIE KOMPLETT BEENDET!</div>';
        } else if (curSeasonFinished) {
            statusMetaHtml = `<div style="color:var(--success); font-weight:800;font-size:12px;margin-top:4px;">${isFilmType ? 'ALLE FILME' : `STAFFEL ${seasonData.aniWorldSeason || curTab}`} BEENDET!</div>`;
        } else {
            statusMetaHtml = `<div class="anime-meta">${anime.isLoading ? 'Lädt...' : `Gesehen: ${geschaut}/${maxBoxen} ${isFilmType ? 'Filme' : 'Folgen'}`}</div>`;
        }

        let contentAreaHtml;
        if (anime.isEditing) {
            contentAreaHtml = `
                <div style="padding: 15px 20px; background:rgba(0,0,0,0.2); border-top:1px solid var(--border-color);border-bottom:1px solid var(--border-color); margin-bottom:15px;">
                    <div style="margin-bottom:12px;">
                        <label style="font-size:11px;color:var(--text-muted); text-transform:uppercase;font-weight:bold;">AniWorld Slug</label>
                        <div style="display: flex;gap:8px;margin-top:6px;">
                            <input type="text" id="editSlug_${anime.id}" value="${anime.slug}" style="padding:8px 12px;font-size:13px; flex-grow:1;background:var(--bg-main);color:white; border:1px solid var(--border-color); border-radius:8px;">
                            <button onclick="resyncAnime(${anime.id})" style="padding:8px 16px;background:var(--accent); color:white; border:none; border-radius:8px;cursor:pointer;font-weight:bold;">Sync</button>
                        </div>
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="font-size:11px;color:var(--text-muted); text-transform:uppercase;font-weight:bold;">Einträge in aktuellem Tab</label>
                        <div style="display: flex; gap:8px;margin-top:6px;">
                            <input type="number" id="editEps_${anime.id}_${curTab}" value="${maxBoxen}" min="1" style="padding:8px 12px;font-size:13px;width:80px;background:var(--bg-main); color:white; border:1px solid var(--border-color); border-radius:8px;">
                            <button onclick="saveManualEps(${anime.id}, ${curTab})" style="padding:8px 16px;background:var(--success);color:#000;border:none; border-radius:8px;cursor:pointer;font-weight:bold;">Speichern</button>
                        </div>
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:bold;">Tabs verwalten</label>
                        <div style="display:flex;gap:8px;margin-top:6px; flex-wrap:wrap;">
                            <button onclick="addManualSeason(${anime.id}, false)" style="padding:6px 12px;background:var(--bg-input); color:var(--text-main); border:1px solid var(--border-color); border-radius:8px;cursor:pointer;font-size:12px;font-weight:bold;">+ Staffel</button>
                            <button onclick="addManualSeason(${anime.id}, true)" style="padding:6px 12px;background:var(--bg-input); color:var(--text-main); border:1px solid var(--border-color); border-radius:8px;cursor:pointer;font-size:12px;font-weight:bold;">+ Filme</button>
                        </div>
                    </div>
                    <button onclick="toggleEdit(${anime.id})" style="width:100%; padding:10px;background:transparent;color:var(--text-muted); border:1px solid var(--border-color); border-radius:8px;cursor:pointer;font-weight:bold;">Schließen</button>
                </div>`;
        } else if (anime.isLoading) {
            contentAreaHtml = '<div style="text-align:center;color:var(--accent); font-size:13px;padding:30px 0;font-weight:600;">Synchronisiere Daten...</div>';
        } else if (!seasonData.isVerified && maxBoxen === 0) {
            contentAreaHtml = '<div style="text-align:center;color:var(--text-muted); font-size:13px;padding:30px 0;font-weight:600;">Klicke auf den Tab, um Einträge zu laden...</div>';
        } else {
            const epBadges = Array.from({ length: maxBoxen }, (_, i) => {
                const n = i + 1;
                const watched = anime.watchedEpisodes.includes(`s${curTab}e${n}`) ? 'watched' : '';
                return `<button class="episode-badge ${watched}" onclick="toggleEpisode(this,${anime.id},${curTab},${n})">${n}</button>`;
            }).join('');

            contentAreaHtml = `
                <div class="episode-box-title">${isFilmType ? 'FILME:' : `STAFFEL ${seasonData.aniWorldSeason || curTab} - EPISODEN:`}</div>
                <div class="episode-grid-container" id="epScroll_${anime.id}">
                    <div class="episode-grid">${epBadges}</div>
                </div>`;
        }

        let actionButtonHtml = '';
        if (isAllFinished) {
            actionButtonHtml = '<div class="stream-link" style="background:linear-gradient(135deg, #111,#222);color:#747d8c;border:1px solid var(--border-color);cursor:default; font-weight:800;">KOMPLETT GESEHEN</div>';
        } else if (curSeasonFinished && curTab < anime.seasons.length) {
            actionButtonHtml = `<button class="stream-link" style="width:100%;border:none;background-color:var(--success);" onclick="switchTab(${anime.id}, ${curTab + 1})">Nächsten Tab laden</button>`;
        } else if (!curSeasonFinished && maxBoxen > 0) {
            const btnText = isFilmType ? `Film ${nachsteFolge} schauen` : `St. ${seasonData.aniWorldSeason || curTab} Folge ${nachsteFolge} schauen`;
            actionButtonHtml = `<a href="${streamUrl}" target="_blank" class="stream-link" onclick="watchEpisodeAuto(${anime.id}, ${curTab}, ${nachsteFolge})">${btnText}</a>`;
        }

        const bottomActionsHtml = `
            <div class="card-bottom-actions">
                <a href="${searchUrl}" target="_blank" class="action-icon-btn">
                    <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                    Auf AniWorld<br>suchen
                </a>
                <button onclick="toggleEdit(${anime.id})" class="action-icon-btn">
                    <svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>
                    Bearbeiten
                </button>
                <button onclick="removeAnime(${anime.id})" class="action-icon-btn delete">
                    <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    Löschen
                </button>
            </div>
        `;

        card.innerHTML = `
            <div class="anime-header-block">
                ${posterHtml}
                <div class="anime-info">
                    <h3 class="anime-title">${anime.name}</h3>
                    ${statusMetaHtml}
                    <div class="anime-meta" style="font-size:11px; margin-top:4px;">Haken Gesamt: ${anime.watchedEpisodes.length}</div>
                    ${warningHtml}
                </div>
            </div>
            <div class="season-tabs">${tabsHtml}</div>
            <div class="progress-container">
                <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${prozent}%"></div></div>
            </div>
            ${contentAreaHtml}
            <div class="card-actions" style="border-top: none;">
                ${actionButtonHtml}
                ${bottomActionsHtml}
            </div>`;
        
        grid.appendChild(card);
    });

    animeList.forEach(a => {
        const c = document.getElementById(`epScroll_${a.id}`);
        if (c && scrollPositions[a.id]) c.scrollTop = scrollPositions[a.id];
    });
}

function isAnimeCompletelyFinished(anime) {
    if (anime.isLoading || !anime.seasons?.length) return false;
    const total = anime.seasons.reduce((sum, s) => sum + s.episodes, 0);
    return total > 0 && anime.watchedEpisodes.length >= total;
}

function loadRecommendations() {
    fetch('https://api.jikan.moe/v4/top/anime?limit=12')
        .then(r => r.json())
        .then(data => {
            if (data.data) {
                const processed = data.data.map(anime => {
                    let title = anime.title_english || anime.title;
                    const lowerTitle = title.toLowerCase();
                    if (lowerTitle.includes('jojo')) title = "JoJo's Bizarre Adventure";
                    else if (lowerTitle.includes('re:zero') || lowerTitle.includes('re-zero')) title = 'Re:ZERO Starting Life in Another World';
                    else if (lowerTitle.includes('demon slayer')) title = 'Demon Slayer Kimetsu no Yaiba';
                    else if (lowerTitle.includes('attack on titan')) title = 'Attack on Titan';
                    else {
                        title = title.replace(/s(eason)?\s*\d+/gi, '').replace(/part\s*\d+/gi, '').replace(/cour\s*\d+/gi, '').split(':')[0].trim();
                    }
                    return {
                        title,
                        slug: generateSlug(title),
                        image: anime.images?.jpg?.large_image_url || null,
                        score: anime.score || 'N/A'
                    };
                });

                const uniqueRecs = [];
                const seenSlugs = new Set();
                processed.forEach(item => {
                    if (!seenSlugs.has(item.slug)) {
                        seenSlugs.add(item.slug);
                        uniqueRecs.push(item);
                    }
                });
                currentRecommendations = uniqueRecs;
                renderRecommendations();
            }
        }).catch(console.error);
}

function renderRecommendations() {
    const recGrid = document.getElementById('recommendationsGrid');
    if (!recGrid) return;
    recGrid.innerHTML = '';

    const filtered = currentRecommendations.filter(rec => !animeList.some(a => a.slug === rec.slug));
    filtered.slice(0, 4).forEach(rec => {
        const card = document.createElement('div');
        card.className = 'anime-card';
        const posterHtml = rec.image
            ? `<img class="anime-poster" src="${rec.image}" alt="Poster">`
            : '<div class="placeholder-poster"></div>';

        card.innerHTML = `
            <div class="anime-header-block" style="padding-bottom:5px;">
                ${posterHtml}
                <div class="anime-info">
                    <h3 class="anime-title">${rec.title}</h3>
                    <div class="anime-meta">Score: ${rec.score}</div>
                </div>
            </div>
            <div class="card-actions" style="border-top:none;">
                <button class="recommendation-btn" onclick="addAnimeFromData('${rec.title.replace(/'/g, "\\'")}', '${rec.slug}', '${rec.image}')">+ Hinzufügen</button>
            </div>`;
        recGrid.appendChild(card);
    });
}

document.addEventListener('click', e => {
    if (e.target.id !== 'animeName') {
        const list = document.getElementById('autocompleteList');
        if (list) list.style.display = 'none';
    }
});

function startupRefresh() {
    updateSortPillsUI();
    renderList();
    loadRecommendations();

    animeList.forEach(anime => {
        if (anime.notOnAniworld || anime.isLoading || !anime.seasons?.length) return;
        const activeTab = anime.activeTab || anime.seasons[0]?.number || 1;
        checkForNewEpisodes(anime.id, activeTab);
    });
}

function exportData() {
    if (!animeList || animeList.length === 0) {
        if (typeof showToast === 'function') {
            showToast("Keine Daten zum Exportieren vorhanden!");
        } else {
            alert("Keine Daten zum Exportieren vorhanden!");
        }
        return;
    }

    try {
        const dataStr = JSON.stringify(animeList, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        
        const date = new Date().toISOString().split('T')[0];
        a.download = `MyAniList_Backup_${date}.json`;
        
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
        
        if (typeof showToast === 'function') {
            showToast("Backup erfolgreich exportiert!");
        } else {
            alert("Backup erfolgreich exportiert!");
        }
    } catch (error) {
        console.error("Fehler beim Exportieren der Daten:", error);
        alert("Es gab einen Fehler beim Exportieren.");
    }
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (Array.isArray(importedData)) {
                animeList = importedData;
                saveAndRender();
                showToast("Backup erfolgreich geladen!");
            } else {
                alert("Ungültiges Dateiformat!");
            }
        } catch (error) {
            alert("Fehler beim Lesen der Datei.");
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

startupRefresh();
