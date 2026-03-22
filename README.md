## Sunday Service Scroller 설치/운영 가이드

이 프로젝트는 예배/행사 순서를 자동 스크롤로 보여주고, 웹에서 원격으로 제어할 수 있는 Node.js + Python(EasyOCR) 기반 프로그램입니다.

아래 내용은 **포트 8003 기준**, **Python venv 사용** 및 **리눅스 부팅 시 자동 실행**까지 포함한 설치 방법입니다.

---

## 1. 필수 요구 사항

- **Node.js** 18 이상
- **Python 3.8 이상**
- Git (선택)

---

## 2. 소스 코드 가져오기

```bash
git clone https://github.com/ttkpark/scheduler_scroller
cd scheduler_scroller
```

이미 압축으로 받았다면, 해당 폴더로 이동만 하면 됩니다.

---

## 3. 공통: Node.js 의존성 설치

```bash
npm install
```

---

## 4. Python venv 구성 및 EasyOCR 설치

이 프로젝트는 `lib/easyocr_server.py`를 통해 Python EasyOCR를 사용합니다.  
Python 패키지는 venv에만 설치되도록 다음 과정을 따라 주세요.

### 4-1. Windows에서 venv 생성 및 설치

PowerShell 기준:

```powershell
cd scheduler_scroller
python -m venv .venv
.venv\Scripts\pip install --upgrade pip
.venv\Scripts\pip install -r requirements.txt
```

또는 **npm 스크립트**를 사용:

```powershell
npm run setup:py:win
```

### 4-2. Linux에서 venv 생성 및 설치

```bash
cd scheduler_scroller
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

또는:

```bash
npm run setup:py:linux
```

---

## 5. 서버 실행 (포트 8003, venv 사용)

서버는 기본적으로 `PORT` 환경변수 또는 **8003 포트**에서 동작합니다.

### 5-1. Windows에서 실행

1) venv Python을 가리키도록 `PYTHON_CMD` 환경 변수를 설정하고,  
2) `npm start`로 서버를 실행합니다.

```powershell
cd scheduler_scroller
$env:PYTHON_CMD = ".venv\Scripts\python.exe"
npm start
```

이후 아래 주소로 접속할 수 있습니다.

- `http://localhost:8003/display`
- `http://localhost:8003/controller`
- `http://localhost:8003/admin`
- `http://localhost:8003/settings`

### 5-2. Linux에서 실행 (수동 실행)

```bash
cd scheduler_scroller
. .venv/bin/activate
export PYTHON_CMD="$(pwd)/.venv/bin/python"
export PORT=8003
npm start
``>

또는 제공된 스크립트 사용:

```bash
cd scheduler_scroller
chmod +x scripts/start_linux.sh
./scripts/start_linux.sh
```

---

## 6. 리눅스 부팅 시 자동 실행 (systemd)

리눅스 서버에서 컴퓨터가 켜질 때 자동으로 이 프로그램을 실행하려면, `systemd` 서비스를 이용할 수 있습니다.

### 6-1. 파일 배치

예시로 `/opt/scheduler_scroller`에 코드를 배치한다고 가정합니다.

```bash
sudo mkdir -p /opt/scheduler_scroller
sudo chown -R $USER:$USER /opt/scheduler_scroller
cp -r * /opt/scheduler_scroller
cd /opt/scheduler_scroller
```

필요하다면 여기서 3~5번 과정을 다시 수행합니다 (`npm install`, venv 생성 및 `pip install` 등).

### 6-2. systemd 서비스 파일 설치

레포지토리에는 예시 서비스 파일이 `scripts/scheduler_scroller.service`로 포함돼 있습니다.  
이 파일을 `/etc/systemd/system/` 아래에 복사한 후, systemd에 등록합니다.

```bash
sudo cp scripts/scheduler_scroller.service /etc/systemd/system/scheduler_scroller.service
sudo systemctl daemon-reload
sudo systemctl enable scheduler_scroller.service
sudo systemctl start scheduler_scroller.service
```

이제 서버가 부팅될 때마다 자동으로 `PORT=8003`에서 서비스가 시작됩니다.

상태 확인:

```bash
sudo systemctl status scheduler_scroller.service
```

중지/재시작:

```bash
sudo systemctl stop scheduler_scroller.service
sudo systemctl restart scheduler_scroller.service
```

> 주의: 서비스 파일 안의 `WorkingDirectory`와 `ExecStart` 경로가 실제 설치 경로(`/opt/scheduler_scroller` 등)와 일치하는지 꼭 확인하세요.

---

## 7. Git 커밋 시 대용량/불필요 파일 관리

레포지토리에는 다음과 같은 `.gitignore`가 포함되어 있습니다.

```text
node_modules/
uploads/
.venv/
npm-debug.log*
*.log
```

- **`uploads/`**: 사용자가 업로드하는 이미지/파일이 저장되는 폴더로, 용량이 커질 수 있으므로 Git에 커밋되지 않도록 제외합니다.
- **`.venv/`**: Python 가상환경은 환경마다 달라지므로 커밋하지 않습니다.
- **`node_modules/`**: `npm install`로 복구 가능한 파일들이므로 커밋하지 않습니다.

필요한 경우 `eng.traineddata`, `kor.traineddata` 등의 OCR 데이터는 레포지토리에 포함하거나, 별도 배포 정책에 따라 관리하면 됩니다.

---

## 8. 환경 변수 (선택)

- **`PORT`**: 서버 포트. 기본값은 `8003`입니다.
- **`PYTHON_CMD`**: Node 서버가 사용할 Python 실행 파일 경로.  
  - 설정하지 않으면 `python`, `python3`, `py` 순으로 자동 탐색합니다.
  - venv를 사용할 경우, 위 예시처럼 venv Python 경로를 지정해 주세요.
- **`DISABLE_EASYOCR`**: `1`, `true`, `yes` 중 하나면 **EasyOCR를 전혀 호출하지 않습니다.**  
  이후 순서는 GPT-4o Vision → Claude Vision → Tesseract 입니다. (리소스가 적은 서버에 권장)
- **`OCR_ENGINE`**: `tesseract` 또는 `tesseract-only` 로 두면 **`DISABLE_EASYOCR=1`과 동일**하게 EasyOCR를 건너뜁니다.
- **`EASYOCR_TIMEOUT_MS`**: EasyOCR 응답 대기 시간(밀리초). 기본 `180000`(180초).
- **`OPENAI_API_KEY`**: 설정 시 GPT-4o Vision을 사용한 OCR 폴백이 활성화됩니다.
- **`ANTHROPIC_API_KEY`**: 설정 시 Claude Vision을 사용한 OCR 폴백이 활성화됩니다.

### systemd에서 EasyOCR 끄기 예시

`/etc/systemd/system/scheduler_scroller.service`의 `[Service]`에 한 줄 추가:

```ini
Environment=DISABLE_EASYOCR=1
```

그 다음:

```bash
sudo systemctl daemon-reload
sudo systemctl restart scheduler_scroller.service
```

부팅 시 로그에 `OCR 엔진:   Tesseract (EasyOCR 끔)` 처럼 표시되면 적용된 것입니다.

---

## 9. 요약

- **포트**: 기본 8003 (`server.js` 에서 `process.env.PORT || 8003`).
- **Python venv**: `requirements.txt` 기반으로 EasyOCR 설치.
- **Windows**: `.venv\Scripts\python.exe`를 `PYTHON_CMD`로 지정 후 `npm start`.
- **Linux**: `scripts/start_linux.sh` 또는 `systemd` 서비스(`scheduler_scroller.service`)로 자동 실행 구성.

