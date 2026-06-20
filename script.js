let animeList = JSON.parse(localStorage.getItem('myAnimeListFullstackV1')) || [];
let currentSelectedAnime = null;
let currentSortCriteria = 'date_desc';
let typingTimer;
const doneTypingInterval = 500;

// Die URL unseres Servers (Vercel erkennt relative Pfade automatisch!)
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
                        const title = anime.title;
                        const slug = generateSlug(title);
                        const imageUrl = (anime.images && anime.images.jpg) ? anime.images.jpg.large_image_url : null;
                        
                        const item = document.createElement('div');
                        item.className = 'autocomplete-item';
                        item.innerText = title;
                        item.onclick = () => selectAnime(title, slug, imageUrl);
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
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function selectAnime(name, slug, image) {
    document.getElementById('animeName').value = name;
    currentSelectedAnime = { name, slug, image };
    document.getElementById('autocompleteList').style.display = 'none';
}

// VOLLAUTOMATISCH: Holt beim Hinzufügen die echten Daten von AniWorld über unser Backend
function addAnime() {
    const nameInput = document.getElementById('animeName');
    if (nameInput.value.trim() === '') return;

    let animeData = currentSelectedAnime || { 
        name: nameInput.value.trim(), 
        slug: generateSlug(nameInput.value.trim()), 
        image: null 
    };

    // Wir erstellen die Karte vorab mit Standardwerten
    const newAnime = {
        id: Date.now(),
        name: animeData.name,
        slug: animeData.slug,
        image: animeData.image,
        activeTab: 1,
        isLoading: true, // Zeigt einen Lade-Status an
        seasons: [{ number: 1, episodes: 12 }],
        watchedEpisodes: []
    };

    animeList.push(newAnime);
    nameInput.value = '';
    currentSelectedAnime = null;
    saveAndRender();

    // Jetzt fragen wir im Hintergrund den Server nach den echten AniWorld-Daten
    fetch(`${API_BASE}?slug=${newAnime.slug}`)
        .then(res => res.json())
        .then(data => {
            const anime = animeList.find(a => a.id === newAnime.id);
            if (anime) {
                anime.isLoading = false;
                anime.seasons = [];
                // Erstelle automatisch alle Staffeln, die auf AniWorld gefunden wurden!
                for (let i = 1; i <= data.totalSeasons; i++) {
                    anime.seasons.push({ 
                        number: i, 
                        episodes: i === 1 ? data.totalEpisodes : 12 // Staffel 1 bekommt direkt die echten Folgen
                    });
                }
                saveAndRender();
            }
        });
}

function addAnimeFromData(name, slug, image) {
    if (animeList.some(a => a.slug === slug)) return;
    currentSelectedAnime = { name, slug, image };
    addAnime();
}

// VOLLAUTOMATISCH: Wenn du das Tab wechselst, schaut der Server nach, wie viele Folgen die neue Staffel hat
function switchTab(animeId, seasonNumber) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    anime.activeTab = seasonNumber;
    const seasonData = anime.seasons.find(s => s.number === seasonNumber);

    // Wenn wir die Folge noch nicht überprüft haben (sie steht noch auf dem Standardwert 12)
    if (seasonData && !seasonData.isVerified) {
        anime.isLoading = true;
        renderList();

        fetch(`${API_BASE}?slug=${anime.slug}&season=${seasonNumber}`)
            .then(res => res.json())
            .then(data => {
                anime.isLoading = false;
                seasonData.episodes = data.totalEpisodes;
                seasonData.isVerified = true; // Markieren, damit wir nicht doppelt fragen müssen
                saveAndRender();
            }).catch(() => {
                anime.isLoading = false;
                renderList();
            });
    } else {
        saveAndRender();
    }
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

function changeSort() {
    currentSortCriteria = document.getElementById('sortCriteria').value;
    renderList();
}

function saveAndRender() {
    localStorage.setItem('myAnimeListFullstackV1', JSON.stringify(animeList));
    renderList();
}

