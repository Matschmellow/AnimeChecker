const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'de-DE,de;q=0.9',
    'Referer': 'https://aniworld.to/'
};

// Hilfsfunktion: Scrapt die exakte Episodenanzahl eines ganz bestimmten Pfads
async function fetchEpisodeCountForPath(slug, subPath) {
    try {
        const url = `https://aniworld.to/anime/stream/${slug}/${subPath}`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);
        const episodes = new Set();

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            if (href.includes(`/stream/${slug}/${subPath}/episode-`)) {
                const match = href.match(/\/episode-(\d+)/);
                if (match) episodes.add(parseInt(match[1]));
            }
        });
        return episodes.size > 0 ? Math.max(...episodes) : 12;
    } catch (e) {
        return 12; // Sicherer Fallback
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { slug, search, getEpisodesFor } = req.query;

    // 1. AJAX-Suche (Bleibt unverändert und genial)
    if (search) {
        try {
            const url = `https://aniworld.to/ajax/search`;
            const { data } = await axios.post(url, `keyword=${encodeURIComponent(search)}`, {
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
            return res.status(200).json({ results: [...new Set(results)] });
        } catch (e) {
            return res.status(200).json({ results: [] });
        }
    }

    if (!slug) return res.status(200).json({ exists: false, error: 'Kein Slug' });

    // 2. LAZY LOADING: Holt die Folgen NUR für den angeforderten Tab (z.B. ?slug=re-zero&getEpisodesFor=staffel-2)
    if (getEpisodesFor) {
        const count = await fetchEpisodeCountForPath(slug, getEpisodesFor);
        return res.status(200).json({ episodes: count });
    }

    // 3. HAUPT-SCAN (Nur beim Hinzufügen): Findet nur heraus, WIE VIELE Tabs wir brauchen
    try {
        const url = `https://aniworld.to/anime/stream/${slug}`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);

        const seasonNums = new Set();
        let hasFilms = false;

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

        const totalSeasons = seasonNums.size > 0 ? Math.max(...seasonNums) : 1;
        const seasonsConfig = [];

        // Wir bauen leere Hüllen. Die Folgenanzahl steht standardmäßig auf 0 (wird sofort nachgeladen)
        for (let i = 1; i <= totalSeasons; i++) {
            seasonsConfig.push({ number: i, episodes: 0, isVerified: false, isFilm: false });
        }

        if (hasFilms) {
            seasonsConfig.push({
                number: totalSeasons + 1,
                episodes: 0,
                isVerified: false,
                isFilm: true,
                displayName: '🎬 Filme'
            });
        }

        return res.status(200).json({ exists: true, slug, seasons: seasonsConfig });

    } catch (error) {
        if (error.response?.status === 404) return res.status(200).json({ exists: false, slug });
        return res.status(200).json({
            exists: true, slug,
            seasons: [{ number: 1, episodes: 12, isVerified: false, isFilm: false }],
            fallback: true
        });
    }
};

