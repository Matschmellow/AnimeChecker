const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'de-DE,de;q=0.9',
    'Referer': 'https://aniworld.to/'
};

// Holt die echten Episoden für EINE Staffel
async function fetchEpisodeCount(slug, seasonNum) {
    try {
        const url = `https://aniworld.to/anime/stream/${slug}/staffel-${seasonNum}`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);
        let maxCount = 0;

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            // STRENGER FILTER: Darf nur Episoden DIESER Staffel und DIESES Animes zählen
            const match = href.match(new RegExp(`/${slug}/staffel-${seasonNum}/episode-(\\d+)`));
            if (match) {
                const num = parseInt(match[1]);
                if (num > maxCount) maxCount = num;
            }
        });

        return maxCount > 0 ? maxCount : 12; // 12 als Fallback
    } catch (e) {
        return 12;
    }
}

// Sucht den perfekten AniWorld Slug
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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { slug, search, getEpisodesForSeason } = req.query;

    // 1. Suche nach dem Slug
    if (search) {
        const results = await searchAniworld(search);
        return res.status(200).json({ results });
    }

    if (!slug) return res.status(200).json({ exists: false, error: 'Kein Slug' });

    // 2. On-Demand Fetching: Holt die genauen Episoden, wenn man einen Tab anklickt
    if (getEpisodesForSeason) {
        const count = await fetchEpisodeCount(slug, getEpisodesForSeason);
        return res.status(200).json({ episodes: count });
    }

    // 3. Grundstruktur scannen (Wie viele Staffeln gibt es?)
    try {
        const url = `https://aniworld.to/anime/stream/${slug}`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);

        const seasonNums = new Set();

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            // Findet Staffeln, die exakt zu diesem Anime gehören
            if (href.includes(`/stream/${slug}/staffel-`)) {
                const mSeason = href.match(/\/staffel-(\d+)/);
                if (mSeason) seasonNums.add(parseInt(mSeason[1]));
            }
        });

        const totalSeasons = seasonNums.size > 0 ? Math.max(...seasonNums) : 1;
        const seasonsConfig = [];

        // Bereitet die Tabs vor, die Episoden werden später on-demand geladen (Startwert: 0)
        for (let i = 1; i <= totalSeasons; i++) {
            seasonsConfig.push({ number: i, episodes: 0, isVerified: false });
        }

        return res.status(200).json({ exists: true, slug, seasons: seasonsConfig });

    } catch (error) {
        if (error.response?.status === 404) return res.status(200).json({ exists: false, slug });
        return res.status(200).json({
            exists: true, slug,
            seasons: [{ number: 1, episodes: 12, isVerified: false }],
            fallback: true
        });
    }
};
