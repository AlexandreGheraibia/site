import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const GEMINI_ENDPOINT = 'https://billowing-field-aa78.simurghe.workers.dev/';
const VRM1_SAMPLE_URL = 'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';

const SECTION_META = {
  'sec-parcours':    { title: 'PARCOURS',    sub: 'Licence MIA • Master 1 • M2i' },
  'sec-competences': { title: 'COMPÉTENCES', sub: 'Java, C++, Python, IA & Linux' },
  'sec-portfolio':   { title: 'PORTFOLIO',   sub: 'OCR Hors Ligne • M10 • 3D' },
  'sec-experience':  { title: 'EXPÉRIENCES', sub: 'Caterpillar • Retail • Solidura' },
  'sec-formation':   { title: 'FORMATION',   sub: 'UJF Grenoble • POEI • TAI' },
  'sec-interets':    { title: 'INTÉRÊTS',    sub: 'IA Locale, 3D VRM & SF' },
  'sec-contact':     { title: 'CONTACT',     sub: 'Grenoble • gheraibia.free.fr' }
};

const PITCH_TEXT =
  "Alexandre Gheraibia est développeur Fullstack et profil Systèmes / IA basé à Grenoble. " +
  "Diplômé d'une Licence de Mathématiques et Informatique Appliquées niveau Master 1 à l'Université Joseph Fourier, " +
  "il a suivi un POEI développeur Java Fullstack chez M2i. Il combine développement logiciel, administration systèmes " +
  "et IA embarquée hors ligne, comme son application Android anti-gaspillage avec PaddleOCR, parseq_tiny et SmolVLM2-256M.";

let currentVrm = null;
let voiceEnabled = true;
let isSpeaking = false;
let blinkTimer = 2.8;
let isBlinking = false;
let speechFallbackTimer = null;
const conversationHistory = [];

const presenterState = {
  active: false,
  gesture: 'present',
  emotion: 'happy',
  emphasis: 0.75,
  clauseIndex: 0,
  clauseTimer: 0,
  clauses: [],
  pulse: 0,
  pause: 0,
  syllablePhase: 0,
  usedWordBoundary: false
};

const canvas = document.getElementById('vrm-canvas');
const dropZone = document.getElementById('drop-zone');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const assistantBubble = document.getElementById('assistant-bubble');
const holoBox = document.getElementById('holo-box');
const holoTitle = document.getElementById('holo-title');
const holoSub = document.getElementById('holo-sub');

const aiCvCard = document.getElementById('ai-cv-card');
const aiCvQuestion = document.getElementById('ai-cv-question');
const aiCvAnswer = document.getElementById('ai-cv-answer');
const aiCvClose = document.getElementById('ai-cv-close');

const topNav = document.getElementById('top-nav');
const cvSections = document.querySelectorAll('.cv-section');
const navContactLink = document.getElementById('nav-contact-link');
const btnMailShortcut = document.getElementById('btn-mail-shortcut');
const contactForm = document.getElementById('contact-form');

const vrmFileInput = document.getElementById('vrm-file-input');
const btnVoiceToggle = document.getElementById('btn-voice-toggle');
const btnPitch = document.getElementById('btn-pitch');
const btnResetCam = document.getElementById('btn-reset-cam');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const quickPromptButtons = document.querySelectorAll('.quick-prompts button');

function setStatus(message, warn = false) {
  statusText.textContent = message;
  statusDot.classList.toggle('warn', warn);
}

function parseSpeechClauses(text, llmMeta = {}) {
  const parts = (text || '')
    .match(/[^.!?;:…]+[.!?;:…]*/g)
    ?.map((s) => s.trim())
    .filter(Boolean) || [(text || '').trim()];

  const validGestures = ['idle', 'greet', 'present', 'explain', 'curious', 'nod'];
  const forcedGesture = validGestures.includes(llmMeta.gesture) ? llmMeta.gesture : null;

  return parts.map((seg, i) => {
    const low = seg.toLowerCase();
    const duration = Math.max(1.4, Math.min(4.2, seg.length * 0.055));

    let gesture = forcedGesture || (i % 2 === 0 ? 'present' : 'explain');
    let emotion = llmMeta.emotion === 'curious' ? 'curious' : 'happy';

    if (i === 0 && /bonjour|salut|bienvenue|assistante/.test(low)) {
      gesture = 'greet';
    } else if (/[?]\s*$/.test(low)) {
      gesture = 'curious';
      emotion = 'curious';
    } else if (/projet|portfolio|ocr|vlm|ia|caterpillar|application|prototype/.test(low)) {
      gesture = 'present';
      emotion = 'happy';
    } else if (/parce que|donc|notamment|formation|compétence|licence|master|m2i|linux|système/.test(low)) {
      gesture = 'explain';
    } else if (i === parts.length - 1) {
      gesture = 'nod';
    }

    return {
      text: seg,
      duration,
      gesture,
      emotion,
      hasPauseEnd: /[,;:.!?…]\s*$/.test(low)
    };
  });
}

