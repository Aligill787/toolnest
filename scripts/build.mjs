import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(projectRoot, 'dist');
const siteOrigin = 'https://toolnest.sbs';
const sourceHtml = await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8');
const sourceScript = [...sourceHtml.matchAll(/<script>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .find(script => script.includes('function init()'));
if (!sourceScript) throw new Error('Could not find the inline application script in index.html.');
const sourceStyles = requiredMatch(sourceHtml, /<style>([\s\S]*?)<\/style>/i, 'inline stylesheet')[1];
const sourceDescription = requiredMatch(sourceHtml, /<meta name="description" content="([^"]*)"/i, 'homepage description')[1];
const sourceTitle = decodeHtml(requiredMatch(sourceHtml, /<title>([\s\S]*?)<\/title>/i, 'homepage title')[1]);
const sourceSiteName = requiredMatch(sourceHtml, /<meta property="og:site_name" content="([^"]*)"/i, 'site name')[1];
const initIndex = sourceScript.indexOf('function init()');
if (initIndex < 0) throw new Error('Could not find the application init boundary.');

const context = vm.createContext({ window: {}, document: {} });
vm.runInContext(sourceScript.slice(0, initIndex), context, { filename: 'index.html:application-definitions' });
vm.runInContext(await fs.readFile(path.join(projectRoot, 'assets/js/extra-tools.js'), 'utf8'), context, { filename: 'assets/js/extra-tools.js' });
const appData = JSON.parse(vm.runInContext(`JSON.stringify({
  tools: TOOLS.map(tool => ({ id: tool.id, name: tool.name, category: tool.category, description: tool.description, icon: tool.icon })),
  categories: CATEGORY_PAGES,
  categorySlugs: CATEGORY_SLUGS,
  infoPages: INFO_PAGES,
  titleOverrides: TOOL_TITLE_OVERRIDES,
  instructions: Object.fromEntries(TOOLS.map(tool => [tool.id, toolInstructions(tool)])),
  related: Object.fromEntries(TOOLS.map(tool => [tool.id, getRelatedTools(tool).map(item => item.id)]))
})`, context));

const routeMetadata = buildRouteMetadata(appData);
const sitemapUrls = [...(await fs.readFile(path.join(projectRoot, 'sitemap.xml'), 'utf8')).matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map(match => match[1].trim());
if (!sitemapUrls.length) throw new Error('The sitemap contains no locations.');

const sitemapPaths = sitemapUrls.map((value) => {
  const url = new URL(value);
  if (url.origin !== siteOrigin || url.search || url.hash || (url.pathname !== '/' && !url.pathname.endsWith('/'))) {
    throw new Error(`Non-canonical sitemap URL: ${value}`);
  }
  if (!routeMetadata[url.pathname]) throw new Error(`No route metadata is defined for sitemap path ${url.pathname}`);
  return url.pathname;
});
if (new Set(sitemapPaths).size !== sitemapPaths.length) throw new Error('The sitemap contains duplicate routes.');
if (sitemapPaths.length !== Object.keys(routeMetadata).length) {
  throw new Error(`Sitemap has ${sitemapPaths.length} routes but metadata has ${Object.keys(routeMetadata).length}.`);
}
for (const field of ['title', 'description', 'canonical']) {
  const values = sitemapPaths.map(routePath => routeMetadata[routePath][field]);
  if (new Set(values).size !== values.length) throw new Error(`Route ${field}s must be unique.`);
}

const homeMarkup = getHomeMarkup(sourceHtml);
const homeMarkupWithoutHeading = homeMarkup
  .replace('<div id="homeView">', '<div id="homeView" style="display:none">')
  .replace('<h1>Free Online Tools for Everyday Tasks</h1>', '');
const originalMain = getMainContent(sourceHtml);
const headBase = getHeadBase(sourceHtml);
const sourceBounds = getDocumentBounds(sourceHtml);

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, 'assets/css'), { recursive: true });
await fs.mkdir(path.join(outputRoot, 'assets/js'), { recursive: true });
await fs.writeFile(path.join(outputRoot, 'assets/css/toolnest.css'), sourceStyles);
await fs.writeFile(path.join(outputRoot, 'assets/js/app.js'), sourceScript);
await fs.copyFile(path.join(projectRoot, 'assets/js/extra-tools.js'), path.join(outputRoot, 'assets/js/extra-tools.js'));
await fs.writeFile(
  path.join(outputRoot, 'assets/js/seo-metadata.js'),
  `window.TOOLNEST_SEO = Object.freeze(${JSON.stringify(routeMetadata)});\n`
);

