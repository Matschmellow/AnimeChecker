const axios = require('axios');
const cheerio = require('cheerio');

// hilfsfunktion: seite abrufen mit retry
async function fetchPage(url, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const { data } = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                    'Referer': 'https://aniworld.to/'
                },
                timeout: 6000
            });
            return data;
        } catch (e) {
            if (attempt === retries) throw e;
            await new Promise(r => setTimeout(r, 800));
        }
    }
}

// episodenanzahl einer staffel oder des film-tabs ermitteln
async function fetchSeasonEpisodes(slug, seasonNum, isFilm = false) {
    try {
        const typePath = isFilm ? 'film' : `staffel-${seasonNum}`;
        const url = `https://aniworld.to/anime/stream/${slug}/${typePath}`;
        const data = await fetchPage(url);
        const $ = cheerio.load(data);
        const episodes = new Set();

        // methode 1: links mit episode- im pfad suchen
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href') || '';
            // film-links: /film/episode-N oder /film/1 etc.
            if (isFilm) {
                const matchEp = href.match(new RegExp(`/stream/${slug}/film/episode-(\\d+)`));
                const matchSimple = href.match(new RegExp(`/stream/${slug}/film/(\\d+)`));
                if (matchEp) episodes.add(parseInt(matchEp[1]));
                if (matchSimple) episodes.add(parseInt(matchSimple[1]));
            } else {
                const match = href.match(new RegExp(`/stream/${slug}/staffel-${seasonNum}/episode-(\\d+)`));
                if (match) episodes.add(parseInt(match[1]));
            }
        });

        // methode 2: episodenliste-elemente zählen (aniworld nutzt oft ul.episodes o.ä.)
        if (episodes.size === 0) {
            // generischer fallback: alle episode-N links auf der seite
            $('a[href]').each((i, el) => {
                const href = $(el).attr('href') || '';
                if (href.includes(`/${typePath}/episode-`) || href.includes(`/${typePath}/`)) {
                    const m = href.match(/episode-(\d+)/);
                    if (m) episodes.add(parseInt(m[1]));
                    // film ohne "episode-" präfix
                    const mSimple = href.match(new RegExp(`/${typePath}/(\\d+)$`));
                    if (mSimple) episodes.add(parseInt(mSimple[1]));
                }
            });
        }

        // methode 3: episodenzahl aus meta/title/strukturellen elementen lesen
        if (episodes.size === 0) {
            // manche seiten listen episoden als li-elemente
            $('ul li a[href]').each((i, el) => {
                const href = $(el).attr('href') || '';
                const m = href.match(/(\d+)$/);
                if (m && href.includes(slug)) episodes.add(parseInt(m[1]));
            });
        }

        if (episodes.size > 0) {
            return Math.max(...episodes);
        }

        // letzter fallback: page-not-found prüfen
        const title = $('title').text().toLowerCase();
        if (title.includes('404') || title.includes('nicht gefunden')) return 0;

        return 1;
    } catch (e) {
        if (e.response && e.response.status === 404) return 0;
        return 1;
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=3600'); // 1h cachen

    const { slug } = req.query;
    if (!slug) return res.status(200).json({ exists: false, error: 'Kein Slug' });

    try {
        const mainUrl = `https://aniworld.to/anime/stream/${slug}`;
        const data = await fetchPage(mainUrl);
        const $ = cheerio.load(data);

        // 404-check
        const pageTitle = $('title').text().toLowerCase();
        if (pageTitle.includes('404') || pageTitle.includes('nicht gefunden') || pageTitle.includes('error')) {
            return res.status(200).json({ exists: false, slug });
        }

        const foundSeasons = new Set();
        let hasFilms = false;

        // alle internen links scannen
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href') || '';

            // staffeln
            const mSeason = href.match(new RegExp(`/stream/${slug}/staffel-(\\d+)`));
            if (mSeason) foundSeasons.add(parseInt(mSeason[1]));

            // filme - verschiedene formen prüfen
            if (
                href.includes(`/stream/${slug}/film`) ||
                href.includes(`/stream/${slug}/movie`)
            ) {
                hasFilms = true;
            }
        });

        // auch navigations-tabs prüfen (aniworld hat oft data-* attribute oder li.season)
        $('[data-season-id], li.season, .season-tab, [class*="season"]').each((i, el) => {
            const text = $(el).text().toLowerCase();
            const href = $(el).attr('href') || $(el).find('a').attr('href') || '';
            if (text.includes('film') || text.includes('movie') || href.includes('/film')) {
                hasFilms = true;
            }
        });

        // parallelisiert episodenzahlen abrufen
        const seasonNumbers = foundSeasons.size > 0 ? [...foundSeasons].sort((a, b) => a - b) : [1];
        
        const [seasonResults, filmCount] = await Promise.all([
            // alle staffeln parallel abrufen
            Promise.all(
                seasonNumbers.map(async (num) => {
                    const count = await fetchSeasonEpisodes(slug, num, false);
                    return { number: num, episodes: Math.max(count, 1), isVerified: true, isFilm: false };
                })
            ),
            // film-tab parallel abrufen (falls vorhanden)
            hasFilms ? fetchSeasonEpisodes(slug, 0, true) : Promise.resolve(0)
        ]);

        // ungültige staffeln (0 episoden → nicht vorhanden) herausfiltern
        const validSeasons = seasonResults.filter(s => s.episodes > 0);

        // wenn keine staffel gefunden, mindestens staffel 1 annehmen
        if (validSeasons.length === 0) {
            validSeasons.push({ number: 1, episodes: 12, isVerified: false, isFilm: false });
        }

        // film-tab anhängen falls gefunden
        if (hasFilms && filmCount > 0) {
            const nextNum = Math.max(...validSeasons.map(s => s.number)) + 1;
            validSeasons.push({
                number: nextNum,
                episodes: filmCount,
                isVerified: true,
                isFilm: true,
                displayName: 'Filme'
            });
        }

        return res.status(200).json({
            exists: true,
            slug,
            seasons: validSeasons
        });

    } catch (error) {
        if (error.response && error.response.status === 404) {
            return res.status(200).json({ exists: false, slug });
        }
        // fallback bei unbekanntem fehler
        return res.status(200).json({
            exists: true,
            slug,
            seasons: [{ number: 1, episodes: 12, isVerified: false, isFilm: false }],
            fallback: true
        });
    }
};
