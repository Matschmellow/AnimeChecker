const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'de-DE,de;q=0.9',
    'Referer': 'https://aniworld.to/'
};

// Holt die echten Episoden, indem NUR exakt passende Pfade zum aktuellen Anime gezählt werden!
async function fetchEpisodeCountForPath(slug, subPath) {
    try {
        const url = `https://aniworld.to/anime/stream/${slug}/${subPath}`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);
        let maxCount = 0;

        if (subPath === 'film') {
            // Filme: Wir suchen nach /film/film-1, /film/film-2 etc.
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href') || '';
                const match = href.match(new RegExp(`/${slug}/film/film-(\\d+)`));
                if (match) {
                    const num = parseInt(match[1]);
                    if (num > maxCount) maxCount = num;
                }
            });
            // Der absolute Gamechanger für Einzel-Filme:
            // Wenn die Seite existiert, aber keine nummerierten Boxen da sind, ist es genau 1 Film.
            if (maxCount === 0) maxCount = 1;
        } else {
            // Staffeln: Wir suchen nach /staffel-X/episode-Y
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href') || '';
                // Das verhindert, dass "Verwandte Animes" in der Seitenleiste mitgezählt werden!
                const match = href.match(new RegExp(`/${slug}/${subPath}/episode-(\\d+)`));
                if (match) {
                    const num = parseInt(match[1]);
                    if (num > maxCount) maxCount = num;
                }
            });
        }

        return maxCount > 0 ? maxCount : 12; // 12 als äußerster Fallback, falls Cloudflare blockt
    } catch (e) {
        return subPath === 'film' ? 0 : 12;
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { slug, search, getEpisodesFor } = req.query;

    // 1. Sichere AJAX-Suche nach dem korrekten Slug
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

    // 2. On-Demand Fetching für exakte Episodenzahlen (Verhindert Cloudflare DDoS-Bann)
    if (getEpisodesFor) {
        const count = await fetchEpisodeCountForPath(slug, getEpisodesFor);
        return res.status(200).json({ episodes: count });
    }

    // 3. Grundgerüst ermitteln (Wie viele Staffeln und Filme gibt es?)
    try {
        const url = `https://aniworld.to/anime/stream/${slug}`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);

        const seasonNums = new Set();
        let hasFilms = false;

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            
            // Exaktes Finden von Staffeln DIESES Animes
            if (href.includes(`/stream/${slug}/staffel-`)) {
                const mSeason = href.match(/\/staffel-(\d+)/);
                if (mSeason) seasonNums.add(parseInt(mSeason[1]));
            }
            
            // Tolerante Filme-Erkennung
            if (href.endsWith(`/${slug}/film`) || href.includes(`/${slug}/film/`)) {
                hasFilms = true;
            }
        });

        const totalSeasons = seasonNums.size > 0 ? Math.max(...seasonNums) : 1;
        const seasonsConfig = [];

        // Hüllen bauen, die Episodenzahl wird im Frontend per Lazy-Load angefragt
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
