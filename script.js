let animeList = JSON.parse(localStorage.getItem('myAnimeListPro')) || [];
let currentSelectedAnime = null;
let currentSortCriteria = 'date_desc'; // Standard-Sortierung
let typingTimer;
const doneTypingInterval = 400;

// --- Live API Suche für das Eingabefeld ---
function showSuggestions() {
    clearTimeout(typingTimer);
    const input = document.getElementById('animeName').value.trim();
    const list = document.getElementById('autocompleteList');
    
    if (input.length === 0) {
        list.innerHTML = '';
        list.style.display = 'none';
        return;
    }

    typingTimer = setTimeout(() => {
        fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(input)}&limit=5`)
            .then(response => response.json())
            .then(data => {
                list.innerHTML = '';
                if (data.data && data.data.length > 0) {
                    list.style.display = 'block';
                    data.data.forEach(anime => {
                        const title = anime.title;
                        const slug = generateSlug(title);
                        const imageUrl = anime.images.jpg.large_image_url;
                        const totalEps = anime.episodes || null;

                        const item = document.createElement('div');
                        item.className = 'autocomplete-item';
                        item.innerText = title;
                        item.onclick = () => selectAnime(title, slug, imageUrl, totalEps);
                        list.appendChild(item);
                    });
                } else {
                    list.style.display = 'none';
                }
            })
            .catch(err => console.error("Fehler bei Suche:", err));
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
        newAnime = {
            id: Date.now(), // Dient als ID und als Zeitstempel fürs Sortieren
            name: currentSelectedAnime.name,
            slug: currentSelectedAnime.slug,
            image: currentSelectedAnime.image,
            totalEps: currentSelectedAnime.totalEps,
            watchedEpisodes: []
        };
    } else {
        let txt = nameInput.value.trim();
        newAnime = {
            id: Date.now(),
            name: txt,
            slug: generateSlug(txt),
            image: '',
            totalEps: 12,
            watchedEpisodes: []
        };
    }

    animeList.push(newAnime);
    nameInput.value = '';
    currentSelectedAnime = null;
    saveAndRender();
}

// Ermöglicht es, Animes direkt aus den Empfehlungen per Klick hinzuzufügen
function addAnimeFromData(name, slug, image, totalEps) {
    // Prüfen, ob der Anime bereits auf der Liste steht
    if (animeList.some(a => a.slug === slug)) {
        alert("Diesen Anime hast du bereits auf deiner Liste!");
        return;
    }

    const newAnime = {
        id: Date.now(),
        name: name,
        slug: slug,
        image: image,
        totalEps: totalEps,
        watchedEpisodes: []
    };

    animeList.push(newAnime);
    saveAndRender();
}

function toggleEpisode(animeId, epNum) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const index = anime.watchedEpisodes.indexOf(epNum);
    if (index === -1) {
        anime.watchedEpisodes.push(epNum);
    } else {
        anime.watchedEpisodes.splice(index, 1);
    }
    saveAndRender();
}

function removeAnime(id) {
    animeList = animeList.filter(a => a.id !== id);
    saveAndRender();
}

// Wird aufgerufen, wenn der Nutzer das Sortier-Dropdown ändert
function changeSort() {
    currentSortCriteria = document.getElementById('sortCriteria').value;
    renderList();
}

function saveAndRender() {
    localStorage.setItem('myAnimeListPro', JSON.stringify(animeList));
    renderList();
}

function renderList() {
    const grid = document.getElementById('animeGrid');
    grid.innerHTML = '';

    // Wir erstellen eine Kopie der Liste, um das Original-Array im Speicher nicht permanent zu verdrehen
    let sortedList = [...animeList];

    // --- Sortier-Logik ---
    if (currentSortCriteria === 'name_asc') {
        sortedList.sort((a, b) => a.name.localeCompare(b.name)); // A-Z
    } else if (currentSortCriteria === 'progress_desc') {
        sortedList.sort((a, b) => b.watchedEpisodes.length - a.watchedEpisodes.length); // Meiste Folgen zuerst
    } else {
        sortedList.sort((a, b) => b.id - a.id); // Zuletzt hinzugefügt (höhere ID/Zeitstempel zuerst)
    }

    sortedList.forEach(anime => {
        let maxBoxen = anime.totalEps;
        if (!maxBoxen) {
            let höchsteGeschaut = anime.watchedEpisodes.length > 0 ? Math.max(...anime.watchedEpisodes) : 0;
            maxBoxen = Math.max(12, höchsteGeschaut + 6);
        }

        let nächsteFolge = 1;
        while (anime.watchedEpisodes.includes(nächsteFolge)) {
            nächsteFolge++;
        }

        let prozent = 0;
        if (anime.totalEps > 0) {
            prozent = Math.round((anime.watchedEpisodes.length / anime.totalEps) * 100);
        }

        const streamUrl = `https://aniworld.to/anime/stream/${anime.slug}/staffel-1/episode-${nächsteFolge}`;
        const searchUrl = `https://aniworld.to/support/suche?q=${encodeURIComponent(anime.name)}`;

        const card = document.createElement('div');
        card.className = 'anime-card';
        
        let epGridHtml = '';
        for (let i = 1; i <= maxBoxen; i++) {
            const isWatched = anime.watchedEpisodes.includes(i) ? 'watched' : '';
            epGridHtml += `<button class="episode-badge ${isWatched}" onclick="toggleEpisode(${anime.id}, ${i})">${i}</button>`;
        }

        card.innerHTML = `
            <div class="anime-header-block">
                <img class="anime-poster" src="${anime.image || 'https://via.placeholder.com/80x115?text=No+Cover'}" alt="Poster">
                <div class="anime-info">
                    <h3 class="anime-title">${anime.name}</h3>
                    <div class="anime-meta">Gesehen: ${anime.watchedEpisodes.length} / ${anime.totalEps || '∞'} Folgen</div>
                </div>
            </div>

            <div class="progress-container">
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${prozent}%"></div>
                </div>
            </div>

            <div class="episode-box-title">Episoden abhaken:</div>
            <div class="episode-grid-container">
                <div class="episode-grid">
                    ${epGridHtml}
                </div>
            </div>
            
            <div class="card-actions">
                <a href="${streamUrl}" target="_blank" class="stream-link">Folge ${nächsteFolge} schauen</a>
                <a href="${searchUrl}" target="_blank" class="search-fallback">Link kaputt? Auf AniWorld suchen</a>
                <button onclick="removeAnime(${anime.id})" style="background:transparent; border:none; color:#555; font-size:11px; cursor:pointer; margin-top:5px;">Anime Löschen</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

// --- NEU: Empfehlungs-Engine laden ---
function loadRecommendations() {
    const recGrid = document.getElementById('recommendationsGrid');
    
    // Wir holen uns die aktuell globalen Top-Animes über die API
    fetch('https://api.jikan.moe/v4/top/anime?limit=4')
        .then(response => response.json())
        .then(data => {
            recGrid.innerHTML = '';
            if (data.data) {
                data.data.forEach(anime => {
                    const title = anime.title;
                    const slug = generateSlug(title);
                    const image = anime.images.jpg.large_image_url;
                    const totalEps = anime.episodes || null;

                    const card = document.createElement('div');
                    card.className = 'anime-card';
                    card.innerHTML = `
                        <div class="anime-header-block" style="padding-bottom: 5px;">
                            <img class="anime-poster" src="${image}" alt="Poster">
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
        .catch(err => console.error("Fehler beim Laden der Empfehlungen:", err));
}

// Schließt das Dropdown beim Klicken außerhalb
document.addEventListener('click', function(e) {
    if (e.target.id !== 'animeName') {
        document.getElementById('autocompleteList').style.display = 'none';
    }
});

// App-Start
renderList();
loadRecommendations(); // Lädt beim Öffnen direkt die Trends