for (const routePath of sitemapPaths) {
  const metadata = routeMetadata[routePath];
  const mainContent = routePath === '/' ? originalMain : `${homeMarkupWithoutHeading}\n${renderRouteMount(metadata, appData)}`;
  const page = [
    sourceBounds.beforeHead,
    headBase,
    renderHeadMetadata(metadata, sourceSiteName),
    sourceBounds.betweenHeadAndBody,
    sourceBounds.beforeMain,
    '<main id="main">',
    mainContent,
    '</main>',
    sourceBounds.afterMain,
    '<script defer src="/assets/js/seo-metadata.js"></script>\n<script defer src="/assets/js/app.js"></script>\n',
    sourceBounds.afterScripts
  ].join('');
  const outputFile = routePath === '/'
    ? path.join(outputRoot, 'index.html')
    : path.join(outputRoot, ...routePath.split('/').filter(Boolean), 'index.html');
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, page);
  validateGeneratedPage(page, metadata);
}

for (const file of ['404.html', '_headers', '_redirects', 'robots.txt', 'sitemap.xml']) {
  await fs.copyFile(path.join(projectRoot, file), path.join(outputRoot, file));
}
await fs.copyFile(path.join(projectRoot, 'sw (3).js'), path.join(outputRoot, 'sw.js'));

console.log(`Built ${sitemapPaths.length} route-specific HTML files in dist/.`);
console.log(`Shared assets: assets/css/toolnest.css, assets/js/app.js, assets/js/extra-tools.js, assets/js/seo-metadata.js.`);

function buildRouteMetadata(data) {
  const routes = {};
  const addRoute = (routePath, title, description, breadcrumbs, visibleName, kind, extra = {}) => {
    if (routes[routePath]) throw new Error(`Duplicate metadata path: ${routePath}`);
    const canonical = `${siteOrigin}${routePath}`;
    const graph = [{
      '@type': 'WebPage',
      '@id': `${canonical}#webpage`,
      name: title,
      description,
      url: canonical,
      isPartOf: { '@id': `${siteOrigin}/#website` }
    }];
    if (routePath === '/') {
      graph.unshift({ '@type': 'WebSite', '@id': `${siteOrigin}/#website`, name: sourceSiteName, url: `${siteOrigin}/` });
    } else {
      graph.push({
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumbs.map((crumb, index) => ({
          '@type': 'ListItem', position: index + 1, name: crumb.name, item: `${siteOrigin}${crumb.path}`
        }))
      });
    }
    routes[routePath] = {
      path: routePath,
      kind,
      title,
      description,
      canonical,
      robots: 'index,follow',
      og: { title, description, url: canonical, type: 'website', site_name: sourceSiteName },
      twitter: { card: 'summary', title, description, url: canonical },
      breadcrumbs,
      structuredData: { '@context': 'https://schema.org', '@graph': graph },
      visibleName,
      ...extra
    };
  };

  addRoute('/', sourceTitle, sourceDescription, [], 'Free Online Tools for Everyday Tasks', 'home');
  for (const [category, page] of Object.entries(data.categories)) {
    const routePath = `/${data.categorySlugs[category]}/`;
    const name = page[0];
    addRoute(routePath, `Free ${name} | ToolNest`, page[1], [
      { name: 'Home', path: '/' }, { name, path: routePath }
    ], name, 'category', { category });
  }
  for (const [key, page] of Object.entries(data.infoPages)) {
    const routePath = `/${key}/`;
    const title = key === 'about'
      ? 'About ToolNest | Our Approach'
      : key === 'contact' ? 'Contact ToolNest | Send Feedback' : `${page.title} | ToolNest`;
    addRoute(routePath, title, page.description, [
      { name: 'Home', path: '/' }, { name: page.title, path: routePath }
    ], page.title, 'info', { infoKey: key, body: page.body });
  }
  for (const tool of data.tools) {
    const routePath = `/tools/${tool.id}/`;
    if (routes[routePath]) continue;
    const descriptionWithSuffix = `${tool.description} Free to use in your browser, with no account required.`;
    const description = descriptionWithSuffix.length <= 160 ? descriptionWithSuffix : tool.description;
    const title = data.titleOverrides[tool.id] || `Free ${tool.name} | ToolNest`;
    const categoryName = data.categories[tool.category]?.[0];
    if (!categoryName) throw new Error(`Tool ${tool.id} has an unknown category ${tool.category}.`);
    addRoute(routePath, title, description, [
      { name: 'Home', path: '/' },
      { name: categoryName, path: `/${data.categorySlugs[tool.category]}/` },
      { name: tool.name, path: routePath }
    ], tool.name, 'tool', {
      toolId: tool.id,
      category: tool.category,
      categoryName,
      toolDescription: tool.description,
      instructions: data.instructions[tool.id],
      relatedToolIds: data.related[tool.id] || []
    });
  }
  return routes;
}

