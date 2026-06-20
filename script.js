let animeList = JSON.parse(localStorage.getItem('myAnimeListPro')) || [];
let currentSelectedAnime = null;
let typingTimer;
const doneTypingInterval = 400;

function showSuggestions() {
    clearTimeout(typingTimer);
    const input = document.getElementById('animeName').value.trim();
    const list = document.getElementById('autocompleteList');
    
    if (input.length < 3) {
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
                        const slug = title.toLowerCase()
                            .replace(/[^a-z0-9\s-]/g, '')
                            .replace(/\s+/g, '-')
                            .replace(/-+/g, '-');
                        
                        // Wir holen uns jetzt zusätzlich das Poster-Bild und die Gesamtfolgen
                        const imageUrl = anime.images.jpg.large_image_url;
                        const totalEps = anime.episodes || null; // null bedeutet "läuft noch"

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
            .catch(err => console.error("Fehler:", err));
    }, doneTypingInterval);
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
            id: Date.now(),
            name: currentSelectedAnime.name,
            slug: currentSelectedAnime.slug,
            image: currentSelectedAnime.image,
            totalEps: currentSelectedAnime.totalEps,
            watchedEpisodes: [] // Hier speichern wir alle abgehakten Folgen (z.B. [1, 2, 4])
        };
    } else {
        // Fallback falls manuell eingetippt
        let txt = nameInput.value.trim();
        newAnime = {
            id: Date.now(),
            name: txt,
            slug: txt.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-'),
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

// Schaltet den Status einer einzelnen Episode um (An/Aus)
function toggleEpisode(animeId, epNum) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const index = anime.watchedEpisodes.indexOf(epNum);
    if (index === -1) {
        anime.watchedEpisodes.push(epNum); // Folge hinzufügen
    } else {
        anime.watchedEpisodes.splice(index, 1); // Folge wieder entfernen
    }
    saveAndRender();
}

function removeAnime(id) {
    animeList = animeList.filter(a => a.id !== id);
    saveAndRender();
}

function saveAndRender() {
    localStorage.setItem('myAnimeListPro', JSON.stringify(animeList));
    renderList();
}

function renderList() {
    const grid = document.getElementById('animeGrid');
    grid.innerHTML = '';

    animeList.forEach(anime => {
        // Berechne wie viele Boxen wir anzeigen müssen
        // Wenn der Anime endlos läuft, zeigen wir immer die höchste geschaute Folge + 6 Boxen an
        let maxBoxen = anime.totalEps;
        if (!maxBoxen) {
            let höchsteGeschaut = anime.watchedEpisodes.length > 0 ? Math.max(...anime.watchedEpisodes) : 0;
            maxBoxen = Math.max(12, höchsteGeschaut + 6);
        }

        // Finde die erste Folge heraus, die NOCH NICHT geschaut wurde für den "Weiterschauen"-Button
        let nächsteFolge = 1;
        while (anime.watchedEpisodes.includes(nächsteFolge)) {
            nächsteFolge++;
        }

        // Fortschritt berechnen
        let prozent = 0;
        if (anime.totalEps > 0) {
            prozent = Math.round((anime.watchedEpisodes.length / anime.totalEps) * 100);
        }

        const streamUrl = `https://aniworld.to/anime/stream/${anime.slug}/staffel-1/episode-${nächsteFolge}`;
        const searchUrl = `https://aniworld.to/support/suche?q=${encodeURIComponent(anime.name)}`;

        const card = document.createElement('div');
        card.className = 'anime-card';
        
        // HTML für das Episoden-Grid generieren
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

document.addEventListener('click', function(e) {
    if (e.target.id !== 'animeName') {
        document.getElementById('autocompleteList').style.display = 'none';
    }
});
 
renderList();
