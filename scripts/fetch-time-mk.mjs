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

  const scrapedBlocks = articles.map((article, index) => buildYamlArticle(article, index));
  await fs.writeFile(ARTICLES_YML, scrapedBlocks.join('\n\n') + '\n', 'utf8');

  const existingFiles = await fs.readdir(COLLECTION_DIR).catch(() => []);
  for (const file of existingFiles) {
    if (file.startsWith(SCRAPED_PREFIX) && file.endsWith('.md')) {
      await fs.unlink(path.join(COLLECTION_DIR, file)).catch(() => {});
    }
  }

  for (let i = 0; i < articles.length; i += 1) {
    const article = articles[i];
    await fs.writeFile(path.join(COLLECTION_DIR, `${article.id}.md`), buildCollectionMarkdown(article, i), 'utf8');
    await ensureSourcePlaceholder(article);
  }
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
  const clusters = $('.cluster').slice(0, SCRAPED_LIMIT);
  if (!clusters.length) throw new Error('Could not find .cluster entries on page');

  const fetchedAt = new Date().toISOString();
  const basePublishedAt = new Date(fetchedAt).getTime();
  const articles = [];

  clusters.each((index, element) => {
    const cluster = $(element);
    const titleAnchor = cluster.find('h1 a').first();
    const sourceAnchor = cluster.find('a.source').first();
    const whenText = cluster.find('.when').first().text().trim() || null;
    const snippet = cluster.find('p.snippet').first().text().trim() || null;
    const imageStyle = cluster.find('.article_image .image').first().attr('style') || '';
    const imageUrl = extractBackgroundImage(imageStyle);
    const title = titleAnchor.text().trim() || null;
    const source = sourceAnchor.text().trim() || 'time.mk';
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
  });

  await updateMediaMapFresh(articles);
  console.log(JSON.stringify(articles, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
