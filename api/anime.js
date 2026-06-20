const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
    // Erlaubt Anfragen von überall
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { slug, season } = req.query;

    if (!slug) {
        return res.status(400).json({ error: 'Kein Anime-Slug übergeben.' });
    }

    try {
        // Wenn eine bestimmte Staffel abgefragt wird, lade diese, sonst die Hauptseite
        const url = season 
            ? `https://aniworld.to/anime/stream/${slug}/staffel-${season}`
            : `https://aniworld.to/anime/stream/${slug}`;

        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);
        
        // 1. Zähle die verfügbaren Staffeln auf der Seite
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

        // 2. Zähle die Episoden für die aktuell geladene Staffel
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

        // Schicke das fertige Ergebnis automatisch an das iPad zurück
        return res.status(200).json({
            slug,
            totalSeasons,
            totalEpisodes
        });

    } catch (error) {
        console.error("Scraping Fehler:", error.message);
        // Falls AniWorld den Anime nicht exakt so schreibt, geben wir Standardwerte zurück
        return res.status(200).json({
            slug,
            totalSeasons: 1,
            totalEpisodes: 12,
            fallback: true
        });
    }
};
