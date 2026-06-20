let animeList = JSON.parse(localStorage.getItem('myAnimeListFullstackV2')) || [];
let currentSelectedAnime = null;
let currentSortCriteria = 'date_desc';
let typingTimer;
const doneTypingInterval = 500;

const API_BASE = '/api/anime';

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
                        const slugTitle = engTitle || jpTitle;
                        const slug = generateSlug(slugTitle);
                        const imageUrl = (anime.images && anime.images.jpg) ? anime.images.jpg.large_image_url : null;
                        
                        const item = document.createElement('div');
                        item.className = 'autocomplete-item';
                        item.innerText = displayTitle;
                        item.onclick = () => selectAnime(engTitle || jpTitle, slug, imageUrl);
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

function generateSlug(title) {
    return title.toLowerCase()
        .replace(/\([^)]+\)/g, '') 
        .replace(/[^a-z0-9\s-]/g, '') 
        .trim() 
        .replace(/\s+/g, '-') 
        .replace(/-+/g, '-'); 
}

function selectAnime(name, slug, image) {
    document.getElementById('animeName').value = name;
    currentSelectedAnime = { name, slug, image };
    document.getElementById('autocompleteList').style.display = 'none';
}

function addAnime() {
    const nameInput = document.getElementById('animeName');
    if (!currentSelectedAnime && nameInput.value.trim() === '') return;

    let animeData = currentSelectedAnime || { 
        name: nameInput.value.trim(), 
        slug: generateSlug(nameInput.value.trim()), 
        image: null 
    };

    const newAnime = {
        id: Date.now(),
        name: animeData.name,
        slug: animeData.slug,
        image: animeData.image,
        activeTab: 1,
        isLoading: true,
        isEditing: false,
        hasWarning: false,
        seasons: [{ number: 1, episodes: 12 }],
        watchedEpisodes: []
    };

    animeList.push(newAnime);
    nameInput.value = '';
    currentSelectedAnime = null;
    saveAndRender();

    fetch(`${API_BASE}?slug=${newAnime.slug}`)
        .then(res => res.json())
        .then(data => {
            const anime = animeList.find(a => a.id === newAnime.id);
            if (!anime) return;
            
            anime.isLoading = false;

            if (data.exists === false) {
                fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(anime.name)}&limit=1`)
                    .then(r => r.json())
                    .then(jData => {
                        if(jData.data && jData.data.length > 0) {
                            anime.seasons = [{ number: 1, episodes: jData.data[0].episodes || 12, isVerified: true }];
                        }
                        anime.hasWarning = true;
                        saveAndRender();
                    }).catch(() => {
                        anime.hasWarning = true;
                        saveAndRender();
                    });
            } else {
                anime.seasons = [];
                const maxS = data.totalSeasons || 1;
                for (let i = 1; i <= maxS; i++) {
                    anime.seasons.push({ 
                        number: i, 
                        episodes: i === 1 ? (data.totalEpisodes || 12) : 12,
                        isVerified: i === 1 ? !data.fallback : false
                    });
                }
                if (data.fallback) anime.hasWarning = true;
                saveAndRender();
            }
        }).catch(() => {
            const anime = animeList.find(a => a.id === newAnime.id);
            if (anime) { anime.isLoading = false; anime.hasWarning = true; saveAndRender(); }
        });
}

function addAnimeFromData(name, slug, image) {
    if (animeList.some(a => a.slug === slug)) {
        alert("Diesen Anime hast du bereits auf deiner Liste!");
        return;
    }
    currentSelectedAnime = { name, slug, image };
    addAnime();
}

function switchTab(animeId, seasonNumber) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    anime.activeTab = seasonNumber;
    const seasonData = anime.seasons.find(s => s.number === seasonNumber);

    if (seasonData && !seasonData.isVerified) {
        anime.isLoading = true;
        renderList();

        fetch(`${API_BASE}?slug=${anime.slug}&season=${seasonNumber}`)
            .then(res => res.json())
            .then(data => {
                anime.isLoading = false;
                if(data.exists !== false && !data.fallback) {
                    seasonData.episodes = data.totalEpisodes;
                    seasonData.isVerified = true;
                    saveAndRender();
                } else {
                    fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(anime.name + " Season " + seasonNumber)}&limit=1`)
                        .then(r => r.json())
                        .then(jData => {
                            if(jData.data && jData.data.length > 0) {
                                seasonData.episodes = jData.data[0].episodes || 12;
                            }
                            seasonData.isVerified = true;
                            saveAndRender(); 
                        }).catch(() => {
                            seasonData.isVerified = true;
                            saveAndRender();
                        });
                }
            }).catch(() => {
                anime.isLoading = false;
                seasonData.isVerified = true;
                renderList();
            });
    } else {
        saveAndRender();
    }
}

