let animeList = JSON.parse(localStorage.getItem('myAnimeList FullstackV5')) || [];
let currentSelectedAnime = null;
let currentSortCriteria = localStorage.getItem('myAnimeListSort') || 'date_desc';
let typingTimer;
const doneTypingInterval = 500;
let currentRecommendations = [];

const API_BASE = '/api/anime';
const episodeCache = {};
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 Minuten

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

    typingTimer = setTimeout(() => {
        fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(input)}&limit=5`)
            .then(res => res.json())
            .then(data => {
                list.innerHTML = '';
                if (data.data && data.data.length > 0) {
                    data.data.forEach(anime => {
                        const jpTitle = anime.title;
                        const engTitle = anime.title_english;
                        const displayTitle = engTitle ? `${engTitle} (${jpTitle})` : jpTitle;
                        const name = engTitle || jpTitle;
                        const imageUrl = anime.images?.jpg?.large_image_url || null;

                        const item = document.createElement('div');
                        item.className = 'autocomplete-item';
                        item.innerText = displayTitle;
                        item.onclick = () => selectAnime(name, imageUrl, jpTitle);
                        list.appendChild(item);
                    });
                } else {
                    list.innerHTML = '<div class="autocomplete-info">Keine Ergebnisse gefunden</div>';
                }
            }).catch(() => {
                list.innerHTML = '<div class="autocomplete-info">! Verbindung fehlgeschlagen.</div>';
            });
    }, doneTypingInterval);
}

function selectAnime(name, image, jpTitle) {
    document.getElementById('animeName').value = name;
    currentSelectedAnime = { name, image, jpTitle, slug: null };
    document.getElementById('autocompleteList').style.display = 'none';
}

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
        watchedEpisodes: []
    };

    animeList.unshift(newAnime);
    nameInput.value = "";
    currentSelectedAnime = null;
    saveAndRender();

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
                } catch (e) { /* Fehler behoben: (e) hinzugefügt */ }
            }

            anime.slug = pickBestSlug(allResults, name);
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
            anime.isLoading = false;
            anime.notOnAniworld = true;
            anime.hasWarning = false;
            anime.seasons = [];
            saveAndRender();
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
    } catch (e) { /* Fehler behoben: (e) hinzugefügt */ }
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
    if (!anime.watchedEpisodes.includes(epKey)) anime.watchedEpisodes.push(epKey);
    const seasonData = anime.seasons.find(s => s.number === tabNum);
    const maxBoxen = seasonData ? seasonData.episodes : 12;

    if (epNum === maxBoxen && tabNum < anime.seasons.length) {
        anime.activeTab = tabNum + 1;
        localStorage.setItem('myAnimeList FullstackV5', JSON.stringify(animeList));
        switchTab(animeId, tabNum + 1);
    } else {
        localStorage.setItem('myAnimeList FullstackV5', JSON.stringify(animeList));
        setTimeout(() => renderList(), 300);
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
    saveAndRender();
}

function removeAnime(id) {
    animeList = animeList.filter(a => a.id !== id);
    saveAndRender();
}

function changeSort() {
    currentSortCriteria = document.getElementById('sortCriteria').value;
    localStorage.setItem('myAnimeListSort', currentSortCriteria);
    renderList();
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

function renderList() {
    const grid = document.getElementById('animeGrid');
    const scrollPositions = {};

    animeList.forEach(a => {
        const c = document.getElementById(`epScroll_${a.id}`);
        if (c) scrollPositions[a.id] = c.scrollTop;
    });

    grid.innerHTML = '';
    let sorted = [...animeList];

    switch (currentSortCriteria) {
        case 'name_asc':
            sorted.sort((a, b) => a.name.localeCompare(b.name));
            break;
        case 'name_desc':
            sorted.sort((a, b) => b.name.localeCompare(a.name));
            break;
        case 'progress_desc':
            sorted.sort((a, b) => b.watchedEpisodes.length - a.watchedEpisodes.length);
            break;
        case 'progress_asc':
            sorted.sort((a, b) => a.watchedEpisodes.length - b.watchedEpisodes.length);
            break;
        case 'date_asc':
            sorted.sort((a, b) => a.id - b.id);
            break;
        case 'date_desc':
        default:
            sorted.sort((a, b) => b.id - a.id);
            break;
    }

    sorted.sort((a, b) => (isAnimeCompletelyFinished(a) ? 1 : 0) - (isAnimeCompletelyFinished(b) ? 1 : 0));

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
                const label = n;
                return `<button class="episode-badge ${watched}" onclick="toggleEpisode(this,${anime.id},${curTab},${n})">${label}</button>`;
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
            <div class="card-actions">
                ${actionButtonHtml}
                <div style="display: flex; justify-content:space-between;margin-top:12px;">
                    <a href="${searchUrl}" target="_blank" class="search-fallback">Auf AniWorld suchen</a>
                    <div style="display: flex; gap:10px;">
                        <button onclick="toggleEdit(${anime.id})" style="background:transparent;border:none;color:var(--text-muted); font-size:12px;cursor:pointer;font-weight:600;">Bearbeiten</button>
                        <button onclick="removeAnime(${anime.id})" style="background:transparent; border:none;color:#ff4757;font-size:12px; cursor:pointer;font-weight:600;">Löschen</button>
                    </div>
                </div>
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

async function startupRefresh() {
    for (const anime of animeList) {
        if (anime.notOnAniworld || anime.isLoading || !anime.seasons?.length) continue;
        const activeTab = anime.activeTab || anime.seasons[0]?.number || 1;
        await checkForNewEpisodes(anime.id, activeTab);
    }
    localStorage.setItem('myAnimeList FullstackV5', JSON.stringify(animeList));
    renderList();
    loadRecommendations();
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

// Visual Dropdown-Stand setzen & App starten
document.getElementById('sortCriteria').value = currentSortCriteria;
startupRefresh();
