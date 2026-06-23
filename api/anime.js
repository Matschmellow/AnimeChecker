const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'de-DE,de;q=0.9',
    'Referer': 'https://aniworld.to/'
};

async function fetchEpisodeCount(slug, seasonNum) {
    try {
        const url = `https://aniworld.to/anime/stream/${slug}/staffel-${seasonNum}`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);
        let maxCount = 0;

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(new RegExp(`/${slug}/staffel-${seasonNum}/episode-(\\d+)`));
            if (match) {
                const num = parseInt(match[1]);
                if (num > maxCount) maxCount = num;
            }
        });

        return maxCount > 0 ? maxCount : 12;
    } catch (e) {
        return 12;
    }
}

// Filme zählen über /filme/ Pfad
async function fetchFilmCount(slug) {
    try {
        const url = `https://aniworld.to/anime/stream/${slug}/filme`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);
        let maxCount = 0;

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            // Matcht z.B. /hunter-x-hunter/filme/film-3
            const match = href.match(new RegExp(`/${slug}/filme/film-(\\d+)`));
            if (match) {
                const num = parseInt(match[1]);
                if (num > maxCount) maxCount = num;
            }
        });

        // Seite existiert, aber keine film-N Links gefunden → trotzdem mind. 1 Film
        return maxCount > 0 ? maxCount : 1;
    } catch (e) {
        // 404 oder Timeout → keine Filme vorhanden
        return 0;
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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { slug, search, getEpisodesForSeason, getFilmCount } = req.query;

    if (search) {
        const results = await searchAniworld(search);
        return res.status(200).json({ results });
    }

    if (!slug) return res.status(200).json({ exists: false, error: 'Kein Slug' });

    // Dedizierter Endpunkt für Filmanzahl
    if (getFilmCount !== undefined) {
        const count = await fetchFilmCount(slug);
        return res.status(200).json({ films: count });
    }

    if (getEpisodesForSeason) {
        const count = await fetchEpisodeCount(slug, getEpisodesForSeason);
        return res.status(200).json({ episodes: count });
    }

    try {
        const url = `https://aniworld.to/anime/stream/${slug}`;
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);

        const seasonNums = new Set();
        let hasFilms = false;

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';

            // Reguläre Staffeln
            if (href.includes(`/stream/${slug}/staffel-`)) {
                const mSeason = href.match(/\/staffel-(\d+)/);
                if (mSeason) seasonNums.add(parseInt(mSeason[1]));
            }

            // Filme – matcht /slug/filme oder /slug/filme/film-N
            if (href.includes(`/${slug}/filme`)) {
                hasFilms = true;
            }
        });

        const totalSeasons = seasonNums.size > 0 ? Math.max(...seasonNums) : 1;
        const seasonsConfig = [];

        // Filme als erster Eintrag, falls vorhanden
        if (hasFilms) {
            seasonsConfig.push({ number: 0, episodes: 0, isVerified: false, isFilm: true });
        }

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
