let animeList = JSON.parse(localStorage.getItem('myAnimeListUltimateV2')) || [];
let currentSelectedAnime = null;
let currentSortCriteria = 'date_desc';
let typingTimer;
const doneTypingInterval = 500;

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
            .then(response => {
                if (!response.ok) throw new Error("Rate Limit");
                return response.json();
            })
            .then(data => {
                list.innerHTML = '';
                if (data.data && data.data.length > 0) {
                    data.data.forEach(anime => {
                        const title = anime.title;
                        const slug = generateSlug(title);
                        const imageUrl = (anime.images && anime.images.jpg) ? anime.images.jpg.large_image_url : null;
                        const totalEps = anime.episodes || 12; // Falls null (laufend), standardmäßig erstmal 12 setzen

                        const item = document.createElement('div');
                        item.className = 'autocomplete-item';
                        item.innerText = title;
                        item.onclick = () => selectAnime(title, slug, imageUrl, totalEps);
                        list.appendChild(item);
                    });
                } else {
                    list.innerHTML = '<div class="autocomplete-info">Keine Ergebnisse gefunden</div>';
                }
            })
            .catch(err => {
                console.error(err);
                list.innerHTML = '<div class="autocomplete-info">⚠️ Zu schnell getippt. Warte kurz...</div>';
            });
    }, doneTypingInterval);
}

function generateSlug(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function selectAnime(name, slug, image, totalEps) {
    document.getElementById('animeName').value = name;
    currentSelectedAnime = { name, slug, image, totalEps };
    document.getElementById('autocompleteList').style.display = 'none';
}

function addAnime() {
    const nameInput = document.getElementById('animeName');
    if (nameInput.value.trim() === '') return;

    let newAnime;
    if (currentSelectedAnime && nameInput.value.trim() === currentSelectedAnime.name) {
        // NEU: Wir legen eine Konfigurationskarte für die Staffeln an
        const initialEps = currentSelectedAnime.totalEps || 12;
        newAnime = {
            id: Date.now(),
            name: currentSelectedAnime.name,
            slug: currentSelectedAnime.slug,
            image: currentSelectedAnime.image,
            season: 1,
            seasonConfigs: { 1: initialEps }, // Speichert { staffelNummer: maxFolgen }
            watchedEpisodes: []
        };
    } else {
        let txt = nameInput.value.trim();
        newAnime = {
            id: Date.now(),
            name: txt,
            slug: generateSlug(txt),
            image: null,
            season: 1,
            seasonConfigs: { 1: 12 },
            watchedEpisodes: []
        };
    }

    animeList.push(newAnime);
    nameInput.value = '';
    currentSelectedAnime = null;
    saveAndRender();
}

function addAnimeFromData(name, slug, image, totalEps) {
    if (animeList.some(a => a.slug === slug)) {
        alert("Diesen Anime hast du bereits auf deiner Liste!");
        return;
    }

    const initialEps = totalEps || 12;
    const newAnime = {
        id: Date.now(),
        name: name,
        slug: slug,
        image: image,
        season: 1,
        seasonConfigs: { 1: initialEps },
        watchedEpisodes: []
    };

    animeList.push(newAnime);
    saveAndRender();
}

function toggleEpisode(animeId, seasonNum, epNum) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const epKey = `s${seasonNum}e${epKeyNum = epNum}`;
    const index = anime.watchedEpisodes.indexOf(epKey);
    
    if (index === -1) {
        anime.watchedEpisodes.push(epKey);
    } else {
        anime.watchedEpisodes.splice(index, 1);
    }
    saveAndRender();
}

function changeSeason(animeId, delta) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;
    
    let newSeason = anime.season + delta;
    if (newSeason < 1) newSeason = 1;
    
    anime.season = newSeason;
    
    // Falls für die neue Staffel noch keine Folgenanzahl existiert, mit 12 initialisieren
    if (!anime.seasonConfigs[newSeason]) {
        anime.seasonConfigs[newSeason] = 12;
    }
    
    saveAndRender();
}

