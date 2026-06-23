// api/anime.js (Auszug für die optimierte Logik)
const axios = require('axios');
const cheerio = require('cheerio');

// ... HEADERS wie gehabt ...

async function getVerifiedSlugAndData(query) {
    try {
        // 1. Suche direkt auf AniWorld via AJAX
        const searchUrl = `https://aniworld.to/ajax/search`;
        const { data } = await axios.post(searchUrl, `keyword=${encodeURIComponent(query)}`, {
            headers: { ...HEADERS, 'X-Requested-With': 'XMLHttpRequest' },
            timeout: 4000
        });

        const $ = cheerio.load(data);
        let directSlug = null;
        
        // Nimm den ersten Treffer aus der Suche
        $('a[href*="/anime/stream/"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(/\/anime\/stream\/([^\/]+)\/?$/);
            if (match && !directSlug) {
                directSlug = match[1]; 
            }
        });

        if (directSlug) {
            // Wenn der Slug existiert, holen wir die Staffeln über dein Scrape-System
            const seasons = await scrapeAnimeSeasons(directSlug);
            return { exists: true, slug: directSlug, seasons, fallback: false };
        }
        
        // 2. FALLBACK: Wenn AniWorld-Suche nichts liefert, nutzen wir Jikan (MyAnimeList) 
        // um zumindest die echten Episodendaten für das Dashboard zu haben
        const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`);
        if (jikanRes.data.data && jikanRes.data.data.length > 0) {
            const anime = jikanRes.data.data[0];
            return {
                exists: true,
                slug: query.toLowerCase().replace(/[^a-z0-9]/g, '-'), // Not-Slug
                seasons: [{ number: 1, episodes: anime.episodes || 12, isVerified: false, isFilm: anime.type === 'Movie' }],
                fallback: true // Signalisiert dem Frontend: URL könnte falsch sein!
            };
        }

        return { exists: false };
    } catch (e) {
        return { exists: false, error: e.message };
    }
}

