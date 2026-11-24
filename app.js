import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// URL de ton Cloudflare Worker
const GEMINI_ENDPOINT = 'https://billowing-field-aa78.simurghe.workers.dev/';

// Modèle Pixiv VRM1 Sample
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

// --- État global ---
let currentVrm = null;
let voiceEnabled = true;
let isSpeaking = false;
let blinkTimer = 2.9;
let isBlinking = false;
const conversationHistory = [];

// État du moteur de chorégraphie de présentatrice
const speechEngine = {
  active: false,
  text: '',
  clauses: [],
  clauseIndex: 0,
  clauseElapsed: 0,
  totalElapsed: 0,
  estimatedTotalSec: 4,
  gesture: 'present',      // 'idle' | 'greet' | 'present' | 'explain' | 'nod' | 'curious' | 'talk'
  emotion: 'happy',        // 'neutral' | 'happy' | 'curious'
  emphasis: 0.6,
  wordAccent: 0,
  pauseAmount: 0,
  syllablePhase: 0,
  lastCharIndex: -1
};

let speechFallbackTimer = null;

// Références DOM
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

// --- Analyse prosodique & style de présentatrice ---
function estimateSyllablesFr(str) {
  const clean = (str || '').toLowerCase().replace(/[^a-zàâäéèêëîïôöùûüç0-9\s]/g, ' ');
  const words = clean.trim().split(/\s+/).filter(Boolean);
  let count = 0;
  for (const w of words) {
    const groups = w.match(/[aeiouyàâäéèêëîïôöùûü]+/g);
    count += Math.max(1, groups ? groups.length : 1);
  }
  return Math.max(1, count);
}

function analyzeSpeechProsody(text, llmMeta = {}) {
  const raw = (text || '').trim();
  const segments = raw.match(/[^.!?;:…]+[.!?;:…]*/g) || [raw];

  const allowedGestures = ['idle', 'greet', 'present', 'explain', 'nod', 'curious', 'talk'];
  const allowedEmotions = ['neutral', 'happy', 'curious'];
  const llmGesture = allowedGestures.includes(llmMeta.gesture) ? llmMeta.gesture : null;
  const llmEmotion =
    llmMeta.emotion === 'emphatic'
      ? 'happy'
      : allowedEmotions.includes(llmMeta.emotion)
        ? llmMeta.emotion
        : null;

  let totalSec = 0;
  const clauses = segments.map((part, idx) => {
    const seg = part.trim();
    const low = seg.toLowerCase();
    const syllables = estimateSyllablesFr(seg);
    const duration = Math.max(1.15, syllables / 4.2);
    totalSec += duration;

    const endsQuestion = /[?]\s*$/.test(seg);
    const endsExclam = /[!…]\s*$/.test(seg);
    const endsPause = /[,;:]\s*$/.test(seg);

    // Par défaut, une présentatrice garde une attitude accueillante et structurée
    let gesture = llmGesture || (idx % 2 === 0 ? 'present' : 'explain');
    let emotion = llmEmotion || 'happy';
    let emphasis = typeof llmMeta.emphasis === 'number'
      ? Math.min(1, Math.max(0.3, llmMeta.emphasis))
      : 0.62;

    if (idx === 0 && /bonjour|salut|bienvenue|assistante/.test(low)) {
      gesture = 'greet';
      emotion = 'happy';
      emphasis = Math.max(emphasis, 0.72);
    } else if (endsQuestion) {
      gesture = 'curious';
      emotion = 'curious';
      emphasis = Math.min(1, emphasis + 0.1);
    } else if (/projet|portfolio|ocr|vlm|ia|caterpillar|ingénieur|développeur|application|prototype/.test(low)) {
      gesture = 'present';
      emotion = 'happy';
      emphasis = Math.min(1, Math.max(emphasis, 0.78));
    } else if (/parce que|donc|notamment|architecture|système|formation|compétence|licence|master|m2i|linux|pxe/.test(low)) {
      gesture = 'explain';
      emotion = llmEmotion || 'happy';
      emphasis = Math.min(1, Math.max(emphasis, 0.68));
    } else if (idx === segments.length - 1 && !endsExclam) {
      gesture = 'nod';
      emotion = 'happy';
    }

    if (endsExclam) {
      emphasis = Math.min(1, emphasis + 0.14);
      emotion = 'happy';
    }

    return {
      text: seg,
      low,
      duration,
      endsQuestion,
      endsExclam,
      endsPause,
      gesture,
      emotion,
      emphasis
    };
  });

  return { clauses, totalSec: Math.max(1.6, totalSec) };
}

