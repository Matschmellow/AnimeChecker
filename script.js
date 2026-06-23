let animeList = JSON.parse(localStorage.getItem('myAnimeListFullstackV2')) || [];
let currentSelectedAnime = null;
let currentSortCriteria = 'date_desc';
let typingTimer;
const doneTypingInterval = 500;

const API_BASE = '/api/anime';

// Generiert einen standardisierten Backup-Slug
function generateSlug(title) {
    return title.toLowerCase()
        .replace(/\([^)]+\)/g, '')
        .replace(/[^a-z0-9\s-]/g, '')   
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
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

    list.innerHTML = '<div class="autocomplete-info">🔍 Suche läuft...</div>';
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
                list.innerHTML = '<div class="autocomplete-info">⚠️ Verbindung fehlgeschlagen.</div>';
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
    if (!currentSelectedAnime && inputVal === '') return;

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
        seasons: [{ number: 1, episodes: 12, isFilm: false }],
        watchedEpisodes: []
    };

    animeList.push(newAnime);
    nameInput.value = '';
    currentSelectedAnime = null;
    saveAndRender();

    const searchQuery = jpTitle || name;
    try {
        const searchResp = await fetch(`${API_BASE}?search=${encodeURIComponent(searchQuery)}`).then(r => r.json());
        const anime = animeList.find(a => a.id === newAnime.id);
        if (!anime) return;

        let resolvedSlug = null;

        if (searchResp.results && searchResp.results.length > 0) {
            const generated = generateSlug(name);
            resolvedSlug = searchResp.results.reduce((best, candidate) => {
                return similarity(candidate, generated) > similarity(best, generated) ? candidate : best;
            }, searchResp.results[0]);
            anime.slug = resolvedSlug;
        }

        const slug = resolvedSlug || anime.slug;
        const dataResp = await fetch(`${API_BASE}?slug=${slug}`).then(r => r.json());

        anime.isLoading = false;
        if (dataResp.exists) {
            anime.seasons = dataResp.seasons;
            if (dataResp.fallback) anime.hasWarning = true;
        } else {
            anime.hasWarning = true;
        }
        saveAndRender();

    } catch (e) {
        const anime = animeList.find(a => a.id === newAnime.id);
        if (anime) { anime.isLoading = false; anime.hasWarning = true; saveAndRender(); }
    }
}

function similarity(a, b) {
    const setA = new Set(a.split(''));
    const setB = new Set(b.split(''));
    const intersection = [...setA].filter(c => setB.has(c)).length;
    return intersection / Math.max(setA.size, setB.size);
}

function addAnimeFromData(name, slug, image) {
    if (animeList.some(a => a.slug === slug)) {
        alert("Diesen Anime hast du bereits auf deiner Liste!");
        return;
    }
    currentSelectedAnime = { name, image, jpTitle: null, slug };
    const nameInput = document.getElementById('animeName');
    nameInput.value = name;
    addAnime();
}

function switchTab(animeId, seasonNumber) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;
    anime.activeTab = seasonNumber;
    saveAndRender();
}

function watchEpisodeAuto(animeId, seasonNum, epNum) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const epKey = `s${seasonNum}e${epNum}`;
    if (!anime.watchedEpisodes.includes(epKey)) anime.watchedEpisodes.push(epKey);

    const seasonData = anime.seasons.find(s => s.number === seasonNum);
    const maxBoxen = seasonData ? seasonData.episodes : 12;

    if (epNum === maxBoxen && seasonNum < anime.seasons.length) {
        anime.activeTab = seasonNum + 1;
    }
    localStorage.setItem('myAnimeListFullstackV2', JSON.stringify(animeList));
    setTimeout(() => renderList(), 300);
}

function toggleEdit(id) {
    const anime = animeList.find(a => a.id === id);
    if (anime) { anime.isEditing = !anime.isEditing; saveAndRender(); }
}

function resyncAnime(id) {
    const anime = animeList.find(a => a.id === id);
    if (!anime) return;

    const newSlug = document.getElementById(`editSlug_${id}`).value.trim();
    if (newSlug !== '') anime.slug = newSlug;

    anime.isLoading = true;
    anime.isEditing = false;
    anime.hasWarning = false;
    renderList();

    fetch(`${API_BASE}?slug=${anime.slug}`)
        .then(r => r.json())
        .then(data => {
            anime.isLoading = false;
            if (data.exists === false) {
                anime.hasWarning = true;
            } else {
                anime.seasons = data.seasons;
                if (data.fallback) anime.hasWarning = true;
                anime.activeTab = 1;
            }
            saveAndRender();
        }).catch(() => {
            anime.isLoading = false;
            anime.hasWarning = true;
            saveAndRender();
        });
}

