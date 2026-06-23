const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'de-DE,de;q=0.9',
    'Referer': 'https://aniworld.to/'
};

// 🛠️ Perfekt abgestimmte Master-Datenbank für komplexe Groß-Franchises
const FRANCHISE_MASTER_DATA = {
    're-zero-starting-life-in-another-world': [
        { number: 1, episodes: 25, isVerified: true, isFilm: false },
        { number: 2, episodes: 25, isVerified: true, isFilm: false },
        { number: 3, episodes: 1,  isVerified: true, isFilm: true, displayName: '🎬 Filme' } // Memory Snow + Frozen Bond gebündelt
    ],
    'jojos-bizarre-adventure': [
        { number: 1, episodes: 26, isVerified: true, isFilm: false }, // Phantom Blood / Battle Tendency
        { number: 2, episodes: 24, isVerified: true, isFilm: false }, // Stardust Crusaders
        { number: 3, episodes: 24, isVerified: true, isFilm: false }, // Battle in Egypt
        { number: 4, episodes: 39, isVerified: true, isFilm: false }, // Diamond is Unbreakable
        { number: 5, episodes: 39, isVerified: true, isFilm: false }, // Golden Wind
        { number: 6, episodes: 38, isVerified: true, isFilm: false }  // Stone Ocean / Steel Ball Run Vorbereitung
    ]
};

async function searchAniworld(query) {
    try {
        const url = `https://aniworld.to/ajax/search`;
        const { data } = await axios.post(url, `keyword=${encodeURIComponent(query)}`, {
            headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
            timeout: 4000
        });
        const $ = cheerio.load(data);
        const results = [];
        $('a[href*="/anime/stream/"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(/\/anime\/stream\/([^\/]+)\/?$/);
            if (match) results.push(match[1]);
        });
        return [...new Set(results)];
    } catch (e) {
        return [];
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { slug, search, title } = req.query;

    if (search) {
        const results = await searchAniworld(search);
        return res.status(200).json({ results });
    }

    if (!slug) return res.status(200).json({ exists: false, error: 'Kein Slug' });

    // 1. Checken, ob es sich um ein vordefiniertes Franchise handelt
    if (FRANCHISE_MASTER_DATA[slug]) {
        return res.status(200).json({ exists: true, slug, seasons: FRANCHISE_MASTER_DATA[slug] });
    }

    // 2. Automatisches API-Driven-Modell via Jikan für alle anderen Serien
    try {
        const searchName = title || slug.replace(/-/g, ' ');
        const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(searchName)}&limit=10`);
        
        if (!jikanRes.data.data || jikanRes.data.data.length === 0) {
            throw new Error('Keine API Daten gefunden');
        }

        const items = jikanRes.data.data;
        const seasonsConfig = [];
        let totalTVSeasons = 0;
        let totalMovieCount = 0;

        // Sortieren nach Erscheinungsdatum
        items.sort((a, b) => {
            const dateA = a.aired?.from ? new Date(a.aired.from) : new Date(0);
            const dateB = b.aired?.from ? new Date(b.aired.from) : new Date(0);
            return dateA - dateB;
        });

        items.forEach(item => {
            if (item.type === 'TV' || item.type === 'OVA') {
                totalTVSeasons++;
                seasonsConfig.push({
                    number: totalTVSeasons,
                    episodes: item.episodes || 12,
                    isVerified: true,
                    isFilm: false
                });
            } else if (item.type === 'Movie') {
                totalMovieCount++;
            }
        });

        // Wenn Filme für das Franchise existieren, hängen wir sie gesammelt als letzten Tab an
        if (totalMovieCount > 0) {
            seasonsConfig.push({
                number: totalTVSeasons + 1,
                episodes: totalMovieCount,
                isVerified: true,
                isFilm: true,
                displayName: '🎬 Filme'
            });
        }

        if (seasonsConfig.length === 0) {
            seasonsConfig.push({ number: 1, episodes: 12, isVerified: true, isFilm: false });
        }

        return res.status(200).json({ exists: true, slug, seasons: seasonsConfig });

    } catch (error) {
        // Fallback-Struktur, falls die API down sein sollte
        return res.status(200).json({
            exists: true,
            slug,
            seasons: [
                { number: 1, episodes: 12, isVerified: true, isFilm: false },
                { number: 2, episodes: 12, isVerified: true, isFilm: false },
                { number: 3, episodes: 1, isVerified: true, isFilm: true, displayName: '🎬 Filme' }
            ],
            fallback: true
        });
    }
};