function startSpeechChoreography(text, llmMeta = {}) {
  const { clauses, totalSec } = analyzeSpeechProsody(text, llmMeta);
  speechEngine.active = true;
  speechEngine.text = text || '';
  speechEngine.clauses = clauses;
  speechEngine.clauseIndex = 0;
  speechEngine.clauseElapsed = 0;
  speechEngine.totalElapsed = 0;
  speechEngine.estimatedTotalSec = totalSec;
  speechEngine.lastCharIndex = -1;
  speechEngine.pauseAmount = 0;
  speechEngine.wordAccent = 0.45;

  const first = clauses[0];
  if (first) {
    speechEngine.gesture = first.gesture;
    speechEngine.emotion = first.emotion;
    speechEngine.emphasis = first.emphasis;
  } else {
    speechEngine.gesture = 'present';
    speechEngine.emotion = 'happy';
    speechEngine.emphasis = 0.62;
  }
}

function stopSpeechChoreography() {
  speechEngine.active = false;
  speechEngine.pauseAmount = 0;
  speechEngine.wordAccent = 0;
  if (speechFallbackTimer) {
    clearTimeout(speechFallbackTimer);
    speechFallbackTimer = null;
  }
}

function triggerTransientGesture(gesture, emotion = 'happy', emphasis = 0.65) {
  const allowedGestures = ['idle', 'greet', 'present', 'explain', 'nod', 'curious', 'talk'];
  if (allowedGestures.includes(gesture)) {
    speechEngine.gesture = gesture;
  }
  if (emotion) {
    speechEngine.emotion = emotion;
  }
  speechEngine.emphasis = Math.min(1, Math.max(0.25, emphasis));
  speechEngine.wordAccent = Math.min(1, speechEngine.wordAccent + 0.35);
}

function onSpeechWordBoundary(text, charIndex) {
  if (!speechEngine.active || !text) return;
  if (typeof charIndex === 'number' && charIndex === speechEngine.lastCharIndex) return;
  if (typeof charIndex === 'number') speechEngine.lastCharIndex = charIndex;

  speechEngine.wordAccent = Math.min(1, speechEngine.wordAccent + 0.65);
  speechEngine.syllablePhase += 1.35;

  if (typeof charIndex === 'number') {
    const tokenMatch = text.slice(charIndex).match(/^[^\s.,!?;:…]+([.,!?;:…]*)/);
    const word = (tokenMatch?.[0] || '').toLowerCase();
    const punct = tokenMatch?.[1] || '';

    if (/[?!…]/.test(punct)) {
      speechEngine.emphasis = Math.min(1, speechEngine.emphasis + 0.14);
      if (punct.includes('?')) {
        speechEngine.gesture = 'curious';
        speechEngine.emotion = 'curious';
      } else {
        speechEngine.gesture = 'present';
        speechEngine.emotion = 'happy';
      }
    } else if (/[,;:]/.test(punct)) {
      speechEngine.pauseAmount = 0.8;
    }

    if (/projet|ocr|vlm|ia|grenoble|java|python|linux|caterpillar|prototype/.test(word)) {
      speechEngine.gesture = 'present';
      speechEngine.emotion = 'happy';
      speechEngine.emphasis = Math.min(1, Math.max(speechEngine.emphasis, 0.78));
    } else if (/donc|notamment|système|formation|parcours|architecture/.test(word)) {
      speechEngine.gesture = 'explain';
    }
  }
}