function renderHeadMetadata(metadata, siteName) {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const canonical = escapeHtml(metadata.canonical);
  const structuredData = JSON.stringify(metadata.structuredData).replace(/</g, '\\u003c');
  return `\n<title>${title}</title>\n` +
    `<meta name="description" content="${description}">\n` +
    `<meta name="robots" content="${metadata.robots}">\n` +
    `<link rel="canonical" href="${canonical}">\n` +
    `<meta property="og:title" content="${escapeHtml(metadata.og.title)}">\n` +
    `<meta property="og:description" content="${escapeHtml(metadata.og.description)}">\n` +
    `<meta property="og:url" content="${escapeHtml(metadata.og.url)}">\n` +
    `<meta property="og:type" content="${metadata.og.type}">\n` +
    `<meta property="og:site_name" content="${escapeHtml(siteName)}">\n` +
    `<meta name="twitter:card" content="${metadata.twitter.card}">\n` +
    `<meta name="twitter:title" content="${escapeHtml(metadata.twitter.title)}">\n` +
    `<meta name="twitter:description" content="${escapeHtml(metadata.twitter.description)}">\n` +
    `<meta name="twitter:url" content="${escapeHtml(metadata.twitter.url)}">\n` +
    `<link rel="stylesheet" href="/assets/css/toolnest.css">\n` +
    `<script type="application/ld+json" id="structured-data">${structuredData}</script>\n`;
}

function renderRouteMount(metadata, data) {
  let routeContent;
  if (metadata.kind === 'category') {
    const tools = data.tools.filter(tool => tool.category === metadata.category);
    routeContent = `<article class="category-page">${renderBreadcrumbs(metadata.breadcrumbs)}<h1>${escapeHtml(metadata.visibleName)}</h1><p>${escapeHtml(metadata.description)}</p><div class="tools-grid" style="margin-top:24px;">${tools.map(tool => `<a class="tool-card" href="/tools/${escapeHtml(tool.id)}/" aria-label="Open ${escapeHtml(tool.name)}"><div class="tool-icon" aria-hidden="true">${escapeHtml(tool.icon)}</div><h3>${escapeHtml(tool.name)}</h3><p>${escapeHtml(tool.description)}</p></a>`).join('')}</div></article>`;
  } else if (metadata.kind === 'info') {
    routeContent = `<article class="info-page">${renderBreadcrumbs(metadata.breadcrumbs)}<h1>${escapeHtml(metadata.visibleName)}</h1>${metadata.body}</article>`;
  } else {
    const related = metadata.relatedToolIds
      .map(id => data.tools.find(tool => tool.id === id))
      .filter(Boolean)
      .slice(0, 4);
    routeContent = `${renderBreadcrumbs(metadata.breadcrumbs)}<div class="tool-header"><h1>Free ${escapeHtml(metadata.visibleName)}</h1><p>${escapeHtml(metadata.toolDescription)}</p></div>` +
      `<div class="tool-panel" id="toolPanel"></div><section class="tool-content"><h2>How to use ${escapeHtml(metadata.visibleName)}</h2><p>${escapeHtml(metadata.instructions)}</p></section>` +
      `<section class="tool-content"><h2>Related tools</h2><p>${related.map(tool => `<a href="/tools/${escapeHtml(tool.id)}/">Try ${escapeHtml(tool.name)}</a>`).join(' · ')}</p></section>`;
  }
  return `${homeMarkupWithoutHeading}\n<div id="toolView" class="tool-view active" role="region" aria-live="polite">${routeContent}</div>`;
}