function saveManualEps(id, seasonNum) {
    const anime = animeList.find(a => a.id === id);
    if (!anime) return;
    let eps = parseInt(document.getElementById(`editEps_${id}_${seasonNum}`).value);
    if (isNaN(eps) || eps < 1) eps = 1;
    const s = anime.seasons.find(s => s.number === seasonNum);
    if (s) { s.episodes = eps; s.isVerified = true; }
    anime.isEditing = false;
    anime.hasWarning = false;
    saveAndRender();
}

function addManualSeason(id, isFilm) {
    const anime = animeList.find(a => a.id === id);
    if (!anime) return;
    const nextNum = anime.seasons.length + 1;
    anime.seasons.push({
        number: nextNum,
        episodes: isFilm ? 1 : 12,
        isVerified: false,
        isFilm,
        displayName: isFilm ? '🎬 Filme' : undefined
    });
    anime.activeTab = nextNum;
    saveAndRender();
}

function toggleSeasonFilm(id, seasonNum) {
    const anime = animeList.find(a => a.id === id);
    if (!anime) return;
    const s = anime.seasons.find(s => s.number === seasonNum);
    if (s) { s.isFilm = !s.isFilm; s.displayName = s.isFilm ? '🎬 Filme' : undefined; }
    saveAndRender();
}

// PREMIUM UX: Direktes DOM-Toggling verhindert unruhiges Springen der Boxen
function toggleEpisode(btnElement, animeId, seasonNum, epNum) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const epKey = `s${seasonNum}e${epNum}`;
    const index = anime.watchedEpisodes.indexOf(epKey);
    if (index === -1) {
        anime.watchedEpisodes.push(epKey);
        btnElement.classList.add('watched');
    } else {
        anime.watchedEpisodes.splice(index, 1);
        btnElement.classList.remove('watched');
    }

    localStorage.setItem('myAnimeListFullstackV2', JSON.stringify(animeList));

    const curSeason = anime.activeTab || 1;
    const seasonData = anime.seasons.find(s => s.number === curSeason) || anime.seasons[0];
    const geschaut = anime.watchedEpisodes.filter(k => k.startsWith(`s${curSeason}e`)).length;
    
    // Passt die Metadaten live an
    const meta = btnElement.closest('.anime-card')?.querySelector('.anime-meta');
    if (meta && !anime.isLoading) {
        meta.innerText = `Gesehen: ${geschaut} / ${seasonData.episodes} ${seasonData.isFilm ? 'Filme' : 'Folgen'}`;
    }

    // Passt die Progressbar live an
    const progressBarFill = btnElement.closest('.anime-card')?.querySelector('.progress-bar-fill');
    if (progressBarFill && seasonData.episodes > 0) {
        const neueProzent = Math.min(100, Math.round((geschaut / seasonData.episodes) * 100));
        progressBarFill.style.width = `${neueProzent}%`;
    }
}

function removeAnime(id) {
    animeList = animeList.filter(a => a.id !== id);
    saveAndRender();
}

function changeSort() {
    currentSortCriteria = document.getElementById('sortCriteria').value;
    renderList();
}

