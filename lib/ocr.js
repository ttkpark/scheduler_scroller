/**
 * OCR 모듈 (우선순위: EasyOCR → OpenAI GPT-4o → Claude → Tesseract)
 *
 * EasyOCR: lib/easyocr_server.py를 Python child_process로 실행
 *   → python easyocr 패키지가 설치되어 있어야 함 (pip install easyocr)
 *
 * 환경변수 (EasyOCR 실패 시 AI API 폴백):
 *   OPENAI_API_KEY    → GPT-4o Vision
 *   ANTHROPIC_API_KEY → Claude 3.5 Haiku Vision
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ─── Python 실행파일 탐색 ─────────────────────────────────────────────────────
function findPython() {
  // 우선순위:
  // 1) 환경변수 PYTHON_CMD
  // 2) Windows에서 python3가 없고 python만 있는 경우 대응
  if (process.env.PYTHON_CMD) {
    return process.env.PYTHON_CMD;
  }
  const candidates = ['python', 'python3', 'py'];
  for (const cmd of candidates) {
    try {
      const { execSync } = require('child_process');
      const out = execSync(`${cmd} --version`, { timeout: 3000, stdio: 'pipe' }).toString();
      if (out.includes('Python 3')) return cmd;
    } catch (_) {}
  }
  return null;
}

// ─── EasyOCR 프로세스 관리 ────────────────────────────────────────────────────
const EASY_OCR_TIMEOUT_MS = Number(process.env.EASYOCR_TIMEOUT_MS || '180000'); // 기본 180초
const SCRIPT_PATH = path.join(__dirname, 'easyocr_server.py');

let pyProc = null;
let pyReady = false;
let pyInitPromise = null;
let pendingResolve = null;
let pendingReject = null;
let dataBuffer = '';

function startPython() {
  if (pyInitPromise) return pyInitPromise;

  pyInitPromise = new Promise((resolve, reject) => {
    const pythonCmd = findPython();
    if (!pythonCmd) {
      return reject(new Error('Python 3를 찾을 수 없습니다. Python을 설치하세요.'));
    }

    console.log(`[EasyOCR] Python (${pythonCmd}) 프로세스 시작 중...`);
    pyProc = spawn(pythonCmd, [SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });

    pyProc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[EasyOCR-py] ${msg}`);
    });

    pyProc.on('error', (err) => {
      console.error('[EasyOCR] 프로세스 오류:', err.message);
      pyProc = null;
      pyReady = false;
      pyInitPromise = null;
      if (pendingReject) { pendingReject(err); pendingReject = null; }
      reject(err);
    });

    pyProc.on('exit', (code) => {
      console.log(`[EasyOCR] 프로세스 종료 (코드: ${code})`);
      pyProc = null;
      pyReady = false;
      pyInitPromise = null;
    });

    pyProc.stdout.setEncoding('utf8');
    pyProc.stdout.on('data', (chunk) => {
      dataBuffer += chunk.toString();
      const lines = dataBuffer.split('\n');
      dataBuffer = lines.pop(); // 마지막 불완전한 줄은 버퍼에 보존
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed;
        try { parsed = JSON.parse(trimmed); } catch (_) {
          console.log('[EasyOCR-py-raw]', trimmed);
          continue;
        }
        if (pendingResolve) {
          const res = pendingResolve;
          pendingResolve = null;
          pendingReject = null;
          res(parsed);
        }
      }
    });

    // init 명령 전송
    const initCmd = JSON.stringify({ cmd: 'init', languages: ['ko', 'en'] });
    pendingResolve = (result) => {
      if (result.status === 'success') {
        console.log('[EasyOCR] 초기화 완료');
        pyReady = true;
        resolve(true);
      } else {
        reject(new Error(result.message || 'EasyOCR 초기화 실패'));
      }
    };
    pendingReject = reject;
    pyProc.stdin.write(initCmd + '\n');
  });

  return pyInitPromise;
}

function sendCommand(cmd) {
  return new Promise((resolve, reject) => {
    if (!pyProc) return reject(new Error('Python 프로세스가 실행되지 않았습니다.'));
    const timeout = setTimeout(() => {
      pendingResolve = null;
      pendingReject = null;
      reject(new Error(`EasyOCR 응답 타임아웃 (${Math.round(EASY_OCR_TIMEOUT_MS / 1000)}초)`));
    }, EASY_OCR_TIMEOUT_MS);
    pendingResolve = (result) => { clearTimeout(timeout); resolve(result); };
    pendingReject = (err) => { clearTimeout(timeout); reject(err); };
    pyProc.stdin.write(JSON.stringify(cmd) + '\n');
  });
}

async function runEasyOCR(imagePath) {
  await startPython();
  if (!pyReady) throw new Error('EasyOCR가 준비되지 않았습니다.');
  const result = await sendCommand({ cmd: 'read_text', path: imagePath });
  if (result.status !== 'success') throw new Error(result.message || 'EasyOCR 인식 실패');
  const items = result.data || [];
  if (items.length === 0) return '';
  return mergeTableColumns(items);
}

/**
 * EasyOCR bbox 결과를 2열 테이블(항목\t담당자) 형태로 조합
 * - x 좌표로 왼쪽/오른쪽 컬럼 구분
 * - y 좌표로 같은 행 묶기
 */
