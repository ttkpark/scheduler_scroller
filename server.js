const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const ocr = require('./lib/ocr');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '잘못된 JSON 형식입니다.' });
  next(err);
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/controller', (req, res) => res.sendFile(path.join(__dirname, 'public', 'controller.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('이미지 파일만 업로드 가능합니다.'));
  }
});

let scheduleState = {
  items: [], currentIndex: 0, autoScroll: false, scrollSpeed: 3, imageUrl: null
};

// ─── Upload + OCR (with optional crop) ─────────────────────────────
app.post('/api/upload', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || '업로드 오류' });
    try {
      if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
      const imageUrl = `/uploads/${req.file.filename}`;
      scheduleState.imageUrl = imageUrl;

      // Get image dimensions for the client
      const meta = await sharp(req.file.path).metadata();
      res.json({ imageUrl, width: meta.width, height: meta.height, ocrText: '' });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });
});

// ─── OCR with optional crop region ──────────────────────────────────
app.post('/api/ocr', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const { imageFile, crop } = req.body;
    if (!imageFile) return res.status(400).json({ error: 'imageFile이 없습니다.' });

    const filePath = path.join(__dirname, 'uploads', path.basename(imageFile));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });

    let processPath = filePath;

    // Crop if region provided
    if (crop && crop.x !== undefined) {
      const meta = await sharp(filePath).metadata();
      const cx = Math.max(0, Math.round(crop.x));
      const cy = Math.max(0, Math.round(crop.y));
      const cw = Math.min(meta.width - cx, Math.round(crop.w));
      const ch = Math.min(meta.height - cy, Math.round(crop.h));

      if (cw > 10 && ch > 10) {
        processPath = filePath.replace(/(\.\w+)$/, '_crop$1');
        await sharp(filePath)
          .extract({ left: cx, top: cy, width: cw, height: ch })
          .normalize()
          .sharpen()
          .toFile(processPath);
      }
    }

    const { text: ocrText, engine } = await ocr.recognize(processPath);
    console.log(`[OCR] 사용 엔진: ${engine} | 인식 글자 수: ${ocrText.length}`);

    // Clean up crop file
    if (processPath !== filePath && fs.existsSync(processPath)) {
      fs.unlinkSync(processPath);
    }

    res.json({ ocrText, engine });
  } catch (e) {
    console.error('OCR error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Schedule save ───────────────────────────────────────────────────
app.post('/api/schedule', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: '잘못된 데이터' });
  scheduleState.items = items.map((item, i) => ({
    id: item.id || uuidv4(),
    order: i + 1,
    title: item.title || '',
    detail: item.detail || '',
    category: item.category || 'default',
    duration: item.duration || ''
  }));
  scheduleState.currentIndex = 0;
  io.emit('schedule:update', scheduleState);
  res.json({ success: true, state: scheduleState });
});

app.get('/api/state', (req, res) => res.json(scheduleState));

// ─── LAN 접속용 서버 정보 (같은 네트워크에서 접근 가능) ─────────────────────
function getLocalIPv4() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}
const PORT = process.env.PORT || 3500;
app.get('/api/server-info', (req, res) => {
  const localIps = getLocalIPv4();
  const urls = localIps.map(ip => `http://${ip}:${PORT}`);
  res.json({ port: PORT, localIps, urls });
});

// ─── Socket.IO ───────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('schedule:update', scheduleState);

  socket.on('control:next', () => {
    if (scheduleState.currentIndex < scheduleState.items.length - 1) {
      scheduleState.currentIndex++;
      io.emit('schedule:update', scheduleState);
    }
  });
  socket.on('control:prev', () => {
    if (scheduleState.currentIndex > 0) {
      scheduleState.currentIndex--;
      io.emit('schedule:update', scheduleState);
    }
  });
  socket.on('control:goto', ({ index }) => {
    if (index >= 0 && index < scheduleState.items.length) {
      scheduleState.currentIndex = index;
      io.emit('schedule:update', scheduleState);
    }
  });
  socket.on('control:autoScroll', ({ enabled, speed }) => {
    scheduleState.autoScroll = enabled;
    if (speed !== undefined) scheduleState.scrollSpeed = speed;
    io.emit('schedule:update', scheduleState);
  });
  socket.on('control:updateItem', ({ id, field, value }) => {
    const item = scheduleState.items.find(i => i.id === id);
    if (item) { item[field] = value; io.emit('schedule:update', scheduleState); }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIps = getLocalIPv4();
  console.log(`\nServer running at http://localhost:${PORT}`);
  if (localIps.length) {
    console.log(`  LAN 접속 (같은 네트워크):`);
    localIps.forEach(ip => console.log(`    http://${ip}:${PORT}`));
  }
  console.log(`  Display:    http://localhost:${PORT}/display`);
  console.log(`  Controller: http://localhost:${PORT}/controller`);
  console.log(`  Admin:      http://localhost:${PORT}/admin`);
  console.log(`  Settings:   http://localhost:${PORT}/settings`);
  const ocrEngine = process.env.OPENAI_API_KEY
    ? 'GPT-4o Vision'
    : process.env.ANTHROPIC_API_KEY
    ? 'Claude Vision'
    : 'EasyOCR (실패 시 Tesseract)';
  console.log(`  OCR 엔진:   ${ocrEngine}\n`);
});

process.on('uncaughtException', (err) => console.error('[uncaughtException]', err.message));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
