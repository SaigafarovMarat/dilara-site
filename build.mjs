// Сборщик сайта: шаблоны + markdown-статьи -> dist/
// Статьи с датой в будущем не публикуются, пока эта дата не наступит (по Москве).
// Локальный просмотр всего: PREVIEW_ALL=1 node build.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const read = (p) => fs.readFile(path.join(ROOT, p), 'utf8');

const cfg = JSON.parse(await read('site.config.json'));
const faq = JSON.parse(await read('src/data/faq.json'));

const envUrl =
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
const SITE_URL = (cfg.siteUrl || envUrl || '').replace(/\/$/, '');
const PREVIEW = process.env.PREVIEW_ALL === '1';
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Отзывы: показываем блок только если в src/data/reviews.json есть настоящие отзывы с согласием авторов
const reviews = JSON.parse(await read('src/data/reviews.json')).filter(r => r.text && r.name);
const reviewsNote = '';
const reviewsHtml = reviews.length ? `<section class="section" id="reviews"><div class="wrap"><div class="section-head reveal"><p class="eyebrow">Отзывы</p><h2>Что говорят <em>клиентки</em></h2>${reviewsNote?`<p class="lead">${reviewsNote}</p>`:''}</div><div class="trio">${reviews.map(r=>`<figure class="card reveal"><blockquote><p>${esc(r.text)}</p></blockquote><figcaption><strong>${esc(r.name)}</strong>${r.meta?' · '+esc(r.meta):''}</figcaption></figure>`).join('')}</div></div></section>` : '';

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const ruDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const abs = (p) => (SITE_URL ? SITE_URL + p : p);
const contact = (v) => (v && v.trim() ? v.trim() : '/#contacts');

// ---------- шаблоны ----------
const partialCache = {};
async function partial(name) {
  if (!partialCache[name]) partialCache[name] = await read(`src/partials/${name}.html`);
  return partialCache[name];
}
async function render(tpl, vars) {
  let out = tpl;
  for (const m of [...out.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)]) {
    out = out.replace(m[0], await partial(m[1]));
  }
  return out.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k) => (vars[k] ?? ''));
}

const baseVars = {
  name: cfg.name,
  role: cfg.role,
  tgPersonal: contact(cfg.telegramPersonal),
  tgGroup: contact(cfg.telegramGroup),
  hotline: cfg.hotline,
  hotlineTel: cfg.hotlineTel,
  priceFirst: cfg.priceFirst,
  priceNext: cfg.priceNext,
  year: new Date().getFullYear(),
};

