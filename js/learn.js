/* =============================================
   백엔드 설정
   - API_URL: 백엔드 predict 엔드포인트
   - 응답 형식: { label: string, confidence: number }
   ============================================= */
const API_URL = 'http://localhost:8000/predict';

const PREDICT_INTERVAL_MS = 600;
const SUCCESS_THRESHOLD   = 0.70;  // confidence 이 이상이면 정답
const REQUIRED_SUCCESSES  = 4;     // 연속 n회 성공하면 완료

/* =============================================
   단어 데이터
   ============================================= */
const WORDS = {
  hello: {
    kr: '안녕', en: 'Hello', emoji: '👋',
    steps: [
      { e: '🖐️', t: '손을 활짝 펴세요' },
      { e: '👋', t: '얼굴 옆에서 손을 흔들어요' },
      { e: '😊', t: '환하게 웃으면서 해요' },
    ]
  },
  thankyou: {
    kr: '고마워', en: 'Thank You', emoji: '🙏',
    steps: [
      { e: '✋', t: '손을 펴서 입 앞에 가져와요' },
      { e: '⬇️', t: '앞쪽 아래 방향으로 내려요' },
      { e: '🙏', t: '마음을 담아 표현해요' },
    ]
  },
  iloveyou: {
    kr: '사랑해', en: 'I Love You', emoji: '🤟',
    steps: [
      { e: '✊', t: '손을 주먹 쥐어요' },
      { e: '☝️', t: '엄지, 검지, 새끼손가락을 펴요' },
      { e: '🤟', t: '상대방을 향해 보여줘요' },
    ]
  },
  friend: {
    kr: '친구', en: 'Friend', emoji: '🤝',
    steps: [
      { e: '☝️', t: '양손 검지를 구부려요' },
      { e: '🔗', t: '두 검지를 서로 걸어요' },
      { e: '↔️', t: '함께 좌우로 흔들어요' },
    ]
  },
  happy: {
    kr: '행복', en: 'Happy', emoji: '😊',
    steps: [
      { e: '🤲', t: '두 손을 가슴에 대세요' },
      { e: '⬆️', t: '손을 위쪽으로 쓸어 올려요' },
      { e: '😄', t: '활짝 웃으며 표현해요' },
    ]
  }
};

/* =============================================
   상태 (state)
   ============================================= */
let wordKey   = '';
let wordData  = null;
let stream    = null;
let predTimer = null;
let consecOk  = 0;

/* =============================================
   DOM 참조
   ============================================= */
let $video, $canvas, $ctx, $recDot, $camBtn, $placeholder;
let $fbIdle, $fbTrying, $fbSuccess, $fbMsg, $confBar, $confBarWrap;
let $confettiCanvas;

/* =============================================
   초기화
   ============================================= */
function init() {
  const params = new URLSearchParams(window.location.search);
  wordKey  = params.get('word') || 'hello';
  wordData = WORDS[wordKey];

  if (!wordData) {
    location.href = 'index.html';
    return;
  }

  document.title = `${wordData.kr} 배우기 🤟`;

  // 헤더
  document.getElementById('hdr-emoji').textContent = wordData.emoji;
  document.getElementById('hdr-kr').textContent    = wordData.kr;
  document.getElementById('hdr-en').textContent    = wordData.en;

  // 참조 표시
  document.getElementById('ref-emoji').textContent = wordData.emoji;
  document.getElementById('ref-kr').textContent    = wordData.kr;
  document.getElementById('ref-en').textContent    = wordData.en;

  // 스텝 목록
  const list = document.getElementById('steps-list');
  wordData.steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'step-item';
    li.innerHTML =
      `<span class="step-num">${i + 1}</span>` +
      `<span class="step-emoji">${s.e}</span>` +
      `<span class="step-text">${s.t}</span>`;
    list.appendChild(li);
  });

  // DOM 참조 캐시
  $video        = document.getElementById('webcam-video');
  $canvas       = document.getElementById('capture-canvas');
  $ctx          = $canvas.getContext('2d');
  $recDot       = document.getElementById('rec-dot');
  $camBtn       = document.getElementById('cam-btn');
  $placeholder  = document.getElementById('cam-placeholder');
  $fbIdle       = document.getElementById('fb-idle');
  $fbTrying     = document.getElementById('fb-trying');
  $fbSuccess    = document.getElementById('fb-success');
  $fbMsg        = document.getElementById('fb-msg');
  $confBar      = document.getElementById('conf-bar');
  $confBarWrap  = document.getElementById('conf-bar-wrap');
  $confettiCanvas = document.getElementById('confetti-canvas');
}

/* =============================================
   카메라 토글
   ============================================= */
window.toggleCamera = async function () {
  if (stream) {
    stopCamera();
  } else {
    await startCamera();
  }
};

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false
    });
    $video.srcObject = stream;
    $video.removeAttribute('hidden');
    $placeholder.hidden = true;
    $recDot.hidden = false;

    $camBtn.className = 'cam-btn cam-stop';
    $camBtn.innerHTML = '<span>⏹️</span> 카메라 끄기';

    showState('trying');
    startPredicting();
  } catch {
    alert('카메라를 사용할 수 없어요 😢\n카메라 접근 권한을 확인해 주세요!');
  }
}

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;

  $video.srcObject = null;
  $video.hidden = true;
  $placeholder.hidden = false;
  $recDot.hidden = true;

  $camBtn.className = 'cam-btn cam-start';
  $camBtn.innerHTML = '<span>📷</span> 카메라 켜기';

  stopPredicting();
  showState('idle');
  consecOk = 0;
  setBar(0);
}

