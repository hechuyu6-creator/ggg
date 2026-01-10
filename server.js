const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const HOST = '0.0.0.0'; // Allow access from local network
const DATA_FILE = path.join(__dirname, 'chat_data.json');

// ANSI Colors for Termux
const CLR = {
    Reset: "\x1b[0m",
    Red: "\x1b[31m",
    Green: "\x1b[32m",
    Yellow: "\x1b[33m",
    Blue: "\x1b[36m",
    Magenta: "\x1b[35m",
    Cyan: "\x1b[36m",
    Dim: "\x1b[2m",
    Bold: "\x1b[1m"
};

const getTimestamp = () => {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
};

const log = (type, msg, details = '') => {
    const time = getTimestamp();
    let color = CLR.Reset;
    let icon = '•';
    
    if (type === 'GET') { color = CLR.Cyan; icon = '⬇'; }
    if (type === 'POST') { color = CLR.Green; icon = '⬆'; }
    if (type === 'ERR') { color = CLR.Red; icon = '✖'; }
    if (type === 'INFO') { color = CLR.Yellow; icon = 'ℹ'; }
    if (type === 'OPTIONS') { color = CLR.Dim; icon = '◌'; }

    console.log(
        CLR.Dim + '[' + time + ']' + CLR.Reset + ' ' + 
        color + icon + ' ' + type.padEnd(7) + CLR.Reset + ' ' + 
        msg + ' ' + (details ? CLR.Dim + details + CLR.Reset : '')
    );
};

const server = http.createServer((req, res) => {
  // --- 1. Robust CORS ---
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  const clientIp = req.socket.remoteAddress;

  // --- 2. Handle Preflight ---
  if (req.method === 'OPTIONS') {
    log('OPTIONS', 'Preflight Check', 'from ' + clientIp);
    res.writeHead(204);
    res.end();
    return;
  }

  // --- 3. Heartbeat (Silent) ---
  if (req.url === '/ping') {
      res.writeHead(200);
      res.end('pong');
      return;
  }

  // --- 4. GET /data ---
  if (req.method === 'GET' && req.url === '/data') {
    fs.readFile(DATA_FILE, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
            log('GET', 'Data Init (New File)', 'from ' + clientIp);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([]));
        } else {
            log('ERR', 'Read Failed', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to read data' }));
        }
      } else {
        const sizeKB = (Buffer.byteLength(data) / 1024).toFixed(2);
        log('GET', 'Data Read', sizeKB + ' KB sent to ' + clientIp);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      }
    });
  }
  // --- 5. POST /data ---
  else if (req.method === 'POST' && req.url === '/data') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('error', (err) => {
        log('ERR', 'Stream Error', err.message);
        res.writeHead(500);
        res.end();
    });
    req.on('end', () => {
      try {
          JSON.parse(body); // Validate JSON
          const sizeKB = (Buffer.byteLength(body) / 1024).toFixed(2);
          
          fs.writeFile(DATA_FILE, body, (err) => {
            if (err) {
              log('ERR', 'Write Failed', err.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to save data' }));
            } else {
              log('POST', 'Data Saved', sizeKB + ' KB received from ' + clientIp);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            }
          });
      } catch (e) {
          log('ERR', 'Invalid JSON', 'from ' + clientIp);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else {
    if (req.url === '/') {
        res.writeHead(200);
        res.end('WeChat AI Local Server Running');
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
  }
});

server.listen(PORT, HOST, () => {
  console.clear();
  console.log(CLR.Green);
  console.log('=================================================');
  console.log(' WECHAT AI - LOCAL SERVER RUNNING (v1.2)');
  console.log('=================================================');
  console.log(' Status:   ' + CLR.Bold + 'ONLINE' + CLR.Reset);
  console.log(' Address:  http://' + HOST + ':' + PORT);
  console.log(' DataFile: ' + DATA_FILE);
  console.log(' Logs:     Real-time requests below...');
  console.log('=================================================' + CLR.Reset + '\n');
});