function stepSpeechChoreography(delta) {
  if (!speechEngine.active) {
    speechEngine.wordAccent = Math.max(0, speechEngine.wordAccent - delta * 3.5);
    speechEngine.pauseAmount = Math.max(0, speechEngine.pauseAmount - delta * 3.0);
    return;
  }

  speechEngine.totalElapsed += delta;
  speechEngine.clauseElapsed += delta;
  speechEngine.wordAccent = Math.max(0, speechEngine.wordAccent - delta * 3.2);
  speechEngine.pauseAmount = Math.max(0, speechEngine.pauseAmount - delta * 2.8);

  const clauses = speechEngine.clauses;
  const current = clauses[speechEngine.clauseIndex];
  if (!current) return;

  const remaining = current.duration - speechEngine.clauseElapsed;
  if (remaining > 0 && remaining < 0.24 && (current.endsPause || /[.!?]$/.test(current.text))) {
    speechEngine.pauseAmount = Math.max(speechEngine.pauseAmount, 0.65);
  }

  if (speechEngine.lastCharIndex < 0) {
    speechEngine.syllablePhase += delta * 11.5 * (1 - speechEngine.pauseAmount * 0.6);
    if (Math.sin(speechEngine.syllablePhase * 0.5) > 0.94 && speechEngine.wordAccent < 0.2) {
      speechEngine.wordAccent = 0.45;
    }
  }

  if (speechEngine.clauseElapsed >= current.duration && speechEngine.clauseIndex < clauses.length - 1) {
    speechEngine.clauseIndex += 1;
    speechEngine.clauseElapsed = 0;
    const next = clauses[speechEngine.clauseIndex];
    if (next) {
      speechEngine.gesture = next.gesture;
      speechEngine.emotion = next.emotion;
      speechEngine.emphasis = next.emphasis;
      speechEngine.pauseAmount = 0.45;
    }
  }
}

// --- Navigation entre rubriques du CV ---
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
    triggerTransientGesture(secId === 'sec-portfolio' ? 'present' : 'nod', 'happy', 0.68);
    setTimeout(() => {
      if (!isSpeaking && !speechEngine.active) {
        speechEngine.gesture = 'idle';
        speechEngine.emotion = 'happy';
      }
    }, 1600);
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

// --- Synthèse vocale FR ---
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

  stopSpeechChoreography();
  startSpeechChoreography(text, llmMeta);

  if (!voiceEnabled || !('speechSynthesis' in window)) {
    isSpeaking = true;
    speechFallbackTimer = setTimeout(() => {
      isSpeaking = false;
      stopSpeechChoreography();
      speechEngine.gesture = 'idle';
      speechEngine.emotion = 'happy';
    }, Math.max(1600, speechEngine.estimatedTotalSec * 1000));
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.rate = 1.02;
  utterance.pitch = speechEngine.emotion === 'happy' ? 1.06 : 1.02;

  const frVoice = pickFrenchVoice();
  if (frVoice) utterance.voice = frVoice;

  utterance.onboundary = (event) => {
    if (!event.name || event.name === 'word') {
      onSpeechWordBoundary(text, event.charIndex);
    }
  };

  utterance.onstart = () => {
    isSpeaking = true;
  };

  utterance.onend = utterance.onerror = () => {
    isSpeaking = false;
    stopSpeechChoreography();
    speechEngine.gesture = 'idle';
    speechEngine.emotion = 'happy';
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
    stopSpeechChoreography();
    speechEngine.gesture = 'idle';
  }
  setStatus(voiceEnabled ? 'Voix française activée.' : 'Voix coupée.');
});

btnPitch.addEventListener('click', () => {
  activateSection('sec-parcours');
  assistantBubble.textContent = PITCH_TEXT;
  aiCvCard.classList.remove('hidden');
  aiCvQuestion.textContent = 'Présentation synthétique';
  aiCvAnswer.textContent = PITCH_TEXT;
  speakText(PITCH_TEXT, { emotion: 'happy', gesture: 'present', emphasis: 0.75 });
});