function watchEpisodeAuto(animeId, seasonNum, epNum) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const epKey = `s${seasonNum}e${epNum}`;
    if (!anime.watchedEpisodes.includes(epKey)) {
        anime.watchedEpisodes.push(epKey);
    }
    
    localStorage.setItem('myAnimeListFullstackV2', JSON.stringify(animeList));
    setTimeout(() => { renderList(); }, 300);
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
    renderList(); 
    
    fetch(`${API_BASE}?slug=${anime.slug}`)
        .then(res => res.json())
        .then(data => {
            anime.isLoading = false;
            if(data.exists === false) {
                anime.hasWarning = true;
            } else {
                anime.seasons = [];
                for (let i = 1; i <= (data.totalSeasons || 1); i++) {
                    anime.seasons.push({ 
                        number: i, 
                        episodes: i === 1 ? (data.totalEpisodes || 12) : 12,
                        isVerified: i === 1 ? !data.fallback : false
                    });
                }
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
    
    const inputEps = document.getElementById(`editEps_${id}_${seasonNum}`).value;
    let eps = parseInt(inputEps);
    if (isNaN(eps) || eps < 1) eps = 1;
    
    const seasonData = anime.seasons.find(s => s.number === seasonNum);
    if (seasonData) {
        seasonData.episodes = eps;
        seasonData.isVerified = true; 
    }
    anime.isEditing = false;
    anime.hasWarning = false;
    saveAndRender();
}

function toggleEpisode(animeId, seasonNum, epNum) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const epKey = `s${seasonNum}e${epNum}`;
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

function isCurrentSeasonFinished(anime) {
    if (anime.isLoading || !anime.seasons) return false;
    const curSeason = anime.activeTab || 1;
    const seasonData = anime.seasons.find(s => s.number === curSeason) || anime.seasons[0];
    const maxBoxen = seasonData.episodes;
    
    const geschauteInStaffel = anime.watchedEpisodes.filter(key => key.startsWith(`s${curSeason}e`)).length;
    return geschauteInStaffel >= maxBoxen && maxBoxen > 0;
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
    animeList.forEach(anime => {
        const container = document.getElementById(`epScroll_${anime.id}`);
        if (container) {
            scrollPositions[anime.id] = container.scrollTop;
        }
    });

    grid.innerHTML = '';

    let sortedList = [...animeList];
    if (currentSortCriteria === 'name_asc') {
        sortedList.sort((a, b) => a.name.localeCompare(b.name));
    } else if (currentSortCriteria === 'progress_desc') {
        sortedList.sort((a, b) => b.watchedEpisodes.length - a.watchedEpisodes.length);
    } else {
        sortedList.sort((a, b) => b.id - a.id);
    }

    sortedList.sort((a, b) => {
        const aDone = isCurrentSeasonFinished(a) ? 1 : 0;
        const bDone = isCurrentSeasonFinished(b) ? 1 : 0;
        return aDone - bDone; 
    });

    sortedList.forEach(anime => {
        const curSeason = anime.activeTab || 1;
        const seasonData = anime.seasons.find(s => s.number === curSeason) || anime.seasons[0];
        const maxBoxen = seasonData.episodes;

        let nächsteFolge = 1;
        while (anime.watchedEpisodes.includes(`s${curSeason}e${nächsteFolge}`) && nächsteFolge <= maxBoxen) {
            nächsteFolge++;
        }
        
        const isFinished = isCurrentSeasonFinished(anime);
        if (nächsteFolge > maxBoxen) nächsteFolge = maxBoxen;

        let geschauteInStaffel = anime.watchedEpisodes.filter(key => key.startsWith(`s${curSeason}e`)).length;
        let prozent = Math.min(100, Math.round((geschauteInStaffel / maxBoxen) * 100));

        const streamUrl = `https://aniworld.to/anime/stream/${anime.slug}/staffel-${curSeason}/episode-${nächsteFolge}`;
        const searchUrl = `https://aniworld.to/support/suche?q=${encodeURIComponent(anime.name)}`;

        const card = document.createElement('div');
        card.className = 'anime-card';
        
        if (isFinished) {
            card.style.opacity = "0.45";
            card.style.filter = "saturate(0.7)";
            card.style.borderColor = "var(--success)";
        }

        const posterHtml = anime.image 
            ? `<img class="anime-poster" src="${anime.image}" alt="Poster">`
            : `<div class="placeholder-poster">📺</div>`;

        let tabsHtml = '';
        anime.seasons.forEach(s => {
            const isActive = s.number === curSeason ? 'active' : '';
            tabsHtml += `<button class="tab-btn ${isActive}" onclick="switchTab(${anime.id}, ${s.number})">St. ${s.number}</button>`;
        });

        const warningHtml = anime.hasWarning 
            ? `<div style="color: #ffaa00; font-size: 11px; margin-top: 4px; font-weight: bold;">⚠️ Link unbestätigt (Backup aktiv)</div>` 
            : '';

        const statusMetaHtml = isFinished 
            ? `<div style="color: var(--success); font-weight: 800; font-size: 12px; margin-top: 4px;">🎉 STAFFEL BEENDET!</div>`
            : `<div class="anime-meta">${anime.isLoading ? 'Lädt...' : `Gesehen: ${geschauteInStaffel} / ${maxBoxen} Folgen`}</div>`;

        let contentAreaHtml = '';
        
        if (anime.isEditing) {
            contentAreaHtml = `
                <div style="padding: 15px 20px; background: rgba(0,0,0,0.2); border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); margin-bottom: 15px;">
                    <div style="margin-bottom: 15px;">
                        <label style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:bold;">AniWorld Link-Name (Slug):</label>
                        <div style="display:flex; gap:8px; margin-top:6px;">
                            <input type="text" id="editSlug_${anime.id}" value="${anime.slug}" style="padding: 8px 12px; font-size:13px; flex-grow:1; background:var(--bg-main); color:white; border:1px solid var(--border-color); border-radius:8px;">
                            <button onclick="resyncAnime(${anime.id})" style="padding: 8px 16px; background:var(--accent); color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">↻ Sync</button>
                        </div>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:bold;">Folgen in St. ${curSeason}:</label>
                        <div style="display:flex; gap:8px; margin-top:6px;">
                            <input type="number" id="editEps_${anime.id}_${curSeason}" value="${maxBoxen}" min="1" style="padding: 8px 12px; font-size:13px; width:80px; background:var(--bg-main); color:white; border:1px solid var(--border-color); border-radius:8px;">
                            <button onclick="saveManualEps(${anime.id}, ${curSeason})" style="padding: 8px 16px; background:var(--success); color:#000; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">Speichern</button>
                        </div>
                    </div>
                    <button onclick="toggleEdit(${anime.id})" style="width:100%; padding: 10px; background:transparent; color:var(--text-muted); border:1px solid var(--border-color); border-radius:8px; cursor:pointer; font-weight:bold;">Schließen</button>
                </div>
            `;
        } else if (anime.isLoading) {
            contentAreaHtml = '<div style="text-align:center; color:var(--accent); font-size:13px; padding: 30px 0; font-weight:600;">🔄 Synchronisiere mit AniWorld...</div>';
        } else {
            let epGridHtml = '';
            for (let i = 1; i <= maxBoxen; i++) {
                const isWatched = anime.watchedEpisodes.includes(`s${curSeason}e${i}`) ? 'watched' : '';
                epGridHtml += `<button class="episode-badge ${isWatched}" onclick="toggleEpisode(${anime.id}, ${curSeason}, ${i})">${i}</button>`;
            }
            contentAreaHtml = `
                <div class="episode-box-title">Staffel ${curSeason} Episoden:</div>
                <div class="episode-grid-container" id="epScroll_${anime.id}">
                    <div class="episode-grid">${epGridHtml}</div>
                </div>
            `;
        }

        // --- NEU: Dynamische und fehlerfreie Button-Logik ---
        let actionButtonHtml = '';
        if (isFinished) {
            // Wir prüfen, ob auf AniWorld überhaupt noch eine Folgestaffel existiert
            const totalAvailableSeasons = anime.seasons ? anime.seasons.length : 1;
            
            if (curSeason < totalAvailableSeasons) {
                // Es gibt eine Folgestaffel -> Button erlaubt das Weiterklicken
                actionButtonHtml = `<button class="stream-link" style="width:100%; border:none; background-color: var(--success); box-shadow: 0 4px 12px rgba(46, 213, 115, 0.2);" onclick="switchTab(${anime.id}, ${curSeason + 1})">Nächste Staffel checken 🎉</button>`;
            } else {
                // Es gibt KEINE weitere Staffel mehr -> Der Button wird deaktiviert und feiert das Ende der Serie!
                actionButtonHtml = `<div class="stream-link" style="background: linear-gradient(135deg, #gold, #d4af37); background-color: #d4af37; color: #000; cursor: default; box-shadow: none; font-weight:800; text-shadow: 0 1px 2px rgba(255,255,255,0.4);">🏆 SERIE KOMPLETT BEENDET!</div>`;
            }
        } else {
            // Normaler Fall: Serie läuft noch
            actionButtonHtml = `<a href="${streamUrl}" target="_blank" class="stream-link" onclick="watchEpisodeAuto(${anime.id}, ${curSeason}, ${nächsteFolge})">St. ${curSeason} Folge ${nächsteFolge} schauen</a>`;
        }

        card.innerHTML = `
            <div class="anime-header-block">
                ${posterHtml}
                <div class="anime-info">
                    <h3 class="anime-title">${anime.name}</h3>
                    ${statusMetaHtml}
                    <div class="anime-meta" style="font-size: 11px; margin-top:4px;">Haken Gesamt: 🏆 ${anime.watchedEpisodes.length}</div>
                    ${warningHtml}
                </div>
            </div>

            <div class="season-tabs">${tabsHtml}</div>

            <div class="progress-container">
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${prozent}%"></div>
                </div>
            </div>

            ${contentAreaHtml}
            
            <div class="card-actions">
                ${actionButtonHtml}
                <div style="display:flex; justify-content:space-between; margin-top:12px;">
                    <a href="${searchUrl}" target="_blank" class="search-fallback">🔍 Auf AniWorld suchen</a>
                    <div style="display:flex; gap:10px;">
                        <button onclick="toggleEdit(${anime.id})" style="background:transparent; border:none; color:var(--text-muted); font-size:12px; cursor:pointer; font-weight:600;">⚙️ Bearbeiten</button>
                        <button onclick="removeAnime(${anime.id})" style="background:transparent; border:none; color:#ff4757; font-size:12px; cursor:pointer; font-weight:600;">🗑️ Löschen</button>
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    animeList.forEach(anime => {
        const container = document.getElementById(`epScroll_${anime.id}`);
        if (container && scrollPositions[anime.id]) {
            container.scrollTop = scrollPositions[anime.id];
        }
    });
}

function loadRecommendations() {
    const recGrid = document.getElementById('recommendationsGrid');
    fetch('https://api.jikan.moe/v4/top/anime?limit=4')
        .then(res => res.json())
        .then(data => {
            recGrid.innerHTML = '';
            if (data.data) {
                data.data.forEach(anime => {
                    const jpTitle = anime.title;
                    const engTitle = anime.title_english;
                    const title = engTitle || jpTitle;
                    const slug = generateSlug(title);
                    const image = (anime.images && anime.images.jpg) ? anime.images.jpg.large_image_url : null;

                    const posterHtml = image ? `<img class="anime-poster" src="${image}" alt="Poster">` : `<div class="placeholder-poster">📺</div>`;

                    const card = document.createElement('div');
                    card.className = 'anime-card';
                    card.innerHTML = `
                        <div class="anime-header-block" style="padding-bottom: 5px;">
                            ${posterHtml}
                            <div class="anime-info">
                                <h3 class="anime-title">${title}</h3>
                                <div class="anime-meta">Score: ⭐ ${anime.score || 'N/A'}</div>
                            </div>
                        </div>
                        <div class="card-actions" style="border-top: none;">
                            <button class="recommendation-btn" onclick="addAnimeFromData('${title.replace(/'/g, "\\'")}', '${slug}', '${image}')">+ Hinzufügen</button>
                        </div>
                    `;
                    recGrid.appendChild(card);
                });
            }
        }).catch(err => console.error(err));
}

document.addEventListener('click', function(e) {
    if (e.target.id !== 'animeName') {
        document.getElementById('autocompleteList').style.display = 'none';
    }
});

renderList();
loadRecommendations();
