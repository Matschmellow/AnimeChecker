let animeList = JSON.parse(localStorage.getItem('myAnimeList')) || [];

// Deine kleine Mini-Datenbank. Hier kannst du beliebig viele Animes hinzufügen!
// 'name' ist das, was schön aussieht. 'slug' ist das, was in der AniWorld URL steht.
const animeDatabase = [
    { name: "Jujutsu Kaisen", slug: "jujutsu-kaisen" },
    { name: "Attack on Titan", slug: "attack-on-titan" },
    { name: "Demon Slayer", slug: "demon-slayer-kimetsu-no-yaiba" },
    { name: "One Piece", slug: "one-piece" },
    { name: "Naruto Shippuden", slug: "naruto-shippuden" },
    { name: "Solo Leveling", slug: "solo-leveling" },
    { name: "My Hero Academia", slug: "my-hero-academia" },
    { name: "Frieren", slug: "frieren-beyond-journeys-end" }
];

let selectedSlug = ""; // Speichert temporär den korrekten Link

// --- Autocomplete Funktion ---
function showSuggestions() {
    const input = document.getElementById('animeName').value.toLowerCase();
    const list = document.getElementById('autocompleteList');
    list.innerHTML = ''; // Liste leeren

    if (input.length === 0) {
        list.style.display = 'none';
        return;
    }

    // Sucht in der Datenbank nach Treffern
    const matches = animeDatabase.filter(anime => anime.name.toLowerCase().includes(input));

    if (matches.length > 0) {
        list.style.display = 'block';
        matches.forEach(match => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.innerText = match.name;
            item.onclick = () => selectAnime(match.name, match.slug);
            list.appendChild(item);
        });
    } else {
        list.style.display = 'none';
    }
}

// Wird ausgeführt, wenn du einen Vorschlag anklickst
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

    // Falls man manuell tippt und nichts aus der Liste wählt, nutzen wir das alte Fallback-System
    let finalSlug = selectedSlug;
    if (finalSlug === "") {
        finalSlug = nameInput.value.toLowerCase().replace(/ /g, "-");
    }

    const newAnime = {
        id: Date.now(),
        name: nameInput.value.trim(),
        slug: finalSlug, // Wir speichern jetzt explizit den URL-Teil!
        episode: parseInt(epInput.value),
        watched: false // Neu: Ist er schon fertig geschaut?
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

// Neu: Toggle für "Gesehen"
function toggleWatched(id) {
    const anime = animeList.find(a => a.id === id);
    if (anime) {
        anime.watched = !anime.watched; // Dreht den Status um (true/false)
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
        // Nutzt jetzt den gespeicherten "slug" für den perfekten Link
        const streamUrl = `https://aniworld.to/anime/stream/${anime.slug}/staffel-1/episode-${anime.episode}`;
        
        // CSS-Klassen abhängig vom "Watched" Status
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
            
            <button class="${btnClass}" onclick="toggleWatched(${anime.id})">${btnText}</button>
            <button onclick="removeAnime(${anime.id})" style="background-color: transparent; border: none; color: #888; font-size: 12px; margin-top: 5px;">Löschen</button>
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