// --- Scène Three.js & @pixiv/three-vrm ---
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
  setStatus(`Modèle chargé : ${label}`, false);

  // Petit accueil de présentatrice au chargement
  triggerTransientGesture('greet', 'happy', 0.65);
  setTimeout(() => {
    if (!isSpeaking && !speechEngine.active) {
      speechEngine.gesture = 'idle';
    }
  }, 1800);
}

function loadVrmFromUrl(url, label = 'VRM1 Sample') {
  setStatus(`Chargement de ${label}...`, false);
  loader.load(
    url,
    (gltf) => {
      const vrm = gltf.userData.vrm;
      if (!vrm) {
        setStatus("Le fichier ne contient pas de données VRM valides.", true);
        return;
      }
      attachVrm(vrm, label);
    },
    undefined,
    (err) => {
      console.error('Erreur chargement VRM:', err);
      setStatus("Impossible de charger le modèle VRM distant. Chargez un .VRM local.", true);
    }
  );
}

function loadVrmFromFile(file) {
  if (!file) return;
  const objectUrl = URL.createObjectURL(file);
  setStatus(`Chargement de ${file.name}...`, false);
  loader.load(
    objectUrl,
    (gltf) => {
      URL.revokeObjectURL(objectUrl);
      const vrm = gltf.userData.vrm;
      if (!vrm) {
        setStatus("Fichier .VRM / .GLB invalide.", true);
        return;
      }
      attachVrm(vrm, file.name);
    },
    undefined,
    (err) => {
      URL.revokeObjectURL(objectUrl);
      console.error('Erreur lecture fichier VRM:', err);
      setStatus("Erreur lors de la lecture du fichier VRM.", true);
    }
  );
}

vrmFileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadVrmFromFile(file);
  vrmFileInput.value = '';
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadVrmFromFile(file);
});

loadVrmFromUrl(VRM1_SAMPLE_URL, 'VRM1 Sample');

// --- Chorégraphie de présentatrice / assistante ---
const clock = new THREE.Clock();

function lerpBoneRot(bone, tx, ty, tz, smooth) {
  if (!bone) return;
  bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, tx, smooth);
  bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, ty, smooth);
  bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, tz, smooth);
}

function setExprSafe(expr, name, value) {
  if (!expr) return;
  const map = expr.expressionMap;
  if (map && Object.prototype.hasOwnProperty.call(map, name)) {
    expr.setValue(name, Math.max(0, Math.min(1, value)));
  }
}

function updateMouthArticulation(expr, elapsed, amp, pauseFactor, accent) {
  if (!expr) return;

  if (!isSpeaking && !speechEngine.active) {
    setExprSafe(expr, 'aa', 0);
    setExprSafe(expr, 'oh', 0);
    setExprSafe(expr, 'ih', 0);
    return;
  }

  const s1 = Math.sin(elapsed * 13.5 + speechEngine.syllablePhase * 0.25);
  const s2 = Math.cos(elapsed * 7.8);
  const rawEnvelope = Math.max(0, 0.52 + 0.34 * s1 + 0.18 * s2 + accent * 0.25);
  const energy = rawEnvelope * pauseFactor * (0.48 + 0.36 * amp);

  const vowelCycle = Math.sin(elapsed * 4.3);
  const aaVal = Math.min(0.85, energy * (vowelCycle >= -0.35 ? 1.0 : 0.45));
  const ohVal = Math.min(0.55, energy * (vowelCycle > 0.25 ? 0.55 : 0.15));
  const ihVal = Math.min(0.45, energy * (vowelCycle < -0.2 ? 0.45 : 0.1));

  setExprSafe(expr, 'aa', aaVal);
  setExprSafe(expr, 'oh', ohVal);
  setExprSafe(expr, 'ih', ihVal);
}

