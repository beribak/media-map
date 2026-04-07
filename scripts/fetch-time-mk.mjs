import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://time.mk';
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, '_data');
const ARTICLES_YML = path.join(DATA_DIR, 'articles.yml');
const SOURCES_YML = path.join(DATA_DIR, 'sources.yml');
const COLLECTION_DIR = path.join(ROOT_DIR, '_articles');
const SCRAPED_PREFIX = 'time-mk-';
const SCRAPED_LIMIT = 5;
const MAX_STORED_ARTICLES = 50;

function absolutize(url) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return new URL(url.replace(/^\//, ''), BASE_URL + '/').toString();
}

function extractBackgroundImage(styleValue) {
  if (!styleValue) return null;
  const match = styleValue.match(/background-image\s*:\s*url\(['\"]?([^'\")]+)['\"]?\)/i);
  return match ? absolutize(match[1]) : null;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'article';
}

function normalizeSourceName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArticleTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function yamlQuote(value) {
  const stringValue = String(value ?? '');
  return '"' + stringValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function toMacedonianIso(date) {
  const dt = new Date(date);
  const offsetMinutes = 120;
  return new Date(dt.getTime() + offsetMinutes * 60 * 1000).toISOString().replace('Z', '+02:00');
}

function classifyCategory(title, snippet) {
  const text = `${title || ''} ${snippet || ''}`.toLowerCase();
  if (/(здравств|болниц|клиник|лекар|пациент|операц)/i.test(text)) return 'Здравство';
  if (/(полит|влада|парламент|избор|министер|премиер)/i.test(text)) return 'Политика';
  if (/(економ|пазар|бизнис|инфлац|финанс|банка)/i.test(text)) return 'Економија';
  if (/(војна|нато|руси|сша|еу|геополит|украин|дипломат)/i.test(text)) return 'Геополитика';
  if (/(спорт|натпревар|фудбал|кошар|тенис)/i.test(text)) return 'Спорт';
  if (/(култур|филм|музик|театар)/i.test(text)) return 'Култура';
  if (/(технолог|апликац|ai|вештачка интелиген|наука|вселен|наса|артемис)/i.test(text)) return 'Технологија';
  return 'Општо';
}

function trimText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildYamlArticle(article, index) {
  return [
    `- id: ${article.id}`,
    `  title: ${yamlQuote(article.title)}`,
    `  source: ${yamlQuote(article.source)}`,
    `  published_at: ${yamlQuote(article.published_at)}`,
    `  category: ${yamlQuote(article.category)}`,
    `  image: ${yamlQuote(article.image)}`,
    `  url: ${yamlQuote(article.url)}`,
    `  excerpt: ${yamlQuote(article.excerpt)}`,
    `  featured: ${index === 0 ? 'true' : 'false'}`
  ].join('\n');
}

function matchYamlValue(block, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const quotedMatch = block.match(new RegExp(`^\\s*${escapedKey}:\\s*"((?:\\\\.|[^"])*)"`, 'm'));
  if (quotedMatch) {
    return quotedMatch[1]
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  const plainMatch = block.match(new RegExp(`^\\s*${escapedKey}:\\s*(.+)$`, 'm'));
  return plainMatch ? plainMatch[1].trim() : null;
}

function parseStoredArticles(yaml) {
  return String(yaml || '')
    .split(/\n(?=- id: )/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({
      id: matchYamlValue(block, 'id'),
      title: matchYamlValue(block, 'title'),
      source: matchYamlValue(block, 'source'),
      published_at: matchYamlValue(block, 'published_at'),
      category: matchYamlValue(block, 'category'),
      image: matchYamlValue(block, 'image'),
      url: matchYamlValue(block, 'url'),
      excerpt: matchYamlValue(block, 'excerpt'),
      featured: matchYamlValue(block, 'featured') === 'true'
    }))
    .filter((article) => article.id && article.title);
}

async function loadStoredArticles() {
  try {
    const yaml = await fs.readFile(ARTICLES_YML, 'utf8');
    return parseStoredArticles(yaml);
  } catch {
    return [];
  }
}

function createArticleId(article, takenIds) {
  const datePart = String(article.published_at || '')
    .slice(0, 10)
    .replace(/-/g, '') || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slugPart = slugify(article.title).slice(0, 48);
  const baseId = `${SCRAPED_PREFIX}${datePart}-${slugPart}`;
  let candidate = baseId;
  let counter = 2;

  while (takenIds.has(candidate)) {
    candidate = `${baseId}-${counter}`;
    counter += 1;
  }

  takenIds.add(candidate);
  return candidate;
}

async function ensureSourcePlaceholder(article) {
  let sourcesYaml = '';
  try {
    sourcesYaml = await fs.readFile(SOURCES_YML, 'utf8');
  } catch {
    return;
  }

  const normalizedSource = normalizeSourceName(article.source);
  const sourceBlocks = sourcesYaml.split(/\n(?=- id: )/g).map((block) => block.trim()).filter(Boolean);
  const namesToCheck = [];

  for (const block of sourceBlocks) {
    const nameMatch = block.match(/\n?name:\s*"([^"]+)"/);
    if (nameMatch) namesToCheck.push(normalizeSourceName(nameMatch[1]));

    const aliasMatch = block.match(/aliases:\s*\[([^\]]*)\]/);
    if (aliasMatch) {
      const aliases = aliasMatch[1]
        .split(',')
        .map((part) => part.replace(/^\s*"|"\s*$/g, '').trim())
        .filter(Boolean);
      for (const alias of aliases) namesToCheck.push(normalizeSourceName(alias));
    }
  }

  if (namesToCheck.includes(normalizedSource)) return;

  const placeholder = [
    '',
    `- id: ${slugify(article.source)}`,
    `  name: ${yamlQuote(article.source)}`,
    `  aliases: [${yamlQuote(article.source)}]`,
    '  bias:',
    '    ideology: "неозначено"',
    '    geopolitical: ["неозначено"]',
    '    party_affinity: ["неозначено"]',
    '    trust_score: 50',
    '    sensationalism: 50',
    '  color: "#6b7280"',
    ''
  ].join('\n');

  await fs.appendFile(SOURCES_YML, placeholder, 'utf8');
}

function buildCollectionMarkdown(article, index) {
  return [
    '---',
    'layout: article',
    `title: ${yamlQuote(article.title)}`,
    `source: ${yamlQuote(article.source)}`,
    `published_at: ${yamlQuote(article.published_at)}`,
    `category: ${yamlQuote(article.category)}`,
    `image: ${yamlQuote(article.image)}`,
    `excerpt: ${yamlQuote(article.excerpt)}`,
    `featured: ${index === 0 ? 'true' : 'false'}`,
    `external_url: ${yamlQuote(article.url)}`,
    '---',
    `${article.excerpt}`,
    '',
    `Оваа ставка е автоматски повлечена од ${article.pageUrl} преку GitHub Actions scraper.`,
    '',
    `Оригинален линк: ${article.url}`,
    ''
  ].join('\n');
}

async function updateMediaMapFresh(articles) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(COLLECTION_DIR, { recursive: true });

  const existingArticles = await loadStoredArticles();
  const takenIds = new Set(existingArticles.map((article) => article.id).filter(Boolean));
  const existingTitles = new Set(existingArticles.map((article) => normalizeArticleTitle(article.title)).filter(Boolean));
  const mergedArticles = [];
  const incomingTitles = new Set();
  const keptTitles = new Set();
  let addedCount = 0;
  let skippedCount = 0;

  for (const article of articles) {
    const normalizedTitle = normalizeArticleTitle(article.title);
    if (!normalizedTitle || existingTitles.has(normalizedTitle) || incomingTitles.has(normalizedTitle)) {
      skippedCount += 1;
      continue;
    }

    incomingTitles.add(normalizedTitle);
    keptTitles.add(normalizedTitle);
    mergedArticles.push({
      ...article,
      id: createArticleId(article, takenIds)
    });
    addedCount += 1;
  }

  for (const article of existingArticles) {
    const normalizedTitle = normalizeArticleTitle(article.title);
    if (!normalizedTitle || keptTitles.has(normalizedTitle)) continue;

    keptTitles.add(normalizedTitle);
    mergedArticles.push(article);
  }

  const keptArticles = mergedArticles.slice(0, MAX_STORED_ARTICLES);
  const scrapedBlocks = keptArticles.map((article, index) => buildYamlArticle(article, index));
  await fs.writeFile(ARTICLES_YML, scrapedBlocks.join('\n\n') + '\n', 'utf8');

  const keepIds = new Set(keptArticles.map((article) => article.id));
  const existingFiles = await fs.readdir(COLLECTION_DIR).catch(() => []);
  for (const file of existingFiles) {
    if (file.startsWith(SCRAPED_PREFIX) && file.endsWith('.md') && !keepIds.has(file.replace(/\.md$/, ''))) {
      await fs.unlink(path.join(COLLECTION_DIR, file)).catch(() => {});
    }
  }

  for (let i = 0; i < keptArticles.length; i += 1) {
    const article = keptArticles[i];
    await fs.writeFile(path.join(COLLECTION_DIR, `${article.id}.md`), buildCollectionMarkdown(article, i), 'utf8');
    await ensureSourcePlaceholder(article);
  }

  return {
    added: addedCount,
    total: keptArticles.length,
    skipped: skippedCount
  };
}

async function main() {
  const res = await fetch(BASE_URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  const fetchedAt = new Date().toISOString();
  const basePublishedAt = new Date(fetchedAt).getTime();
  const articles = [];

  const addArticle = (index, { titleAnchor, sourceAnchor, whenText, snippet, imageStyle }) => {
    const imageUrl = extractBackgroundImage(imageStyle);
    const title = trimText(titleAnchor.text()) || null;
    const source = trimText(sourceAnchor.text()) || 'time.mk';
    if (!title) return;

    const articleDate = new Date(basePublishedAt - index * 60 * 1000).toISOString();
    articles.push({
      id: `${SCRAPED_PREFIX}${index + 1}`,
      fetchedAt,
      pageUrl: BASE_URL,
      title,
      url: absolutize(titleAnchor.attr('href')),
      source,
      when: whenText,
      snippet,
      imageUrl,
      imageStyle: imageStyle || null,
      published_at: toMacedonianIso(articleDate),
      category: classifyCategory(title, snippet),
      image: imageUrl || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&q=80',
      excerpt: snippet || `Автоматски преземена статија од ${source}.`,
      slug: slugify(title)
    });
  };

  const clusters = $('.cluster').slice(0, SCRAPED_LIMIT);
  if (clusters.length) {
    clusters.each((index, element) => {
      const cluster = $(element);
      addArticle(index, {
        titleAnchor: cluster.find('h1 a').first(),
        sourceAnchor: cluster.find('a.source').first(),
        whenText: trimText(cluster.find('.when').first().text()) || null,
        snippet: trimText(cluster.find('p.snippet').first().text()) || null,
        imageStyle: cluster.find('.article_image .image').first().attr('style') || ''
      });
    });
  }

  if (!articles.length) {
    const headingAnchors = $('h1 a[href]')
      .filter((_, element) => {
        const href = $(element).attr('href') || '';
        const title = trimText($(element).text());
        if (!href || !title) return false;
        if (href.startsWith('#')) return false;
        if (href.toLowerCase().startsWith('javascript:')) return false;
        return true;
      })
      .slice(0, SCRAPED_LIMIT * 3);

    headingAnchors.each((_, element) => {
      if (articles.length >= SCRAPED_LIMIT) return false;
      const titleAnchor = $(element);
      const cardRoot = titleAnchor.closest('div, article, section, li');
      addArticle(articles.length, {
        titleAnchor,
        sourceAnchor: cardRoot.find('h2 a, a.source').first(),
        whenText: trimText(cardRoot.find('.when, h2').first().text()) || null,
        snippet: trimText(cardRoot.find('p').first().text()) || null,
        imageStyle: cardRoot.find('.image,[style*="background-image"]').first().attr('style') || ''
      });
      return undefined;
    });
  }

  if (!articles.length) {
    throw new Error('Could not find parsable article entries on time.mk homepage');
  }

  const result = await updateMediaMapFresh(articles);
  console.log(JSON.stringify({ scraped: articles.length, ...result, articles }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