function mergeTableColumns(items) {
  if (!items.length) return '';

  // 이미지 너비 추정: bbox x 최대값으로
  const allX = items.flatMap((i) => i.bbox.map((p) => p[0]));
  const maxX = Math.max(...allX);
  const midX = maxX * 0.4; // 40% 지점 기준: 왼쪽 열 vs 오른쪽 열

  // bbox로부터 중심 y, x 계산
  const annotated = items.map((item) => {
    const ys = item.bbox.map((p) => p[1]);
    const xs = item.bbox.map((p) => p[0]);
    return {
      text: item.text,
      cy: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
      cx: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
      minX: Math.min(...xs),
    };
  });

  annotated.sort((a, b) => a.cy - b.cy);

  // y 기준으로 같은 행 묶기 (y 차이 30px 이내)
  const rows = [];
  for (const item of annotated) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(item.cy - lastRow.cy) <= 30) {
      lastRow.items.push(item);
      lastRow.cy = Math.round((lastRow.cy + item.cy) / 2);
    } else {
      rows.push({ cy: item.cy, items: [item] });
    }
  }

  // 각 행에서 왼쪽/오른쪽 분리 후 탭으로 결합
  return rows
    .map((row) => {
      const left = row.items
        .filter((i) => i.minX < midX)
        .sort((a, b) => a.cx - b.cx)
        .map((i) => i.text)
        .join(' ');
      const right = row.items
        .filter((i) => i.minX >= midX)
        .sort((a, b) => a.cx - b.cx)
        .map((i) => i.text)
        .join(' ');
      if (left && right) return `${left}\t${right}`;
      return left || right;
    })
    .filter(Boolean)
    .join('\n');
}

// ─── AI 프롬프트 (폴백용) ──────────────────────────────────────────────────────
const TABLE_PROMPT = `이 이미지는 예배/행사 순서지입니다.
두 열로 이루어진 테이블 형태이며, 왼쪽은 순서 항목명, 오른쪽은 담당자/내용입니다.
★ 또는 * 기호가 있으면 그대로 포함해주세요.

다음 형식으로만 출력하세요 (탭 구분, 헤더 없음):
항목명\t담당자/내용

인식이 불확실한 글자도 최대한 한국어로 추정해서 채워주세요.`;

async function runOpenAI(imagePath) {
  if (!process.env.OPENAI_API_KEY) return null;
  const { OpenAI } = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  const ext = imagePath.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 2000,
    messages: [{ role: 'user', content: [
      { type: 'text', text: TABLE_PROMPT },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' } },
    ]}],
  });
  return response.choices?.[0]?.message?.content || '';
}

async function runClaude(imagePath) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  const ext = imagePath.split('.').pop().toLowerCase();
  const mediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 2000,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: TABLE_PROMPT },
    ]}],
  });
  const block = response.content?.[0];
  return block?.type === 'text' ? block.text : '';
}

function normalizeAiResult(raw) {
  if (!raw) return '';
  return raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('```')).join('\n');
}

// ─── Tesseract 폴백 ──────────────────────────────────────────────────────────
async function preprocessForTesseract(inputPath, sharp) {
  const meta = await sharp(inputPath).metadata();
  const { width, height } = meta;
  const scale = Math.min(width, height) < 600 || Math.max(width, height) < 800 ? 2 : 1;
  const outputPath = inputPath.replace(/(\.\w+)$/, '_preprocess$1');
  await sharp(inputPath)
    .resize(Math.round(width * scale), Math.round(height * scale), { kernel: sharp.kernel.lanczos3 })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.2, m1: 1, m2: 0.5 })
    .toFile(outputPath);
  return outputPath;
}

async function runTesseract(imagePath) {
  const Tesseract = require('tesseract.js');
  const PSM = Tesseract.PSM || { AUTO: '3' };
  const result = await Tesseract.recognize(imagePath, 'kor+eng', {
    tessedit_pageseg_mode: String(PSM.AUTO || '3'),
  });
  return result.data.text || '';
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────
async function recognize(imagePath) {
  // 1순위: EasyOCR
  try {
    console.log('[OCR] EasyOCR 시도...');
    const text = await runEasyOCR(imagePath);
    if (text && text.trim().length > 5) {
      console.log('[OCR] EasyOCR 성공');
      return { text: text.trim(), engine: 'easyocr' };
    }
  } catch (e) {
    console.warn('[OCR] EasyOCR 실패:', e.message);
  }

  // 2순위: OpenAI GPT-4o
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log('[OCR] GPT-4o Vision 시도...');
      const text = normalizeAiResult(await runOpenAI(imagePath));
      if (text && text.trim().length > 5) {
        console.log('[OCR] GPT-4o Vision 성공');
        return { text: text.trim(), engine: 'gpt-4o' };
      }
    } catch (e) {
      console.warn('[OCR] GPT-4o 실패:', e.message);
    }
  }

  // 3순위: Claude
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      console.log('[OCR] Claude Vision 시도...');
      const text = normalizeAiResult(await runClaude(imagePath));
      if (text && text.trim().length > 5) {
        console.log('[OCR] Claude Vision 성공');
        return { text: text.trim(), engine: 'claude' };
      }
    } catch (e) {
      console.warn('[OCR] Claude 실패:', e.message);
    }
  }

  // 최후: Tesseract
  console.log('[OCR] Tesseract 폴백 사용');
  let processPath = imagePath;
  let preprocessedPath = null;
  try {
    preprocessedPath = await preprocessForTesseract(imagePath, require('sharp'));
    processPath = preprocessedPath;
  } catch (e) {
    console.warn('[OCR] 전처리 스킵:', e.message);
  }
  try {
    const text = await runTesseract(processPath);
    return { text: (text || '').trim(), engine: 'tesseract' };
  } finally {
    if (preprocessedPath && preprocessedPath !== imagePath && fs.existsSync(preprocessedPath)) {
      fs.unlinkSync(preprocessedPath);
    }
  }
}

// 서버 종료 시 Python 프로세스 정리
process.on('exit', () => { if (pyProc) try { pyProc.kill(); } catch (_) {} });
process.on('SIGINT', () => { if (pyProc) try { pyProc.kill(); } catch (_) {} process.exit(0); });

module.exports = { recognize };