function updateAvatarAnimation(elapsed, delta) {
  if (!currentVrm) return;

  stepSpeechChoreography(delta);

  const smooth = 1 - Math.exp(-delta * 8.5);
  const speakingActive = isSpeaking || speechEngine.active;
  const mode = speakingActive ? speechEngine.gesture : speechEngine.gesture;
  const amp = speechEngine.emphasis;
  const accent = speechEngine.wordAccent;
  const pauseFactor = Math.max(0.18, 1.0 - speechEngine.pauseAmount * 0.78);

  const humanoid = currentVrm.humanoid;
  const spine = humanoid?.getNormalizedBoneNode('spine');
  const chest = humanoid?.getNormalizedBoneNode('chest');
  const neck = humanoid?.getNormalizedBoneNode('neck');
  const head = humanoid?.getNormalizedBoneNode('head');

  const lShoulder = humanoid?.getNormalizedBoneNode('leftShoulder');
  const rShoulder = humanoid?.getNormalizedBoneNode('rightShoulder');
  const lUpper = humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rUpper = humanoid?.getNormalizedBoneNode('rightUpperArm');
  const lLower = humanoid?.getNormalizedBoneNode('leftLowerArm');
  const rLower = humanoid?.getNormalizedBoneNode('rightLowerArm');
  const lHand = humanoid?.getNormalizedBoneNode('leftHand');
  const rHand = humanoid?.getNormalizedBoneNode('rightHand');

  // 1. Posture de présentatrice : buste droit, léger accueil vers la fiche CV à droite
  const breath = Math.sin(elapsed * 1.9) * 0.015;
  const presenterYaw = speakingActive ? -0.055 * amp : -0.025;
  lerpBoneRot(
    spine,
    breath * 0.55 + accent * 0.018 * amp * pauseFactor,
    presenterYaw * 0.6 + Math.sin(elapsed * 0.7) * 0.015,
    0,
    smooth
  );
  lerpBoneRot(
    chest,
    breath + (mode === 'explain' ? 0.02 * amp : 0) + accent * 0.018 * amp * pauseFactor,
    presenterYaw + (mode === 'present' ? -0.035 * amp : 0),
    0,
    smooth
  );

  // 2. Tête & regard orientés vers le public et la rubrique présentée
  let headX = Math.sin(elapsed * 1.35) * 0.018;
  let headY = presenterYaw * 0.5 + Math.cos(elapsed * 0.9) * 0.025;
  let headZ = Math.sin(elapsed * 0.65) * 0.012;

  if (mode === 'nod') {
    headX += Math.sin(elapsed * 7.0) * 0.07 * amp;
  } else if (mode === 'greet') {
    headX += 0.045 * Math.sin(elapsed * 3.0);
    headZ += 0.035;
  } else if (mode === 'present') {
    headY += -0.06 * amp + Math.sin(elapsed * 2.2) * 0.03 * amp;
    headX += (Math.sin(elapsed * 3.8) * 0.018 + accent * 0.035) * amp * pauseFactor;
  } else if (mode === 'explain') {
    headX += (Math.sin(elapsed * 4.4) * 0.03 + accent * 0.03) * amp * pauseFactor;
    headY += Math.cos(elapsed * 2.6) * 0.045 * amp;
    headZ += Math.sin(elapsed * 1.8) * 0.025 * amp;
  } else if (mode === 'curious') {
    headZ += 0.07 * amp;
    headX += (Math.sin(elapsed * 3.6) * 0.022 + accent * 0.02) * amp;
  } else if (speakingActive) {
    headX += (Math.sin(elapsed * 5.0) * 0.028 + accent * 0.03) * amp * pauseFactor;
    headY += Math.cos(elapsed * 3.4) * 0.038 * amp;
  }

  lerpBoneRot(neck, headX * 0.35, headY * 0.35, headZ * 0.35, smooth);
  lerpBoneRot(head, headX * 0.65, headY * 0.65, headZ * 0.65, smooth);

  // 3. Bras de présentatrice : posés et ouverts vers l'avant/droite, sans mouvements amples latéraux
  const microBreathArm = Math.sin(elapsed * 1.9) * 0.012;

  let lShZ = -0.03, rShZ = 0.03;
  let lUpX = 0.06,  lUpY = 0.06,  lUpZ = -1.24 + microBreathArm;
  let rUpX = 0.06,  rUpY = -0.06, rUpZ = 1.24 - microBreathArm;
  let lLoX = -0.20, lLoY = 0.14,  lLoZ = 0.0;
  let rLoX = -0.20, rLoY = -0.14, rLoZ = 0.0;
  let lHaX = 0.03,  lHaY = 0.0,   lHaZ = -0.04;
  let rHaX = 0.03,  rHaY = 0.0,   rHaZ = 0.04;

  if (mode === 'greet') {
    // Accueil élégant : main droite ouverte à hauteur de poitrine/épaule
    rShZ = -0.04;
    rUpX = -0.22;
    rUpY = -0.22;
    rUpZ = 0.54;
    rLoX = -0.32;
    rLoY = -1.05;
    rHaZ = Math.sin(elapsed * 6.5) * 0.18;
  } else if (mode === 'present') {
    // Geste de présentatrice : main droite ouverte vers la fiche à droite, main gauche posée
    const pulse = (Math.sin(elapsed * 2.8) * 0.03 + accent * 0.075) * amp * pauseFactor;
    rShZ = -0.03;
    rUpX = -0.24 * amp;
    rUpY = -0.18 * amp;
    rUpZ = 0.92 - pulse;
    rLoX = -0.22;
    rLoY = -0.62 * amp - pulse;
    rHaX = -0.10;

    lUpX = 0.04;
    lUpZ = -1.20;
    lLoX = -0.24;
    lLoY = 0.22;
  } else if (mode === 'explain') {
    // Explication structurée : deux avant-bras modérés devant le buste
    const waveL = (Math.sin(elapsed * 3.0) * 0.06 + accent * 0.065) * amp * pauseFactor;
    const waveR = (Math.sin(elapsed * 3.0 + 0.8) * 0.06 + accent * 0.065) * amp * pauseFactor;
    lUpX = -0.12 * amp;
    rUpX = -0.12 * amp;
    lUpZ = -1.14 + waveL * 0.3;
    rUpZ = 1.14 - waveR * 0.3;
    lLoX = -0.24;
    rLoX = -0.24;
    lLoY = 0.48 * amp + waveL;
    rLoY = -0.48 * amp - waveR;
  } else if (mode === 'curious') {
    // Écoute / question : main droite légèrement levée avec retenue
    rUpX = -0.16 * amp;
    rUpY = -0.12 * amp;
    rUpZ = 1.04 - accent * 0.05 * amp;
    rLoX = -0.34;
    rLoY = -1.02;
  } else if (speakingActive) {
    // Parole posée : léger accompagnement de la main droite et de l'avant-bras
    const beatR = (Math.sin(elapsed * 3.2) * 0.045 + accent * 0.065) * amp * pauseFactor;
    const beatL = (Math.cos(elapsed * 2.7) * 0.03 + accent * 0.035) * amp * pauseFactor;
    rUpX = -0.10 * amp;
    rUpZ = 1.15 - beatR * 0.22;
    rLoY = -0.36 * amp - beatR;
    lLoY = 0.18 * amp + beatL;
  }

  lerpBoneRot(lShoulder, 0, 0, lShZ, smooth);
  lerpBoneRot(rShoulder, 0, 0, rShZ, smooth);
  lerpBoneRot(lUpper, lUpX, lUpY, lUpZ, smooth);
  lerpBoneRot(rUpper, rUpX, rUpY, rUpZ, smooth);
  lerpBoneRot(lLower, lLoX, lLoY, lLoZ, smooth);
  lerpBoneRot(rLower, rLoX, rLoY, rLoZ, smooth);
  lerpBoneRot(lHand, lHaX, lHaY, lHaZ, smooth);
  lerpBoneRot(rHand, rHaX, rHaY, rHaZ, smooth);

  // 4. Clignement, sourire d'assistante & articulation labiale
  const expr = currentVrm.expressionManager;
  if (expr) {
    blinkTimer -= delta;
    if (blinkTimer <= 0) {
      isBlinking = !isBlinking;
      blinkTimer = isBlinking ? 0.12 : 2.8 + Math.random() * 2.4;
    }
    setExprSafe(expr, 'blink', isBlinking ? 1.0 : 0.0);

    updateMouthArticulation(expr, elapsed, amp, pauseFactor, accent);

    const emo = speakingActive ? speechEngine.emotion : 'happy';
    setExprSafe(expr, 'happy', emo === 'happy' ? (speakingActive ? 0.42 : 0.28) : 0.0);
    setExprSafe(expr, 'surprised', emo === 'curious' ? 0.18 : 0.0);

    expr.update();
  }

  currentVrm.update(delta);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  updateAvatarAnimation(elapsed, delta);
  controls.update();
  renderer.render(scene, camera);
}

