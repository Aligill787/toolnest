import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(projectRoot, 'dist');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

http.createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  let file = path.resolve(siteRoot, `.${pathname}`);
  if (file !== siteRoot && !file.startsWith(`${siteRoot}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const body = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    try {
      const notFound = await fs.readFile(path.join(siteRoot, '404.html'));
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(notFound);
    } catch {
      response.writeHead(404).end('Not found');
    }
  }
}).listen(4173, '127.0.0.1', () => {
  console.log('Previewing dist/ at http://127.0.0.1:4173');
});