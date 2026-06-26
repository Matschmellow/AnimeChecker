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

async function fetchFilmCount(slug) {
  try {
    const url = `https://aniworld.to/anime/stream/${slug}/filme`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
    const $ = cheerio.load(data);
    let maxCount = 0;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(new RegExp(`/${slug}/filme/film-(\\d+)`));
      if (match) {
        const num = parseInt(match[1]);
        if (num > maxCount) maxCount = num;
      }
    });
    return maxCount > 0 ? maxCount : 1;
  } catch (e) {
    return 1;
  }
}

async function searchAniworld(query) {
  try {
    const url = `https://aniworld.to/ajax/search`;
    const { data } = await axios.post(url, `keyword=${encodeURIComponent(query)}`, {
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 5000
    });
    const $ = cheerio.load(data);
    const results = [];
    $('a[href*="/anime/stream/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const title = $(el).text().trim();
      const match = href.match(/\/anime\/stream\/([^\/]+)\/?$/);
      if (match) results.push({ slug: match[1], title });
    });
    // Deduplicate by slug
    const seen = new Set();
    return results.filter(r => {
      if (seen.has(r.slug)) return false;
      seen.add(r.slug);
      return true;
    });
  } catch (e) {
    return [];
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { slug, search, getEpisodesForSeason } = req.query;

  // Search: now returns { slug, title }[] for better frontend matching
  if (search) {
    const results = await searchAniworld(search);
    return res.status(200).json({ results });
  }

  if (!slug) return res.status(200).json({ exists: false, error: 'Kein Slug' });

  // Episode count for a regular season
  if (getEpisodesForSeason) {
    const seasonParam = getEpisodesForSeason;
    if (seasonParam === 'film') {
      const count = await fetchFilmCount(slug);
      return res.status(200).json({ episodes: count });
    }
    const count = await fetchEpisodeCount(slug, parseInt(seasonParam));
    return res.status(200).json({ episodes: count });
  }

  // Main slug lookup – fetch overview page
  try {
    const url = `https://aniworld.to/anime/stream/${slug}`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });
    const $ = cheerio.load(data);

    const seasonNums = new Set();
    let hasFilms = false;

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes(`/stream/${slug}/staffel-`)) {
        const m = href.match(/\/staffel-(\d+)/);
        if (m) {
          const num = parseInt(m[1]);
          if (num >= 1) seasonNums.add(num);
        }
      }
      if (href.includes(`/stream/${slug}/filme`)) {
        hasFilms = true;
      }
    });

    const totalSeasons = seasonNums.size > 0 ? Math.max(...seasonNums) : 1;
    const seasonsConfig = [];

    // Regular seasons first
    for (let i = 1; i <= totalSeasons; i++) {
      seasonsConfig.push({
        number: seasonsConfig.length + 1,
        episodes: 0,
        isVerified: false,
        isFilm: false,
        displayName: `St. ${i}`,
        aniWorldSeason: i
      });
    }

    // Films always appended after all regular seasons
    if (hasFilms) {
      const filmCount = await fetchFilmCount(slug);
      seasonsConfig.push({
        number: seasonsConfig.length + 1,
        episodes: filmCount,
        isVerified: true,
        isFilm: true,
        displayName: '🎬 Filme',
        aniWorldSeason: null
      });
    }

    return res.status(200).json({ exists: true, slug, seasons: seasonsConfig });
  } catch (error) {
    if (error.response?.status === 404) return res.status(200).json({ exists: false, slug });
    return res.status(200).json({
      exists: true, slug,
      seasons: [{ number: 1, episodes: 12, isVerified: false, isFilm: false, displayName: 'St. 1', aniWorldSeason: 1 }],
      fallback: true
    });
  }
};
