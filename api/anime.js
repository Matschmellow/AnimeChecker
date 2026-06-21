const axios = require('axios');
const cheerio = require('cheerio');

// Hilfsfunktion, um eine einzelne Staffel abzufragen
async function fetchSeasonEpisodes(slug, seasonNum) {
    try {
        const url = `https://aniworld.to/anime/stream/${slug}/staffel-${seasonNum}`;
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html'
            },
            timeout: 4000
        });
        const $ = cheerio.load(data);
        const episodes = [];
        
        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            if (href.includes(`/stream/${slug}/staffel-${seasonNum}/episode-`)) {
                const match = href.match(/episode-(\d+)/);
                if (match) {
                    const eNum = parseInt(match[1]);
                    if (!episodes.includes(eNum)) episodes.push(eNum);
                }
            }
        });
        return episodes.length > 0 ? Math.max(...episodes) : 12;
    } catch (e) {
        return 12; // Fallback, falls eine einzelne Staffel hakt
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { slug } = req.query;

    if (!slug) {
        return res.status(200).json({ exists: false, error: 'Kein Slug' });
    }

    try {
        const url = `https://aniworld.to/anime/stream/${slug}`;
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html'
            },
            timeout: 5000
        });

        const $ = cheerio.load(data);
        
        // 1. Alle verfügbaren Staffeln ermitteln
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

        // 2. AUTOMATISCHER DEEP-SCAN: Für jede gefundene Staffel die echten Folgen ermitteln
        const dynamicSeasonsConfig = [];
        for (let i = 1; i <= totalSeasons; i++) {
            const epsCount = await fetchSeasonEpisodes(slug, i);
            dynamicSeasonsConfig.push({
                number: i,
                episodes: epsCount,
                isVerified: true
            });
        }

        return res.status(200).json({
            exists: true,
            slug,
            seasons: dynamicSeasonsConfig
        });

    } catch (error) {
        if (error.response && error.response.status === 404) {
            return res.status(200).json({ exists: false, slug });
        }
        return res.status(200).json({
            exists: true,
            slug,
            seasons: [{ number: 1, episodes: 12, isVerified: false }],
            fallback: true
        });
    }
};