function renderBreadcrumbs(breadcrumbs) {
  return `<nav aria-label="Breadcrumb">${breadcrumbs.map((crumb, index) => index === breadcrumbs.length - 1
    ? escapeHtml(crumb.name)
    : `<a href="${escapeHtml(crumb.path)}">${escapeHtml(crumb.name)}</a>`).join(' / ')}</nav>`;
}

function getHomeMarkup(html) {
  const main = getMainContent(html);
  const start = main.indexOf('<div id="homeView">');
  const end = main.indexOf('<!-- TOOL VIEW -->', start);
  if (start < 0 || end < 0) throw new Error('Could not extract the homepage view.');
  return main.slice(start, end).trim();
}

function getMainContent(html) {
  const start = html.indexOf('<main id="main">');
  const contentStart = start + '<main id="main">'.length;
  const end = html.indexOf('</main>', contentStart);
  if (start < 0 || end < 0) throw new Error('Could not extract the application main element.');
  return html.slice(contentStart, end).trim();
}

function getHeadBase(html) {
  const headStart = html.indexOf('<head>') + '<head>'.length;
  const headEnd = html.indexOf('</head>', headStart);
  if (headStart < '<head>'.length || headEnd < 0) throw new Error('Could not extract the document head.');
  return html.slice(headStart, headEnd)
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta name="description"[^>]*>/i, '')
    .replace(/<link rel="canonical"[^>]*>/i, '')
    .replace(/<meta property="og:[^"]+"[^>]*>/gi, '')
    .replace(/<meta name="twitter:[^"]+"[^>]*>/gi, '')
    .replace(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/i, '')
    .replace(/<style>[\s\S]*?<\/style>/i, '')
    .trim();
}

function getDocumentBounds(html) {
  const headStart = html.indexOf('<head>');
  const headEnd = html.indexOf('</head>');
  const bodyStart = html.indexOf('<body>') + '<body>'.length;
  const mainStart = html.indexOf('<main id="main">');
  const mainEnd = html.indexOf('</main>', mainStart) + '</main>'.length;
  const scriptStart = html.indexOf('<script>', mainEnd);
  const scriptEnd = html.indexOf('</script>', scriptStart) + '</script>'.length;
  if ([headStart, headEnd, bodyStart, mainStart, mainEnd, scriptStart, scriptEnd].some(index => index < 0)) {
    throw new Error('Could not split the source document into shared layout sections.');
  }
  return {
    beforeHead: html.slice(0, headStart + '<head>'.length),
    betweenHeadAndBody: html.slice(headEnd, bodyStart),
    beforeMain: html.slice(bodyStart, mainStart),
    afterMain: html.slice(mainEnd, scriptStart),
    afterScripts: html.slice(scriptEnd)
  };
}

function requiredMatch(source, pattern, description) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Could not find ${description} in index.html.`);
  return match;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function decodeHtml(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function validateGeneratedPage(page, metadata) {
  const requiredTags = [
    `<title>${escapeHtml(metadata.title)}</title>`,
    `<meta name="description" content="${escapeHtml(metadata.description)}">`,
    `<link rel="canonical" href="${escapeHtml(metadata.canonical)}">`,
    `<meta property="og:title" content="${escapeHtml(metadata.og.title)}">`,
    `<meta property="og:description" content="${escapeHtml(metadata.og.description)}">`,
    `<meta property="og:url" content="${escapeHtml(metadata.og.url)}">`,
    `<meta name="twitter:title" content="${escapeHtml(metadata.twitter.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(metadata.twitter.description)}">`
  ];
  if (requiredTags.some(tag => !page.includes(tag))) throw new Error(`Generated head metadata is incomplete for ${metadata.path}.`);
  if ((page.match(/<link rel="canonical"/g) || []).length !== 1) throw new Error(`Expected one canonical for ${metadata.path}.`);
  if ((page.match(/<h1\b/gi) || []).length !== 1) throw new Error(`Expected one initial H1 for ${metadata.path}.`);
  const jsonLd = requiredMatch(page, /<script type="application\/ld\+json" id="structured-data">([\s\S]*?)<\/script>/i, `JSON-LD for ${metadata.path}`)[1];
  const structuredData = JSON.parse(jsonLd);
  if (structuredData['@graph'].find(item => item['@type'] === 'WebPage')?.url !== metadata.canonical) {
    throw new Error(`Structured data URL does not match canonical for ${metadata.path}.`);
  }
}