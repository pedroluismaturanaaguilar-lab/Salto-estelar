const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function serve(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', game: 'Salto Estelar' }));
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch {
    res.writeHead(400); res.end('Solicitud incorrecta'); return;
  }
  if (pathname === '/') pathname = '/index.html';
  const filename = path.resolve(ROOT, '.' + pathname);
  if (!filename.startsWith(ROOT + path.sep) && filename !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); res.end('Prohibido'); return;
  }
  fs.stat(filename, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); res.end('No encontrado'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(filename)] || 'application/octet-stream' });
    fs.createReadStream(filename).pipe(res);
  });
}

const preferredPort = process.env.PORT ? Number(process.env.PORT) : 3006;
const lastPort = process.env.PORT ? preferredPort : 3100;
function listen(port) {
  const server = http.createServer(serve);
  server.once('error', error => {
    if (error.code === 'EADDRINUSE' && port < lastPort) return listen(port + 1);
    console.error(error.code === 'EADDRINUSE' ? 'No hay puertos libres en el rango configurado.' : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '0.0.0.0', () => {
    console.log('Salto Estelar disponible en http://localhost:' + port);
    console.log('Para abrirlo desde otro dispositivo en la misma red, usa la IP de este computador y el puerto ' + port + '.');
  });
}
listen(preferredPort);
