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

// État du speech et de la gestuelle de présentatrice
const presenterState = {
  active: false,
  gesture: 'present', // 'idle' | 'greet' | 'present' | 'explain' | 'curious' | 'nod'
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

// --- Découpage du speech en phrases avec gestes variés de présentatrice ---
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

  presenterState.gesture = 'greet';
  presenterState.emotion = 'happy';
  presenterState.pulse = 0.85;
  setTimeout(() => {
    if (!isSpeaking && !presenterState.active) {
      presenterState.gesture = 'idle';
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

// --- Animation franche et lisible de présentatrice ---
const clock = new THREE.Clock();

function rotTo(bone, x, y, z, alpha) {
  if (!bone) return;
  bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, x, alpha);
  bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, y, alpha);
  bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, z, alpha);
}

function setExpr(expr, name, val) {
  if (!expr?.expressionMap || !Object.prototype.hasOwnProperty.call(expr.expressionMap, name)) return;
  expr.setValue(name, Math.max(0, Math.min(1, val)));
}

function updateAvatarAnimation(elapsed, delta) {
  if (!currentVrm) return;

  updateSpeechState(delta);

  const alpha = 1 - Math.exp(-delta * 7.5);
  const speaking = isSpeaking || presenterState.active;
  const g = presenterState.gesture;
  const pulse = presenterState.pulse;
  const pauseMul = Math.max(0.2, 1 - presenterState.pause * 0.75);

  const h = currentVrm.humanoid;
  const chest = h?.getNormalizedBoneNode('chest');
  const head = h?.getNormalizedBoneNode('head');
  const lUpper = h?.getNormalizedBoneNode('leftUpperArm');
  const rUpper = h?.getNormalizedBoneNode('rightUpperArm');
  const lLower = h?.getNormalizedBoneNode('leftLowerArm');
  const rLower = h?.getNormalizedBoneNode('rightLowerArm');
  const rHand = h?.getNormalizedBoneNode('rightHand');

  // Buste : léger accueil vers la fiche CV à droite + respiration
  const breath = Math.sin(elapsed * 2.0) * 0.025;
  rotTo(
    chest,
    breath + (speaking ? pulse * 0.04 * pauseMul : 0),
    (speaking ? -0.11 : -0.04) + Math.sin(elapsed * 1.1) * 0.03,
    0,
    alpha
  );

  // Tête : mouvements nets selon la phrase en cours
  let headX = Math.sin(elapsed * 1.5) * 0.03;
  let headY = (speaking ? -0.10 : -0.03) + Math.cos(elapsed * 1.2) * 0.04;
  let headZ = 0;

  if (g === 'greet') {
    headX += Math.sin(elapsed * 4.5) * 0.08;
    headZ += 0.08;
  } else if (g === 'present') {
    // Regarde vers la fiche à droite puis revient vers le public
    headY += -0.14 * pauseMul + Math.sin(elapsed * 2.2) * 0.09 * pauseMul;
    headX += pulse * 0.06 * pauseMul;
  } else if (g === 'explain') {
    headX += (Math.sin(elapsed * 4.2) * 0.06 + pulse * 0.05) * pauseMul;
    headY += Math.cos(elapsed * 2.5) * 0.10 * pauseMul;
  } else if (g === 'curious') {
    headZ += 0.16;
    headX += -0.05 + pulse * 0.04;
  } else if (g === 'nod') {
    headX += Math.sin(elapsed * 7.5) * 0.14 * pauseMul;
  } else if (speaking) {
    headX += (Math.sin(elapsed * 5.0) * 0.05 + pulse * 0.05) * pauseMul;
    headY += Math.cos(elapsed * 3.0) * 0.08 * pauseMul;
  }

  rotTo(head, headX, headY, headZ, alpha);

  // Bras : posés le long du corps au repos, puis gestes nets de présentatrice pendant le speech
  // (En VRM normalisé : +Z sur rightUpperArm / -Z sur leftUpperArm abaisse le bras le long du corps)
  let lUpX = 0.06, lUpY = 0.05, lUpZ = -1.24;
  let rUpX = 0.06, rUpY = -0.05, rUpZ = 1.24;
  let lLoX = -0.20, lLoY = 0.15, lLoZ = 0;
  let rLoX = -0.20, rLoY = -0.15, rLoZ = 0;
  let rHaZ = 0;

  if (g === 'greet') {
    // Main droite levée en salut amical à hauteur d'épaule
    rUpX = -0.45;
    rUpY = -0.35;
    rUpZ = 0.35;
    rLoX = -0.55;
    rLoY = -1.35;
    rHaZ = Math.sin(elapsed * 8.0) * 0.35;
  } else if (g === 'present') {
    // Geste net de présentation vers la droite (avant-bras et bras avancés)
    const sweep = (0.65 + pulse * 0.35) * pauseMul;
    rUpX = -0.45 * sweep;
    rUpY = -0.35 * sweep;
    rUpZ = 1.24 - 0.52 * sweep;
    rLoX = -0.42 * sweep;
    rLoY = -0.95 * sweep;
    rHaZ = -0.15 * sweep;
  } else if (g === 'explain') {
    // Deux avant-bras levés et animés devant le buste pour expliquer
    const beat = (0.6 + pulse * 0.4) * pauseMul;
    const osc = Math.sin(elapsed * 3.8) * 0.25 * beat;
    lUpX = -0.30 * beat;
    rUpX = -0.30 * beat;
    lUpZ = -1.24 + 0.24 * beat + osc * 0.4;
    rUpZ = 1.24 - 0.24 * beat - osc * 0.4;
    lLoX = -0.45 * beat;
    rLoX = -0.45 * beat;
    lLoY = 0.75 * beat + osc;
    rLoY = -0.75 * beat - osc;
  } else if (g === 'curious') {
    rUpX = -0.28;
    rUpY = -0.22;
    rUpZ = 0.92;
    rLoX = -0.55;
    rLoY = -1.25;
  } else if (speaking) {
    const beat = (0.55 + pulse * 0.45) * pauseMul;
    rUpX = -0.22 * beat;
    rUpZ = 1.24 - 0.22 * beat;
    rLoX = -0.30 * beat;
    rLoY = -0.55 * beat - Math.sin(elapsed * 4.2) * 0.18 * beat;
    lLoY = 0.32 * beat + Math.cos(elapsed * 3.6) * 0.12 * beat;
  }

  rotTo(lUpper, lUpX, lUpY, lUpZ, alpha);
  rotTo(rUpper, rUpX, rUpY, rUpZ, alpha);
  rotTo(lLower, lLoX, lLoY, lLoZ, alpha);
  rotTo(rLower, rLoX, rLoY, rLoZ, alpha);
  rotTo(rHand, 0, 0, rHaZ, alpha);

  // Expressions & bouche pendant le speech
  const expr = currentVrm.expressionManager;
  if (expr) {
    blinkTimer -= delta;
    if (blinkTimer <= 0) {
      isBlinking = !isBlinking;
      blinkTimer = isBlinking ? 0.12 : 2.6 + Math.random() * 2.2;
    }
    setExpr(expr, 'blink', isBlinking ? 1.0 : 0.0);

    if (speaking) {
      const env = Math.max(0, 0.52 + 0.35 * Math.sin(elapsed * 14 + presenterState.syllablePhase * 0.2) + presenterState.pulse * 0.25) * pauseMul;
      setExpr(expr, 'aa', Math.min(0.85, env));
      setExpr(expr, 'oh', Math.min(0.5, env * 0.45));
    } else {
      setExpr(expr, 'aa', 0);
      setExpr(expr, 'oh', 0);
    }

    setExpr(expr, 'happy', presenterState.emotion === 'happy' ? (speaking ? 0.5 : 0.3) : 0);
    setExpr(expr, 'surprised', presenterState.emotion === 'curious' ? 0.22 : 0);
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
  presenterState.gesture = 'curious';
  presenterState.emotion = 'curious';
  presenterState.pulse = 0.6;
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
    stopSpeechAnimation();
    const fallback =
      "Le service IA est momentanément très sollicité. Vous pouvez consulter directement la rubrique affichée à droite.";
    aiCvAnswer.textContent = fallback;
    assistantBubble.textContent = fallback;
    presenterState.emotion = 'happy';
    presenterState.gesture = 'idle';
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