function saveAndRender() {
    localStorage.setItem('myAnimeListFullstackV2', JSON.stringify(animeList));
    renderList();
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
    if (currentSortCriteria === 'name_asc') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (currentSortCriteria === 'progress_desc') sorted.sort((a, b) => b.watchedEpisodes.length - a.watchedEpisodes.length);
    else sorted.sort((a, b) => b.id - a.id);
    sorted.sort((a, b) => (isAnimeCompletelyFinished(a) ? 1 : 0) - (isAnimeCompletelyFinished(b) ? 1 : 0));

    sorted.forEach(anime => {
        const curSeason = anime.activeTab || 1;
        const seasonData = anime.seasons.find(s => s.number === curSeason) || anime.seasons[0];
        const maxBoxen = seasonData.episodes;
        const isFilmType = seasonData.isFilm || false;

        let nächsteFolge = 1;
        while (anime.watchedEpisodes.includes(`s${curSeason}e${nächsteFolge}`) && nächsteFolge <= maxBoxen) nächsteFolge++;
        if (nächsteFolge > maxBoxen) nächsteFolge = maxBoxen;

        const isAllFinished = isAnimeCompletelyFinished(anime);
        const geschaut = anime.watchedEpisodes.filter(k => k.startsWith(`s${curSeason}e`)).length;
        const prozent = Math.min(100, Math.round((geschaut / maxBoxen) * 100));
        const curSeasonFinished = geschaut >= maxBoxen;

        const pathSegment = isFilmType ? 'film' : `staffel-${curSeason}`;
        const streamUrl = `https://aniworld.to/anime/stream/${anime.slug}/${pathSegment}/episode-${nächsteFolge}`;
        const searchUrl = `https://aniworld.to/support/suche?q=${encodeURIComponent(anime.name)}`;

        const card = document.createElement('div');
        card.className = 'anime-card';
        if (isAllFinished) {
            card.style.opacity = '0.45';
            card.style.filter = 'saturate(0.7)';
            card.style.borderColor = 'var(--success)';
        }

        const posterHtml = anime.image
            ? `<img class="anime-poster" src="${anime.image}" alt="Poster" onerror="this.outerHTML='<div class=\\'placeholder-poster\\'>📺</div>'">`
            : `<div class="placeholder-poster">📺</div>`;

        const tabsHtml = anime.seasons.map(s => {
            const active = s.number === curSeason ? 'active' : '';
            const tabName = s.displayName || `St. ${s.number}`;
            return `<button class="tab-btn ${active}" onclick="switchTab(${anime.id}, ${s.number})">${tabName}</button>`;
        }).join('');

        const warningHtml = anime.hasWarning
            ? `<div style="color:#ffaa00;font-size:11px;margin-top:4px;font-weight:bold;">⚠️ Link unbestätigt – Slug manuell prüfen</div>`
            : '';

        let statusMetaHtml;
        if (isAllFinished) {
            statusMetaHtml = `<div style="color:#d4af37;font-weight:800;font-size:12px;margin-top:4px;">🏆 SERIE KOMPLETT BEENDET!</div>`;
        } else if (curSeasonFinished) {
            statusMetaHtml = `<div style="color:var(--success);font-weight:800;font-size:12px;margin-top:4px;">🎉 ${isFilmType ? 'ALLE FILME' : `STAFFEL ${curSeason}`} BEENDET!</div>`;
        } else {
            statusMetaHtml = `<div class="anime-meta">${anime.isLoading ? 'Lädt...' : `Gesehen: ${geschaut} / ${maxBoxen} ${isFilmType ? 'Filme' : 'Folgen'}`}</div>`;
        }

        let contentAreaHtml;
        if (anime.isEditing) {
            contentAreaHtml = `
                <div style="padding:15px 20px;background:rgba(0,0,0,0.2);border-top:1px solid var(--border-color);border-bottom:1px solid var(--border-color);margin-bottom:15px;">
                    <div style="margin-bottom:12px;">
                        <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:bold;">AniWorld Slug</label>
                        <div style="display:flex;gap:8px;margin-top:6px;">
                            <input type="text" id="editSlug_${anime.id}" value="${anime.slug}" style="padding:8px 12px;font-size:13px;flex-grow:1;background:var(--bg-main);color:white;border:1px solid var(--border-color);border-radius:8px;">
                            <button onclick="resyncAnime(${anime.id})" style="padding:8px 16px;background:var(--accent);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">↻ Sync</button>
                        </div>
                        <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">aniworld.to/anime/stream/<b>${anime.slug}</b></div>
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:bold;">Einträge in aktuellem Tab</label>
                        <div style="display:flex;gap:8px;margin-top:6px;">
                            <input type="number" id="editEps_${anime.id}_${curSeason}" value="${maxBoxen}" min="1" style="padding:8px 12px;font-size:13px;width:80px;background:var(--bg-main);color:white;border:1px solid var(--border-color);border-radius:8px;">
                            <button onclick="saveManualEps(${anime.id}, ${curSeason})" style="padding:8px 16px;background:var(--success);color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">Speichern</button>
                        </div>
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:bold;">Tabs verwalten</label>
                        <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
                            <button onclick="addManualSeason(${anime.id}, false)" style="padding:6px 12px;background:var(--bg-input);color:var(--text-main);border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:12px;font-weight:bold;">+ Staffel</button>
                            <button onclick="addManualSeason(${anime.id}, true)" style="padding:6px 12px;background:var(--bg-input);color:var(--text-main);border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:12px;font-weight:bold;">🎬 + Filme-Tab</button>
                            <button onclick="toggleSeasonFilm(${anime.id}, ${curSeason})" style="padding:6px 12px;background:var(--bg-input);color:${isFilmType ? '#ffaa00' : 'var(--text-muted)'};border:1px solid ${isFilmType ? '#ffaa00' : 'var(--border-color)'};border-radius:8px;cursor:pointer;font-size:12px;font-weight:bold;">${isFilmType ? '🎬 Ist Film' : 'Als Film markieren'}</button>
                        </div>
                    </div>
                    <button onclick="toggleEdit(${anime.id})" style="width:100%;padding:10px;background:transparent;color:var(--text-muted);border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-weight:bold;">Schließen</button>
                </div>`;
        } else if (anime.isLoading) {
            contentAreaHtml = '<div style="text-align:center;color:var(--accent);font-size:13px;padding:30px 0;font-weight:600;">🔄 Synchronisiere mit AniWorld...</div>';
        } else {
            const epBadges = Array.from({ length: maxBoxen }, (_, i) => {
                const n = i + 1;
                const watched = anime.watchedEpisodes.includes(`s${curSeason}e${n}`) ? 'watched' : '';
                return `<button class="episode-badge ${watched}" onclick="toggleEpisode(this,${anime.id},${curSeason},${n})">${n}</button>`;
            }).join('');
            contentAreaHtml = `
                <div class="episode-box-title">${isFilmType ? '🎬 Filme:' : `Staffel ${curSeason} – Episoden:`}</div>
                <div class="episode-grid-container" id="epScroll_${anime.id}">
                    <div class="episode-grid">${epBadges}</div>
                </div>`;
        }

        let actionButtonHtml;
        if (isAllFinished) {
            actionButtonHtml = `<div class="stream-link" style="background:linear-gradient(135deg,#111,#222);color:#747d8c;border:1px solid var(--border-color);cursor:default;font-weight:800;">🏆 KOMPLETT GESEHEN</div>`;
        } else if (curSeasonFinished && curSeason < anime.seasons.length) {
            actionButtonHtml = `<button class="stream-link" style="width:100%;border:none;background-color:var(--success);" onclick="switchTab(${anime.id},${curSeason + 1})">Nächsten Tab laden 🎉</button>`;
        } else if (!curSeasonFinished) {
            const btnText = isFilmType ? `Film ${nächsteFolge} schauen` : `St. ${curSeason} Folge ${nächsteFolge} schauen`;
            actionButtonHtml = `<a href="${streamUrl}" target="_blank" class="stream-link" onclick="watchEpisodeAuto(${anime.id},${curSeason},${nächsteFolge})">${btnText}</a>`;
        } else {
            actionButtonHtml = '';
        }

        card.innerHTML = `
            <div class="anime-header-block">
                ${posterHtml}
                <div class="anime-info">
                    <h3 class="anime-title">${anime.name}</h3>
                    ${statusMetaHtml}
                    <div class="anime-meta" style="font-size:11px;margin-top:4px;">Haken Gesamt: 🏆 ${anime.watchedEpisodes.length}</div>
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
                <div style="display:flex;justify-content:space-between;margin-top:12px;">
                    <a href="${searchUrl}" target="_blank" class="search-fallback">🔍 Auf AniWorld suchen</a>
                    <div style="display:flex;gap:10px;">
                        <button onclick="toggleEdit(${anime.id})" style="background:transparent;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;font-weight:600;">⚙️ Bearbeiten</button>
                        <button onclick="removeAnime(${anime.id})" style="background:transparent;border:none;color:#ff4757;font-size:12px;cursor:pointer;font-weight:600;">🗑️ Löschen</button>
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
    const recGrid = document.getElementById('recommendationsGrid');
    fetch('https://api.jikan.moe/v4/top/anime?limit=4')
        .then(r => r.json())
        .then(data => {
            recGrid.innerHTML = '';
            data.data?.forEach(anime => {
                const title = anime.title_english || anime.title;
                const slug = generateSlug(title);
                const image = anime.images?.jpg?.large_image_url || null;
                const card = document.createElement('div');
                card.className = 'anime-card';
                card.innerHTML = `
                    <div class="anime-header-block" style="padding-bottom:5px;">
                        ${image ? `<img class="anime-poster" src="${image}" alt="Poster">` : `<div class="placeholder-poster">📺</div>`}
                        <div class="anime-info">
                            <h3 class="anime-title">${title}</h3>
                            <div class="anime-meta">Score: ⭐ ${anime.score || 'N/A'}</div>
                        </div>
                    </div>
                    <div class="card-actions" style="border-top:none;">
                        <button class="recommendation-btn" onclick="addAnimeFromData('${title.replace(/'/g, "\\'")}','${slug}','${image}')">+ Hinzufügen</button>
                    </div>`;
                recGrid.appendChild(card);
            });
        }).catch(console.error);
}

document.addEventListener('click', e => {
    if (e.target.id !== 'animeName') document.getElementById('autocompleteList').style.display = 'none';
});

renderList();
loadRecommendations();