function headHtml({ title, description, pagePath, image = '/img/og.jpg', type = 'website', jsonld = [] }) {
  const t = esc(title);
  const d = esc(description);
  const tags = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<meta name="theme-color" content="#FAF3EC">`,
    `<script>document.documentElement.classList.add('js')</script>`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
    `<link rel="alternate" type="application/rss+xml" title="Блог — ${esc(cfg.name)}" href="/feed.xml">`,
    SITE_URL ? `<link rel="canonical" href="${abs(pagePath)}">` : '',
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:locale" content="ru_RU">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:image" content="${abs(image)}">`,
    SITE_URL ? `<meta property="og:url" content="${abs(pagePath)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="preload" href="/fonts/cormorant-garamond-cyrillic-500-normal.woff2" as="font" type="font/woff2" crossorigin>`,
    `<link rel="preload" href="/fonts/jost-cyrillic-400-normal.woff2" as="font" type="font/woff2" crossorigin>`,
    `<link rel="stylesheet" href="/styles.css">`,
    ...jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`),
  ];
  return tags.filter(Boolean).join('\n');
}

async function page({ file, outPath, title, description, pagePath, bodyClass = '', content, ...rest }) {
  const layout = await read('src/layout.html');
  const html = await render(layout, {
    ...baseVars,
    head: headHtml({ title, description, pagePath, ...rest }),
    bodyClass,
    content,
  });
  const target = path.join(DIST, outPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, html);
}

// ---------- статьи ----------
function parsePost(raw, file) {
  const text = raw.replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`Нет frontmatter в ${file}`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const k of ['title', 'description', 'date']) {
    if (!meta[k]) throw new Error(`В ${file} не заполнено поле «${k}»`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) throw new Error(`Дата в ${file} должна быть ГГГГ-ММ-ДД`);
  meta.slug = meta.slug || path.basename(file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  meta.category = meta.category || 'Польза';
  meta.draft = meta.draft === 'true';
  const body = m[2].trim();
  const words = body.split(/\s+/).length;
  meta.minutes = Math.max(1, Math.round(words / 180));
  meta.html = marked.parse(body);
  return meta;
}

const postFiles = (await fs.readdir(path.join(ROOT, 'content/posts'))).filter((f) => f.endsWith('.md'));
let allPosts = [];
for (const f of postFiles) allPosts.push(parsePost(await read(`content/posts/${f}`), f));
const slugs = new Set();
for (const p of allPosts) {
  if (slugs.has(p.slug)) throw new Error(`Повтор адреса статьи: ${p.slug}`);
  slugs.add(p.slug);
}
const scheduled = allPosts.filter((p) => !p.draft && p.date > TODAY);
const posts = allPosts
  .filter((p) => !p.draft && (PREVIEW || p.date <= TODAY))
  .sort((a, b) => (a.date < b.date ? 1 : -1));

const card = (p) => `
<a class="post-card reveal" href="/blog/${p.slug}">
  <span class="post-meta"><span class="tag">${esc(p.category)}</span><time datetime="${p.date}">${ruDate(p.date)}</time></span>
  <h3>${esc(p.title)}</h3>
  <p>${esc(p.description)}</p>
  <span class="post-more">Читать · ${p.minutes} мин<span aria-hidden="true"> →</span></span>
</a>`;

// ---------- сборка ----------
await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(DIST, { recursive: true });
await fs.cp(path.join(ROOT, 'public'), DIST, { recursive: true });

// Главная
const faqHtml = faq
  .map((f, i) => `<details class="faq-item reveal"${i === 0 ? '' : ''}><summary>${esc(f.q)}</summary><div class="faq-a"><p>${esc(f.a)}</p></div></details>`)
  .join('\n');
const latest = posts.slice(0, 3);
const blogTeaser = latest.length
  ? `<section class="section" id="blog-teaser"><div class="wrap">
      <div class="section-head reveal"><p class="eyebrow">Блог</p><h2>Читать <em>спокойно и без спешки</em></h2></div>
      <div class="post-grid">${latest.map(card).join('')}</div>
      <p class="center reveal"><a class="btn btn-ghost" href="/blog">Все статьи</a></p>
    </div></section>`
  : '';

const homeJson = [
  {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': abs('/#dilara'),
    name: cfg.name,
    jobTitle: 'Коуч отношений',
    description: 'Коуч отношений из Казани, сертификат Erickson University, более 10 лет практики. Индивидуальные консультации для женщин в разрушающих отношениях.',
    image: abs('/img/about.jpg'),
    url: SITE_URL || undefined,
    address: { '@type': 'PostalAddress', addressLocality: 'Казань', addressCountry: 'RU' },
    hasCredential: { '@type': 'EducationalOccupationalCredential', name: 'Сертификат Erickson University' },
    knowsAbout: ['коучинг отношений', 'эриксоновский коучинг', 'эмоциональный абьюз', 'границы в отношениях', 'восстановление самооценки'],
    sameAs: [cfg.telegramGroup, cfg.telegramPersonal].filter(Boolean),
  },
  {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    name: `${cfg.name} — коуч отношений`,
    description: cfg.defaultDescription,
    areaServed: ['RU', 'Казань'],
    image: abs('/img/og.jpg'),
    url: SITE_URL || undefined,
    priceRange: '2990–4990 RUB',
    provider: { '@id': abs('/#dilara') },
    makesOffer: [
      { '@type': 'Offer', name: 'Первая индивидуальная сессия, 60 минут', price: '2990', priceCurrency: 'RUB' },
      { '@type': 'Offer', name: 'Индивидуальная сессия, 60 минут', price: '4990', priceCurrency: 'RUB' },
    ],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  },
];

const homeTpl = await render(await read('src/pages/home.html'), { ...baseVars, faq: faqHtml, blogTeaser, reviews: reviewsHtml });
await page({
  outPath: 'index.html',
  title: 'Консультация коуча по отношениям — Дилара Сайгафарова, Казань и онлайн',
  description: cfg.defaultDescription,
  pagePath: '/',
  bodyClass: 'home',
  content: homeTpl,
  jsonld: homeJson,
});

// Блог
const blogContent = await render(await read('src/pages/blog.html'), {
  ...baseVars,
  posts: posts.length
    ? `<div class="post-grid">${posts.map(card).join('')}</div>`
    : `<p class="center muted">Первые статьи появятся совсем скоро.</p>`,
});
await page({
  outPath: 'blog/index.html',
  title: 'Блог о здоровых отношениях, границах и восстановлении — Дилара Сайгафарова',
  description: 'Спокойные разборы: как распознать разрушающие отношения, как безопасно строить план перемен и восстанавливаться после.',
  pagePath: '/blog',
  bodyClass: 'blog',
  content: blogContent,
});

// Статьи
for (const p of posts) {
  const related = posts.filter((x) => x.slug !== p.slug).slice(0, 2);
  const relatedHtml = related.length
    ? `<section class="related"><h2>Читайте также</h2><div class="post-grid">${related.map(card).join('')}</div></section>`
    : '';
  const content = await render(await read('src/pages/post.html'), {
    ...baseVars,
    title: esc(p.title),
    category: esc(p.category),
    date: p.date,
    dateRu: ruDate(p.date),
    minutes: p.minutes,
    body: p.html,
    related: relatedHtml,
  });
  await page({
    outPath: `blog/${p.slug}/index.html`,
    title: `${p.title} — ${cfg.name}`,
    description: p.description,
    pagePath: `/blog/${p.slug}`,
    bodyClass: 'post',
    type: 'article',
    content,
    jsonld: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: p.title,
        description: p.description,
        datePublished: p.date,
        inLanguage: 'ru',
        author: { '@type': 'Person', name: cfg.name },
        image: abs('/img/og.jpg'),
        mainEntityOfPage: abs(`/blog/${p.slug}`),
      },
    ],
  });
}

// 404
await page({
  outPath: '404.html',
  title: 'Страница не найдена — Дилара Сайгафарова',
  description: 'Такой страницы нет.',
  pagePath: '/404',
  bodyClass: 'notfound',
  content: await render(await read('src/pages/404.html'), baseVars),
});

// robots, sitemap, rss
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Claude-SearchBot', 'Google-Extended', 'Applebot-Extended', 'YandexAdditional'];
await fs.writeFile(
  path.join(DIST, 'robots.txt'),
  `User-agent: *\nAllow: /\n\n${AI_BOTS.map((x) => `User-agent: ${x}\nAllow: /\n`).join('\n')}\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ''}`
);
// llms.txt — краткая карта сайта для ИИ
await fs.writeFile(
  path.join(DIST, 'llms.txt'),
  `# ${cfg.name} — коуч отношений\n\n> ${cfg.defaultDescription}\n\nФормат: индивидуальные консультации 60 минут, Zoom или очно в Казани. Первая сессия ${cfg.priceFirst}, следующие ${cfg.priceNext}. Не заменяет психотерапию и экстренную помощь (112, ${cfg.hotline}).\n\n## Страницы\n\n- [Главная: консультации, метод, безопасность, вопросы](${SITE_URL}/)\n- [Блог](${SITE_URL}/blog)\n\n## Статьи\n\n${posts.map((p) => `- [${p.title}](${SITE_URL}/blog/${p.slug}): ${p.description}`).join('\n')}\n`
);
if (SITE_URL) {
  const urls = [
    { loc: '/', lastmod: TODAY },
    { loc: '/blog', lastmod: posts[0]?.date || TODAY },
    ...posts.map((p) => ({ loc: `/blog/${p.slug}`, lastmod: p.date })),
  ];
  await fs.writeFile(
    path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${SITE_URL}${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`)
      .join('\n')}\n</urlset>\n`
  );
  await fs.writeFile(
    path.join(DIST, 'feed.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n<title>Блог — ${esc(cfg.name)}</title>\n<link>${SITE_URL}/blog</link>\n<description>${esc(cfg.defaultDescription)}</description>\n<language>ru</language>\n${posts
      .slice(0, 20)
      .map(
        (p) =>
          `<item><title>${esc(p.title)}</title><link>${SITE_URL}/blog/${p.slug}</link><guid>${SITE_URL}/blog/${p.slug}</guid><pubDate>${new Date(p.date + 'T06:00:00+03:00').toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`
      )
      .join('\n')}\n</channel></rss>\n`
  );
}

console.log(
  `Сборка готова. Сегодня (МСК): ${TODAY}. Опубликовано статей: ${posts.length}. Ждут своей даты: ${scheduled.length}${
    scheduled.length ? ` (ближайшая: ${scheduled.map((p) => p.date).sort()[0]})` : ''
  }.${PREVIEW ? ' РЕЖИМ ПРЕДПРОСМОТРА: показаны все статьи.' : ''}`
);