/* =============================================
   예측 루프
   ============================================= */
function startPredicting() {
  predTimer = setInterval(async () => {
    if (!stream || !$video.videoWidth) return;
    const b64 = captureFrame();
    if (!b64) return;
    const result = await callAPI(b64);
    handleResult(result);
  }, PREDICT_INTERVAL_MS);
}

function stopPredicting() {
  clearInterval(predTimer);
  predTimer = null;
}

function captureFrame() {
  const w = $video.videoWidth;
  const h = $video.videoHeight;
  if (!w || !h) return null;
  $canvas.width  = w;
  $canvas.height = h;
  $ctx.drawImage($video, 0, 0, w, h);
  // base64 (JPEG, 품질 0.8)
  return $canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

/* =============================================
   백엔드 API 호출
   응답 예시: { label: "hello", confidence: 0.92 }
   ============================================= */
async function callAPI(imageB64) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: wordKey, image: imageB64 })
    });
    if (!res.ok) throw new Error('server error');
    return await res.json();
  } catch {
    return { label: null, confidence: 0 };
  }
}

/* =============================================
   결과 처리
   ============================================= */
function handleResult({ label, confidence = 0 }) {
  const pct = Math.min(100, Math.round(confidence * 100));
  setBar(pct);

  const correct = label === wordKey && confidence >= SUCCESS_THRESHOLD;

  if (correct) {
    consecOk++;
    $fbMsg.textContent = consecOk >= REQUIRED_SUCCESSES - 1
      ? '조금만 더! 거의 다 됐어요! 💪'
      : '잘하고 있어요! 🌟';

    if (consecOk >= REQUIRED_SUCCESSES) {
      onSuccess();
    }
  } else {
    consecOk = 0;
    $fbMsg.textContent = '손 모양을 잘 보고 따라해 봐요! ✋';
  }
}

function setBar(pct) {
  $confBar.style.width = `${pct}%`;
  $confBarWrap?.setAttribute('aria-valuenow', pct);
}

/* =============================================
   성공 처리
   ============================================= */
function onSuccess() {
  stopPredicting();
  showState('success');
  launchConfetti();
}

window.resetSession = function () {
  consecOk = 0;
  setBar(0);
  stopConfetti();
  if (stream) {
    showState('trying');
    startPredicting();
  } else {
    showState('idle');
  }
};

/* =============================================
   피드백 상태 전환
   ============================================= */
function showState(state) {
  $fbIdle.hidden    = state !== 'idle';
  $fbTrying.hidden  = state !== 'trying';
  $fbSuccess.hidden = state !== 'success';
}

/* =============================================
   confetti (캔버스 기반)
   ============================================= */
function launchConfetti() {
  $confettiCanvas.removeAttribute('hidden');
  const ctx = $confettiCanvas.getContext('2d');
  $confettiCanvas.width  = window.innerWidth;
  $confettiCanvas.height = window.innerHeight;

  const colors = ['#FF6B6B','#FF9A00','#FFD040','#5CC85C','#5BB8F5','#A855F7','#FF85B3'];
  const pieces = Array.from({ length: 130 }, () => ({
    x:  Math.random() * $confettiCanvas.width,
    y: -10 - Math.random() * 120,
    w:  6 + Math.random() * 8,
    h:  3 + Math.random() * 5,
    vx: (Math.random() - 0.5) * 5,
    vy:  2 + Math.random() * 4,
    vr: (Math.random() - 0.5) * 0.2,
    rot: Math.random() * Math.PI * 2,
    color: colors[Math.floor(Math.random() * colors.length)],
    alpha: 1,
  }));

  let rafId;
  let frame = 0;

  function draw() {
    ctx.clearRect(0, 0, $confettiCanvas.width, $confettiCanvas.height);
    frame++;
    let alive = false;

    for (const p of pieces) {
      p.x   += p.vx;
      p.y   += p.vy;
      p.vy  += 0.12;
      p.rot += p.vr;
      if (frame > 80) p.alpha = Math.max(0, p.alpha - 0.012);

      if (p.y < $confettiCanvas.height + 20) alive = true;

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    if (alive && frame < 220) {
      rafId = requestAnimationFrame(draw);
    } else {
      stopConfetti();
    }
  }

  rafId = requestAnimationFrame(draw);

  // 화면 리사이즈 대응
  window.addEventListener('resize', () => {
    $confettiCanvas.width  = window.innerWidth;
    $confettiCanvas.height = window.innerHeight;
  }, { once: true });

  // cleanup 참조 저장
  $confettiCanvas._rafId = rafId;
}

function stopConfetti() {
  if ($confettiCanvas._rafId) cancelAnimationFrame($confettiCanvas._rafId);
  $confettiCanvas.hidden = true;
}

/* =============================================
   페이지 떠날 때 카메라 정리
   ============================================= */
window.addEventListener('pagehide', () => stopCamera());

document.addEventListener('DOMContentLoaded', init);
