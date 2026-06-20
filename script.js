let animeList = JSON.parse(localStorage.getItem('myAnimeList')) || [];

function saveAndRender() {
    localStorage.setItem('myAnimeList', JSON.stringify(animeList));
    renderList();
}

function addAnime() {
    const nameInput = document.getElementById('animeName');
    const epInput = document.getElementById('currentEpisode');
    
    if (nameInput.value.trim() === '') return; // Verhindert leere Einträge

    const newAnime = {
        id: Date.now(),
        name: nameInput.value.trim(),
        episode: parseInt(epInput.value)
    };

    animeList.push(newAnime);
    nameInput.value = '';
    epInput.value = '1';
    saveAndRender();
}

function addEpisode(id) {
    const anime = animeList.find(a => a.id === id);
    if (anime) {
        anime.episode += 1;
        saveAndRender();
    }
}

function removeAnime(id) {
    animeList = animeList.filter(a => a.id !== id);
    saveAndRender();
}

// Baut den AniWorld Link zusammen (Geht standardmäßig von Staffel 1 aus)
function generateAniWorldLink(name, episode) {
    const formattedName = name.toLowerCase().replace(/ /g, "-");
    return `https://aniworld.to/anime/stream/${formattedName}/staffel-1/episode-${episode}`;
}

function renderList() {
    const grid = document.getElementById('animeGrid');
    grid.innerHTML = '';

    animeList.forEach(anime => {
        const streamUrl = generateAniWorldLink(anime.name, anime.episode);
        
        const card = document.createElement('div');
        card.className = 'anime-card';
        card.innerHTML = `
            <h3 class="anime-title">${anime.name}</h3>
            <div class="controls">
                <span>Folge: <b>${anime.episode}</b></span>
                <button class="ep-btn" onclick="addEpisode(${anime.id})">+ 1 Folge</button>
            </div>
            <a href="${streamUrl}" target="_blank" class="stream-link">
                Folge ${anime.episode} schauen
            </a>
            <button onclick="removeAnime(${anime.id})" style="background-color: transparent; border: 1px solid #555; color: #888; margin-top: 10px;">Löschen</button>
        `;
        grid.appendChild(card);
    });
}

// Lädt die Liste beim Starten der Seite
renderList();
