const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { slug, season } = req.query;

    if (!slug) {
        return res.status(200).json({ exists: false, error: 'Kein Slug' });
    }

    try {
        const curSeason = season ? parseInt(season) : 1;
        const url = season 
            ? `https://aniworld.to/anime/stream/${slug}/staffel-${curSeason}`
            : `https://aniworld.to/anime/stream/${slug}`;

        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html'
            },
            timeout: 6000
        });

        const $ = cheerio.load(data);
        
        // NEU & PRÄZISE: Zähle Staffeln NUR, wenn sie exakt zu diesem Anime gehören
        const seasons = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            if (href.includes(`/stream/${slug}/staffel-`)) {
                const match = href.match(/staffel-(\d+)/);
                if (match) {
                    const sNum = parseInt(match[1]);
                    if (!seasons.includes(sNum)) seasons.push(sNum);
                }
            }
        });
        const totalSeasons = seasons.length > 0 ? Math.max(...seasons) : 1;

        // NEU & PRÄZISE: Zähle Episoden NUR aus der aktuellen Staffel dieses spezifischen Animes
        const episodes = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            if (href.includes(`/stream/${slug}/staffel-${curSeason}/episode-`)) {
                const match = href.match(/episode-(\d+)/);
                if (match) {
                    const eNum = parseInt(match[1]);
                    if (!episodes.includes(eNum)) episodes.push(eNum);
                }
            }
        });
        const totalEpisodes = episodes.length > 0 ? Math.max(...episodes) : 12;

        return res.status(200).json({
            exists: true,
            slug,
            totalSeasons,
            totalEpisodes
        });

    } catch (error) {
        if (error.response && error.response.status === 404) {
            return res.status(200).json({ exists: false, slug });
        }
        return res.status(200).json({
            exists: true,
            slug,
            totalSeasons: 1,
            totalEpisodes: 12,
            fallback: true,
            blocked: true
        });
    }
};