function beginSpeechAnimation(text, llmMeta = {}) {
  if (speechFallbackTimer) {
    clearTimeout(speechFallbackTimer);
    speechFallbackTimer = null;
  }

  const clauses = parseSpeechClauses(text, llmMeta);
  presenterState.active = true;
  presenterState.clauses = clauses;
  presenterState.clauseIndex = 0;
  presenterState.clauseTimer = 0;
  presenterState.pulse = 0.85;
  presenterState.pause = 0;
  presenterState.syllablePhase = 0;
  presenterState.usedWordBoundary = false;
  presenterState.emphasis = typeof llmMeta.emphasis === 'number'
    ? Math.min(1, Math.max(0.45, llmMeta.emphasis))
    : 0.75;

  const first = clauses[0];
  if (first) {
    presenterState.gesture = first.gesture;
    presenterState.emotion = first.emotion;
  }
}

function stopSpeechAnimation() {
  presenterState.active = false;
  presenterState.pulse = 0;
  presenterState.pause = 0;
  if (speechFallbackTimer) {
    clearTimeout(speechFallbackTimer);
    speechFallbackTimer = null;
  }
}

function handleWordEvent(text, charIndex) {
  if (!presenterState.active) return;
  presenterState.usedWordBoundary = true;
  presenterState.pulse = Math.min(1, presenterState.pulse + 0.75);
  presenterState.syllablePhase += 1.4;

  if (typeof charIndex === 'number' && text) {
    const match = text.slice(charIndex).match(/^[^\s.,!?;:…]+([.,!?;:…]*)/);
    const word = (match?.[0] || '').toLowerCase();
    const punct = match?.[1] || '';

    if (/[?!…]/.test(punct)) {
      presenterState.pulse = 1.0;
      if (punct.includes('?')) {
        presenterState.gesture = 'curious';
        presenterState.emotion = 'curious';
      } else {
        presenterState.gesture = 'present';
        presenterState.emotion = 'happy';
      }
    } else if (/[,;:]/.test(punct)) {
      presenterState.pause = 0.85;
    }

    if (/projet|ocr|vlm|ia|grenoble|java|python|linux|caterpillar/.test(word)) {
      presenterState.gesture = 'present';
      presenterState.emotion = 'happy';
    } else if (/donc|notamment|système|formation|parcours/.test(word)) {
      presenterState.gesture = 'explain';
    }
  }
}

function updateSpeechState(delta) {
  presenterState.pulse = Math.max(0, presenterState.pulse - delta * 2.6);
  presenterState.pause = Math.max(0, presenterState.pause - delta * 2.5);

  if (!presenterState.active) return;

  presenterState.clauseTimer += delta;

  if (!presenterState.usedWordBoundary) {
    presenterState.syllablePhase += delta * 11.5 * (1 - presenterState.pause * 0.65);
    if (Math.sin(presenterState.syllablePhase * 0.5) > 0.92 && presenterState.pulse < 0.25) {
      presenterState.pulse = 0.55;
    }
  }

  const current = presenterState.clauses[presenterState.clauseIndex];
  if (!current) return;

  if (current.duration - presenterState.clauseTimer < 0.22 && current.hasPauseEnd) {
    presenterState.pause = Math.max(presenterState.pause, 0.7);
  }

  if (presenterState.clauseTimer >= current.duration && presenterState.clauseIndex < presenterState.clauses.length - 1) {
    presenterState.clauseIndex += 1;
    presenterState.clauseTimer = 0;
    const next = presenterState.clauses[presenterState.clauseIndex];
    if (next) {
      presenterState.gesture = next.gesture;
      presenterState.emotion = next.emotion;
      presenterState.pulse = 0.8;
      presenterState.pause = 0.4;
    }
  }
}

function activateSection(secId) {
  const targetExists = document.getElementById(secId);
  if (!targetExists) return;

  cvSections.forEach((sec) => {
    sec.classList.toggle('active', sec.id === secId);
  });

  topNav.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sec === secId);
  });

  const meta = SECTION_META[secId] || { title: 'CV', sub: 'Alexandre Gheraibia' };
  holoTitle.textContent = meta.title;
  holoSub.textContent = meta.sub;
  holoBox.classList.remove('pulse');
  void holoBox.offsetWidth;
  holoBox.classList.add('pulse');

  if (!isSpeaking) {
    presenterState.gesture = secId === 'sec-portfolio' ? 'present' : 'nod';
    presenterState.emotion = 'happy';
    presenterState.pulse = 0.85;
    setTimeout(() => {
      if (!isSpeaking && !presenterState.active) {
        presenterState.gesture = 'idle';
      }
    }, 1700);
  }
}

