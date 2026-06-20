const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { slug, season } = req.query;

    if (!slug) {
        return res.status(400).json({ error: 'Kein Anime-Slug übergeben.' });
    }

    try {
        const url = season 
            ? `https://aniworld.to/anime/stream/${slug}/staffel-${season}`
            : `https://aniworld.to/anime/stream/${slug}`;

        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);
        
        const seasons = [];
        $('a[href*="/staffel-"]').each((i, el) => {
            const href = $(el).attr('href');
            const match = href.match(/staffel-(\d+)/);
            if (match) {
                const sNum = parseInt(match[1]);
                if (!seasons.includes(sNum)) seasons.push(sNum);
            }
        });
        const totalSeasons = seasons.length > 0 ? Math.max(...seasons) : 1;

        const episodes = [];
        $('a[href*="/episode-"]').each((i, el) => {
            const href = $(el).attr('href');
            const match = href.match(/episode-(\d+)/);
            if (match) {
                const eNum = parseInt(match[1]);
                if (!episodes.includes(eNum)) episodes.push(eNum);
            }
        });
        const totalEpisodes = episodes.length > 0 ? Math.max(...episodes) : 12;

        return res.status(200).json({
            slug,
            totalSeasons,
            totalEpisodes
        });

    } catch (error) {
        console.error("Scraping Fehler:", error.message);
        // NEU: Wenn AniWorld ein 404 wirft (Anime existiert nicht), leiten wir den Fehler sauber weiter!
        if (error.response && error.response.status === 404) {
            return res.status(404).json({ error: 'Dieser Anime existiert nicht auf AniWorld.' });
        }
        // Bei anderen Fehlern (z.B. Timeout) geben wir zur Sicherheit den Fallback
        return res.status(200).json({
            slug,
            totalSeasons: 1,
            totalEpisodes: 12,
            fallback: true
        });
    }
};