function renderList() {
    const grid = document.getElementById('animeGrid');
    grid.innerHTML = '';

    let sortedList = [...animeList];
    if (currentSortCriteria === 'name_asc') {
        sortedList.sort((a, b) => a.name.localeCompare(b.name));
    } else if (currentSortCriteria === 'progress_desc') {
        sortedList.sort((a, b) => b.watchedEpisodes.length - a.watchedEpisodes.length);
    } else {
        sortedList.sort((a, b) => b.id - a.id);
    }

    sortedList.forEach(anime => {
        const curSeason = anime.activeTab || 1;
        const seasonData = anime.seasons.find(s => s.number === curSeason) || anime.seasons[0];
        const maxBoxen = seasonData.episodes;

        let nächsteFolge = 1;
        while (anime.watchedEpisodes.includes(`s${curSeason}e${nächsteFolge}`) && nächsteFolge <= maxBoxen) {
            nächsteFolge++;
        }
        if (nächsteFolge > maxBoxen) nächsteFolge = maxBoxen;

        let geschauteInStaffel = anime.watchedEpisodes.filter(key => key.startsWith(`s${curSeason}e`)).length;
        let prozent = Math.min(100, Math.round((geschauteInStaffel / maxBoxen) * 100));

        const streamUrl = `https://aniworld.to/anime/stream/${anime.slug}/staffel-${curSeason}/episode-${nächsteFolge}`;
        const searchUrl = `https://aniworld.to/support/suche?q=${encodeURIComponent(anime.name)}`;

        const card = document.createElement('div');
        card.className = 'anime-card';
        
        const posterHtml = anime.image 
            ? `<img class="anime-poster" src="${anime.image}" alt="Poster">`
            : `<div class="placeholder-poster">📺</div>`;

        let tabsHtml = '';
        anime.seasons.forEach(s => {
            const isActive = s.number === curSeason ? 'active' : '';
            tabsHtml += `<button class="tab-btn ${isActive}" onclick="switchTab(${anime.id}, ${s.number})">St. ${s.number}</button>`;
        });

        let epGridHtml = '';
        if (anime.isLoading) {
            epGridHtml = '<div style="grid-column: span 6; text-align:center; color:#fa5252; font-size:13px; padding: 20px 0;">🔄 Synchronisiere mit AniWorld...</div>';
        } else {
            for (let i = 1; i <= maxBoxen; i++) {
                const isWatched = anime.watchedEpisodes.includes(`s${curSeason}e${i}`) ? 'watched' : '';
                epGridHtml += `<button class="episode-badge ${isWatched}" onclick="toggleEpisode(${anime.id}, ${curSeason}, ${i})">${i}</button>`;
            }
        }

        card.innerHTML = `
            <div class="anime-header-block">
                ${posterHtml}
                <div class="anime-info">
                    <h3 class="anime-title">${anime.name}</h3>
                    <div class="anime-meta">${anime.isLoading ? 'Lädt...' : `Gesehen: ${geschauteInStaffel} / ${maxBoxen} Folgen`}</div>
                    <div class="anime-meta" style="font-size: 11px;">Haken Gesamt: 🏆 ${anime.watchedEpisodes.length}</div>
                </div>
            </div>

            <div class="season-tabs">${tabsHtml}</div>

            <div class="progress-container">
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${prozent}%"></div>
                </div>
            </div>

            <div class="episode-box-title">Staffel ${curSeason} Episoden:</div>
            <div class="episode-grid-container">
                <div class="episode-grid">${epGridHtml}</div>
            </div>
            
            <div class="card-actions">
                <a href="${streamUrl}" target="_blank" class="stream-link">St. ${curSeason} Folge ${nächsteFolge} schauen</a>
                <a href="${searchUrl}" target="_blank" class="search-fallback">Auf AniWorld suchen</a>
                <button onclick="removeAnime(${anime.id})" style="background:transparent; border:none; color:#555; font-size:11px; cursor:pointer; margin-top:5px;">Löschen</button>
            </div>
        `;
        grid.appendChild(card);
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
                    const title = anime.title;
                    const slug = generateSlug(title);
                    const image = (anime.images && anime.images.jpg) ? anime.images.jpg.large_image_url : null;
                    const totalEps = anime.episodes || null;

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