animate();

// --- Dialogue & appel au Cloudflare Worker (avec retry 503) ---
function inferSectionFromQuestion(question) {
  const q = question.toLowerCase();
  if (q.includes('compétence') || q.includes('competence') || q.includes('stack') || q.includes('java') || q.includes('python')) {
    return 'sec-competences';
  }
  if (q.includes('projet') || q.includes('portfolio') || q.includes('ocr') || q.includes('vlm') || q.includes('caterpillar')) {
    return 'sec-portfolio';
  }
  if (q.includes('expérience') || q.includes('experience') || q.includes('emploi') || q.includes('travail') || q.includes('solidura')) {
    return 'sec-experience';
  }
  if (q.includes('formation') || q.includes('diplôme') || q.includes('diplome') || q.includes('master') || q.includes('m2i') || q.includes('fourier')) {
    return 'sec-formation';
  }
  if (q.includes('intérêt') || q.includes('interet') || q.includes('vélo') || q.includes('velo') || q.includes('ollama') || q.includes('sf')) {
    return 'sec-interets';
  }
  if (q.includes('contact') || q.includes('mail') || q.includes('joindre') || q.includes('grenoble')) {
    return 'sec-contact';
  }
  return 'sec-parcours';
}

async function fetchGeminiWithRetry(payload, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.status === 503 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function askAssistant(question) {
  const cleanQ = question.trim();
  if (!cleanQ) return;

  const targetSec = inferSectionFromQuestion(cleanQ);
  activateSection(targetSec);

  aiCvCard.classList.remove('hidden');
  aiCvQuestion.textContent = `« ${cleanQ} »`;
  aiCvAnswer.textContent = 'Réflexion en cours...';
  assistantBubble.textContent = 'Je consulte le profil d’Alexandre...';
  triggerTransientGesture('curious', 'curious', 0.6);
  setStatus('Connexion à l’assistante IA...', false);

  conversationHistory.push({ role: 'user', content: cleanQ });

  try {
    const data = await fetchGeminiWithRetry({
      question: cleanQ,
      history: conversationHistory.slice(-6)
    });

    const answerText =
      data.answer ||
      data.reply ||
      data.text ||
      "Je n'ai pas pu formuler de réponse détaillée pour le moment.";

    conversationHistory.push({ role: 'assistant', content: answerText });
    aiCvAnswer.textContent = answerText;
    assistantBubble.textContent = answerText;

    setStatus('Réponse reçue.', false);
    speakText(answerText, {
      emotion: data.emotion,
      gesture: data.gesture,
      emphasis: data.emphasis
    });
  } catch (err) {
    console.error('Erreur Worker:', err);
    stopSpeechChoreography();
    const fallback =
      "Le service IA est momentanément très sollicité. Vous pouvez consulter directement la rubrique affichée à droite.";
    aiCvAnswer.textContent = fallback;
    assistantBubble.textContent = fallback;
    speechEngine.emotion = 'happy';
    speechEngine.gesture = 'idle';
    setStatus('Service IA temporairement saturé — consultation directe du CV.', true);
  }
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = chatInput.value.trim();
  if (!value) return;
  chatInput.value = '';
  askAssistant(value);
});

quickPromptButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.q;
    if (q) askAssistant(q);
  });
});
