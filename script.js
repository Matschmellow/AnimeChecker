let animeList = JSON.parse(localStorage.getItem('myAnimeList')) || [];
let selectedSlug = "";

// "Debounce" Timer: Verhindert, dass bei jedem Tastendruck die API bombardiert wird
let typingTimer;
const doneTypingInterval = 400; // Wartet 400ms nach dem letzten Tastendruck

// --- Live API Suche ---
function showSuggestions() {
    clearTimeout(typingTimer);
    const input = document.getElementById('animeName').value.trim();
    const list = document.getElementById('autocompleteList');
    
    // Suche startet erst ab 3 eingegebenen Buchstaben
    if (input.length < 3) {
        list.innerHTML = '';
        list.style.display = 'none';
        return;
    }

    // Startet den Timer
    typingTimer = setTimeout(() => {
        // Wir fragen die weltweite Jikan-Datenbank ab (auf 5 Ergebnisse limitiert)
        fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(input)}&limit=5`)
            .then(response => response.json())
            .then(data => {
                list.innerHTML = '';
                
                if (data.data && data.data.length > 0) {
                    list.style.display = 'block';
                    
                    data.data.forEach(anime => {
                        const title = anime.title; // Der schöne, offizielle Name
                        
                        // Hier bauen wir den Namen so um, wie AniWorld ihn für Links braucht:
                        // Alles klein, Sonderzeichen weg, Leerzeichen zu Bindestrichen
                        const slug = title.toLowerCase()
                            .replace(/[^a-z0-9\s-]/g, '') // Entfernt Symbole wie Doppelpunkte
                            .replace(/\s+/g, '-')         // Ersetzt Leerzeichen durch Bindestriche
                            .replace(/-+/g, '-');         // Verhindert doppelte Bindestriche
                        
                        const item = document.createElement('div');
                        item.className = 'autocomplete-item';
                        item.innerText = title;
                        // Beim Klick merken wir uns den schönen Namen UND den Link-Namen
                        item.onclick = () => selectAnime(title, slug);
                        list.appendChild(item);
                    });
                } else {
                    list.style.style.display = 'none';
                }
            })
            .catch(err => console.error("Fehler beim Laden der Anime-Daten:", err));
    }, doneTypingInterval);
}

// Wird ausgeführt, wenn ein Vorschlag angeklickt wird
function selectAnime(name, slug) {
    document.getElementById('animeName').value = name;
    selectedSlug = slug;
    document.getElementById('autocompleteList').style.display = 'none';
}

// --- Hauptfunktionen ---
function saveAndRender() {
    localStorage.setItem('myAnimeList', JSON.stringify(animeList));
    renderList();
}

function addAnime() {
    const nameInput = document.getElementById('animeName');
    const epInput = document.getElementById('currentEpisode');
    
    if (nameInput.value.trim() === '') return;

    // Fallback: Falls man den Namen komplett selbst eintippt ohne Dropdown
    let finalSlug = selectedSlug;
    if (finalSlug === "") {
        finalSlug = nameInput.value.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
    }

    const newAnime = {
        id: Date.now(),
        name: nameInput.value.trim(),
        slug: finalSlug,
        episode: parseInt(epInput.value),
        watched: false
    };

    animeList.push(newAnime);
    
    // Felder zurücksetzen
    nameInput.value = '';
    epInput.value = '1';
    selectedSlug = ''; 
    saveAndRender();
}

function addEpisode(id) {
    const anime = animeList.find(a => a.id === id);
    if (anime && !anime.watched) {
        anime.episode += 1;
        saveAndRender();
    }
}

function toggleWatched(id) {
    const anime = animeList.find(a => a.id === id);
    if (anime) {
        anime.watched = !anime.watched;
        saveAndRender();
    }
}

function removeAnime(id) {
    animeList = animeList.filter(a => a.id !== id);
    saveAndRender();
}

function renderList() {
    const grid = document.getElementById('animeGrid');
    grid.innerHTML = '';

    animeList.forEach(anime => {
        // 1. Der direkte Link zur Folge
        const streamUrl = `https://aniworld.to/anime/stream/${anime.slug}/staffel-1/episode-${anime.episode}`;
        
        // 2. Der Fallback-Link: Falls der direkte Link fehlschlägt, durchsucht dieser Button AniWorld nach dem Namen
        const searchUrl = `https://aniworld.to/support/suche?q=${encodeURIComponent(anime.name)}`;
        
        const cardClass = anime.watched ? 'anime-card watched' : 'anime-card';
        const btnClass = anime.watched ? 'watched-btn active' : 'watched-btn';
        const btnText = anime.watched ? '✓ Abgeschlossen' : 'Als abgeschlossen markieren';

        const card = document.createElement('div');
        card.className = cardClass;
        card.innerHTML = `
            <h3 class="anime-title">${anime.name}</h3>
            
            <div class="controls">
                <span>Folge: <b>${anime.episode}</b></span>
                <button class="ep-btn" onclick="addEpisode(${anime.id})">+ 1</button>
            </div>
            
            ${!anime.watched ? `<a href="${streamUrl}" target="_blank" class="stream-link">Folge ${anime.episode} schauen</a>` : ''}
            
            ${!anime.watched ? `<a href="${searchUrl}" target="_blank" style="text-align:center; text-decoration:none; color:#fa5252; font-size:12px; margin-top:5px;">Link kaputt? Auf AniWorld suchen</a>` : ''}
            
            <button class="${btnClass}" onclick="toggleWatched(${anime.id})" style="margin-top:10px;">${btnText}</button>
            <button onclick="removeAnime(${anime.id})" style="background-color: transparent; border: none; color: #888; font-size: 12px; margin-top: 5px; cursor:pointer;">Löschen</button>
        `;
        grid.appendChild(card);
    });
}

// Schließt das Dropdown, wenn man irgendwo anders hinklickt
document.addEventListener('click', function(e) {
    if (e.target.id !== 'animeName') {
        document.getElementById('autocompleteList').style.display = 'none';
    }
});

renderList();
