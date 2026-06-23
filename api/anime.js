const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'de-DE,de;q=0.9',
    'Referer': 'https://aniworld.to/'
};

// Holt die echten Episoden, indem er NUR Links zählt, die den aktuellen Anime-Pfad enthalten
async function fetchEpisodeCount(slug, seasonNum, isFilm) {
    try {
        const path = isFilm ? 'film' : `staffel-${seasonNum}`;
        const url = `https://aniworld.to/anime/stream/${slug}/${path}`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 6000 });
        const $ = cheerio.load(data);

        const episodes = new Set();
        
        // PRÄZISE: Wir suchen NUR Links, die exakt zu diesem Anime-Stream gehören!
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            // Der Link MUSS den exakten Pfad enthalten, z.B. /stream/re-zero.../staffel-1/episode-5
            if (href.includes(`/stream/${slug}/${path}/episode-`)) {
                const match = href.match(/\/episode-(\d+)/);
                if (match) {
                    episodes.add(parseInt(match[1]));
                }
            }
        });

        return episodes.size > 0 ? Math.max(...episodes) : 1;
    } catch (e) {
        return e.response?.status === 404 ? 0 : 1;
    }
}

async function searchAniworld(query) {
    try {
        const url = `https://aniworld.to/ajax/search`;
        const { data } = await axios.post(url, `keyword=${encodeURIComponent(query)}`, {
            headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
            timeout: 5000
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

async function scrapeAnimeSeasons(slug) {
    const url = `https://aniworld.to/anime/stream/${slug}`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 6000 });
    const $ = cheerio.load(data);

    const seasonNums = new Set();
    let hasFilms = false;

    // PRÄZISE: Nur Staffellinks für DIESEN spezifischen Anime zählen
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes(`/stream/${slug}/staffel-`)) {
            const mSeason = href.match(/\/staffel-(\d+)/);
            if (mSeason) seasonNums.add(parseInt(mSeason[1]));
        }
        if (href.includes(`/stream/${slug}/film`)) {
            hasFilms = true;
        }
    });

    const nums = seasonNums.size > 0 ? [...seasonNums].sort((a, b) => a - b) : [1];

    const [seasonResults, filmCount] = await Promise.all([
        Promise.all(nums.map(async n => ({
            number: n,
            episodes: await fetchEpisodeCount(slug, n, false),
            isVerified: true,
            isFilm: false
        }))),
        hasFilms ? fetchEpisodeCount(slug, 0, true) : Promise.resolve(0)
    ]);

    const seasons = seasonResults.filter(s => s.episodes > 0);
    if (seasons.length === 0) seasons.push({ number: 1, episodes: 12, isVerified: false, isFilm: false });

    if (hasFilms && filmCount > 0) {
        seasons.push({
            number: Math.max(...seasons.map(s => s.number)) + 1,
            episodes: filmCount,
            isVerified: true,
            isFilm: true,
            displayName: '🎬 Filme'
        });
    }

    return seasons;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=3600');

    const { slug, search } = req.query;

    if (search) {
        const results = await searchAniworld(search);
        return res.status(200).json({ results });
    }

    if (!slug) return res.status(200).json({ exists: false, error: 'Kein Slug' });

    try {
        const seasons = await scrapeAnimeSeasons(slug);
        return res.status(200).json({ exists: true, slug, seasons });
    } catch (error) {
        if (error.response?.status === 404) {
            return res.status(200).json({ exists: false, slug });
        }
        return res.status(200).json({
            exists: true, slug,
            seasons: [{ number: 1, episodes: 12, isVerified: false, isFilm: false }],
            fallback: true
        });
    }
};