topNav.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sec]');
  if (btn) activateSection(btn.dataset.sec);
});

navContactLink.addEventListener('click', (e) => {
  e.preventDefault();
  activateSection('sec-contact');
});

btnMailShortcut.addEventListener('click', () => {
  activateSection('sec-contact');
  document.getElementById('contact-name')?.focus();
});

aiCvClose.addEventListener('click', () => {
  aiCvCard.classList.add('hidden');
});

contactForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('contact-name').value.trim();
  const email = document.getElementById('contact-email').value.trim();
  const msg = document.getElementById('contact-msg').value.trim();
  if (!name || !email || !msg) return;

  const subject = encodeURIComponent(`Contact CV — ${name}`);
  const body = encodeURIComponent(`Nom / Entreprise : ${name}\nE-mail : ${email}\n\n${msg}`);
  window.location.href = `mailto:alexandre.gheraibia@free.fr?subject=${subject}&body=${body}`;
  assistantBubble.textContent = "Votre client de messagerie va s'ouvrir avec le message préparé pour Alexandre.";
});

function pickFrenchVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith('fr') && /google|microsoft|amelie|thomas|hortense/i.test(v.name)) ||
    voices.find((v) => v.lang.toLowerCase().startsWith('fr')) ||
    null
  );
}

function speakText(text, llmMeta = {}) {
  if (!text) return;

  beginSpeechAnimation(text, llmMeta);

  if (!voiceEnabled || !('speechSynthesis' in window)) {
    isSpeaking = true;
    const totalMs = Math.max(2000, presenterState.clauses.reduce((acc, c) => acc + c.duration * 1000, 0));
    speechFallbackTimer = setTimeout(() => {
      isSpeaking = false;
      stopSpeechAnimation();
      presenterState.gesture = 'idle';
    }, totalMs);
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.rate = 1.02;
  utterance.pitch = presenterState.emotion === 'happy' ? 1.06 : 1.02;

  const frVoice = pickFrenchVoice();
  if (frVoice) utterance.voice = frVoice;

  utterance.onboundary = (event) => {
    if (!event.name || event.name === 'word') {
      handleWordEvent(text, event.charIndex);
    }
  };

  utterance.onstart = () => {
    isSpeaking = true;
  };

  utterance.onend = utterance.onerror = () => {
    isSpeaking = false;
    stopSpeechAnimation();
    presenterState.gesture = 'idle';
  };

  window.speechSynthesis.speak(utterance);
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => pickFrenchVoice();
}

btnVoiceToggle.addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  btnVoiceToggle.classList.toggle('active-ok', voiceEnabled);
  if (!voiceEnabled && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
    stopSpeechAnimation();
    presenterState.gesture = 'idle';
  }
  setStatus(voiceEnabled ? 'Voix française activée.' : 'Voix coupée.');
});

btnPitch.addEventListener('click', () => {
  activateSection('sec-parcours');
  assistantBubble.textContent = PITCH_TEXT;
  aiCvCard.classList.remove('hidden');
  aiCvQuestion.textContent = 'Présentation synthétique';
  aiCvAnswer.textContent = PITCH_TEXT;
  speakText(PITCH_TEXT, { emotion: 'happy', gesture: 'present', emphasis: 0.8 });
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
const DEFAULT_CAM_POS = new THREE.Vector3(0, 1.35, 1.85);
const DEFAULT_CAM_TARGET = new THREE.Vector3(0, 1.22, 0);
camera.position.copy(DEFAULT_CAM_POS);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(DEFAULT_CAM_TARGET);
controls.enableDamping = true;
controls.minDistance = 0.75;
controls.maxDistance = 3.5;
controls.update();

btnResetCam.addEventListener('click', () => {
  camera.position.copy(DEFAULT_CAM_POS);
  controls.target.copy(DEFAULT_CAM_TARGET);
  controls.update();
});

const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(1.2, 2.2, 1.8);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
fillLight.position.set(-1.5, 1.0, -1.0);
scene.add(fillLight);

scene.add(new THREE.AmbientLight(0xdbeafe, 0.7));

function resizeRenderer() {
  const rect = dropZone.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

resizeRenderer();
window.addEventListener('resize', resizeRenderer);

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

function disposeCurrentVrm() {
  if (!currentVrm) return;
  scene.remove(currentVrm.scene);
  VRMUtils.deepDispose(currentVrm.scene);
  currentVrm = null;
}

function attachVrm(vrm, label) {
  disposeCurrentVrm();
  VRMUtils.removeUnnecessaryVertices(vrm.scene);

  if (vrm.meta?.metaVersion === '0') {
    VRMUtils.rotateVRM0(vrm);
  }

  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
  });

  currentVrm = vrm;
  scene.add(vrm.scene);
  setStatus