// NEU: Erlaubt es, die Folgenanzahl der aktuellen Staffel live im Kasten anzupassen
function updateSeasonEps(animeId, seasonNum, value) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;
    
    let eps = parseInt(value);
    if (isNaN(eps) || eps < 1) eps = 1;
    
    anime.seasonConfigs[seasonNum] = eps;
    localStorage.setItem('myAnimeListUltimateV2', JSON.stringify(animeList));
    // Wir rendern nur die Liste neu, ohne den Fokus vom Input zu klauen
    renderList(); 
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
    localStorage.setItem('myAnimeListUltimateV2', JSON.stringify(animeList));
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
        const curSeason = anime.season || 1;
        
        // NEU: Holt die exakte Folgenanzahl aus der Konfiguration dieser spezifischen Staffel
        if (!anime.seasonConfigs) { anime.seasonConfigs = { 1: 12 }; } // Abwärtskompatibilität
        const maxBoxen = anime.seasonConfigs[curSeason] || 12;

        // Nächste ungesehene Folge berechnen
        let nächsteFolge = 1;
        while (anime.watchedEpisodes.includes(`s${curSeason}e${nächsteFolge}`)) {
            nächsteFolge++;
        }

        // Ladebalken berechnen
        let geschauteInStaffel = anime.watchedEpisodes.filter(key => key.startsWith(`s${curSeason}e`)).length;
        let prozent = Math.min(100, Math.round((geschauteInStaffel / maxBoxen) * 100));

        const streamUrl = `https://aniworld.to/anime/stream/${anime.slug}/staffel-${curSeason}/episode-${nächsteFolge}`;
        const searchUrl = `https://aniworld.to/support/suche?q=${encodeURIComponent(anime.name)}`;

        const card = document.createElement('div');
        card.className = 'anime-card';
        
        const posterHtml = anime.image 
            ? `<img class="anime-poster" src="${anime.image}" alt="Poster">`
            : `<div class="placeholder-poster">📺</div>`;

        let epGridHtml = '';
        for (let i = 1; i <= maxBoxen; i++) {
            const isWatched = anime.watchedEpisodes.includes(`s${curSeason}e${i}`) ? 'watched' : '';
            epGridHtml += `<button class="episode-badge ${isWatched}" onclick="toggleEpisode(${anime.id}, ${curSeason}, ${i})">${i}</button>`;
        }

        card.innerHTML = `
            <div class="anime-header-block">
                ${posterHtml}
                <div class="anime-info">
                    <h3 class="anime-title">${anime.name}</h3>
                    <div class="anime-meta">Gesehen: ${geschauteInStaffel} / ${maxBoxen} Folgen</div>
                    
                    <div class="season-control">
                        <button class="season-btn" onclick="changeSeason(${anime.id}, -1)">-</button>
                        <span class="anime-meta"><b>Staffel ${curSeason}</b></span>
                        <button class="season-btn" onclick="changeSeason(${anime.id}, 1)">+</button>
                    </div>

                    <div class="episode-config-inline">
                        <span>Folgen:</span>
                        <input type="number" min="1" value="${maxBoxen}" oninput="updateSeasonEps(${anime.id}, ${curSeason}, this.value)">
                    </div>
                </div>
            </div>

            <div class="progress-container">
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${prozent}%"></div>
                </div>
            </div>

            <div class="episode-box-title">Staffel ${curSeason} Episoden:</div>
            <div class="episode-grid-container">
                <div class="episode-grid">
                    ${epGridHtml}
                </div>
            </div>
            
            <div class="card-actions">
                <a href="${streamUrl}" target="_blank" class="stream-link">St. ${curSeason} Folge ${nächsteFolge} schauen</a>
                <a href="${searchUrl}" target="_blank" class="search-fallback">Link kaputt? Auf AniWorld suchen</a>
                <button onclick="removeAnime(${anime.id})" style="background:transparent; border:none; color:#555; font-size:11px; cursor:pointer; margin-top:5px;">Anime Löschen</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function loadRecommendations() {
    const recGrid = document.getElementById('recommendationsGrid');
    fetch('https://api.jikan.moe/v4/top/anime?limit=4')
        .then(response => response.json())
        .then(data => {
            recGrid.innerHTML = '';
            if (data.data) {
                data.data.forEach(anime => {
                    const title = anime.title;
                    const slug = generateSlug(title);
                    const image = (anime.images && anime.images.jpg) ? anime.images.jpg.large_image_url : null;
                    const totalEps = anime.episodes || null;

                    const posterHtml = image 
                        ? `<img class="anime-poster" src="${image}" alt="Poster">`
                        : `<div class="placeholder-poster">📺</div>`;

                    const card = document.createElement('div');
                    card.className = 'anime-card';
                    card.innerHTML = `
                        <div class="anime-header-block" style="padding-bottom: 5px;">
                            ${posterHtml}
                            <div class="anime-info">
                                <h3 class="anime-title">${title}</h3>
                                <div class="anime-meta">Score: ⭐ ${anime.score || 'N/A'}</div>
                                <div class="anime-meta">Typ: ${anime.type} (${totalEps || '∞'} Eps)</div>
                            </div>
                        </div>
                        <div class="card-actions" style="border-top: none;">
                            <button class="recommendation-btn" onclick="addAnimeFromData('${title.replace(/'/g, "\\'")}', '${slug}', '${image}', ${totalEps})">+ In meine Liste</button>
                        </div>
                    `;
                    recGrid.appendChild(card);
                });
            }
        })
        .catch(err => console.error("Fehler bei Empfehlungen:", err));
}

document.addEventListener('click', function(e) {
    if (e.target.id !== 'animeName') {
        document.getElementById('autocompleteList').style.display = 'none';
    }
});

renderList();
loadRecommendations();
