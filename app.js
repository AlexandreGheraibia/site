import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// URL de ton Cloudflare Worker
const GEMINI_ENDPOINT = 'https://billowing-field-aa78.simurghe.workers.dev/';

// URL officielle du modèle Pixiv VRM1 Sample
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

// État global de la scène, de la voix et du dialogue
let currentVrm = null;
let voiceEnabled = true;
let isSpeaking = false;
let currentGesture = 'idle';
let gestureTimer = 0;
let currentEmotion = 'neutral';
let blinkTimer = 3.2;
let isBlinking = false;
const conversationHistory = [];

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

  currentGesture = secId === 'sec-portfolio' ? 'present' : 'nod';
  gestureTimer = 1.6;
}

topNav.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sec]');
  if (btn) {
    activateSection(btn.dataset.sec);
  }
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

function speakText(text) {
  if (!voiceEnabled || !('speechSynthesis' in window) || !text) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.rate = 1.03;
  utterance.pitch = 1.05;

  const frVoice = pickFrenchVoice();
  if (frVoice) utterance.voice = frVoice;

  utterance.onstart = () => {
    isSpeaking = true;
    currentGesture = 'talk';
  };

  utterance.onend = utterance.onerror = () => {
    isSpeaking = false;
    currentGesture = 'idle';
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
  }
  setStatus(voiceEnabled ? 'Voix française activée.' : 'Voix coupée.');
});

btnPitch.addEventListener('click', () => {
  activateSection('sec-parcours');
  assistantBubble.textContent = PITCH_TEXT;
  aiCvCard.classList.remove('hidden');
  aiCvQuestion.textContent = 'Présentation synthétique';
  aiCvAnswer.textContent = PITCH_TEXT;
  currentEmotion = 'happy';
  speakText(PITCH_TEXT);
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
  VRMUtils.combineSkeletons(vrm.scene);

  // VRM 1.0 est orienté vers -Z ; rotation 180° pour faire face à la caméra (+Z)
  if (vrm.meta?.metaVersion === '1') {
    VRMUtils.rotateVRM0(vrm);
  } else {
    vrm.scene.rotation.y = Math.PI;
  }

  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
  });

  currentVrm = vrm;
  scene.add(vrm.scene);
  setStatus(`Modèle chargé : ${label}`, false);
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

// --- Animation, clignement et lip-sync ---
const clock = new THREE.Clock();

function updateAvatarAnimation(elapsed, delta) {
  if (!currentVrm) return;

  if (gestureTimer > 0) {
    gestureTimer = Math.max(0, gestureTimer - delta);
    if (gestureTimer === 0 && !isSpeaking) {
      currentGesture = 'idle';
    }
  }

  // Respiration légère et gestes sur le torse / tête / bras
  const chest = currentVrm.humanoid?.getNormalizedBoneNode('chest');
  const head = currentVrm.humanoid?.getNormalizedBoneNode('head');
  const leftArm = currentVrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightArm = currentVrm.humanoid?.getNormalizedBoneNode('rightUpperArm');

  const breath = Math.sin(elapsed * 2.0) * 0.02;
  if (chest) {
    chest.rotation.x = breath;
    chest.rotation.y = Math.sin(elapsed * 0.9) * 0.04;
  }

  if (head) {
    let headPitch = Math.sin(elapsed * 1.5) * 0.03;
    let headYaw = Math.cos(elapsed * 1.1) * 0.05;

    if (currentGesture === 'nod') {
      headPitch += Math.sin(elapsed * 10) * 0.1;
    } else if (currentGesture === 'talk') {
      headPitch += Math.sin(elapsed * 7.5) * 0.05;
      headYaw += Math.cos(elapsed * 5.2) * 0.06;
    }

    head.rotation.x = headPitch;
    head.rotation.y = headYaw;
  }

  if (leftArm && rightArm) {
    leftArm.rotation.z = 1.15 + Math.sin(elapsed * 1.6) * 0.03;
    rightArm.rotation.z = -1.15 - Math.sin(elapsed * 1.6) * 0.03;

    if (currentGesture === 'present') {
      rightArm.rotation.z = -0.65;
      rightArm.rotation.x = -0.35 + Math.sin(elapsed * 4) * 0.06;
    }
  }

  // Clignement d'yeux naturel + bouche pendant la parole
  const expr = currentVrm.expressionManager;
  if (expr) {
    blinkTimer -= delta;
    if (blinkTimer <= 0) {
      isBlinking = !isBlinking;
      blinkTimer = isBlinking ? 0.12 : 2.8 + Math.random() * 2.5;
    }
    expr.setValue('blink', isBlinking ? 1.0 : 0.0);

    const mouthOpen = isSpeaking ? Math.max(0, Math.sin(elapsed * 16) * 0.55 + 0.25) : 0.0;
    expr.setValue('aa', mouthOpen);
    expr.setValue('happy', currentEmotion === 'happy' ? 0.45 : 0.0);
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

// --- Dialogue & appel au Cloudflare Worker ---
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

async function askAssistant(question) {
  const cleanQ = question.trim();
  if (!cleanQ) return;

  const targetSec = inferSectionFromQuestion(cleanQ);
  activateSection(targetSec);

  aiCvCard.classList.remove('hidden');
  aiCvQuestion.textContent = `« ${cleanQ} »`;
  aiCvAnswer.textContent = 'Réflexion en cours...';
  assistantBubble.textContent = 'Je consulte le profil d’Alexandre...';
  currentGesture = 'nod';
  gestureTimer = 1.2;
  setStatus('Connexion à l’assistante IA...', false);

  conversationHistory.push({ role: 'user', content: cleanQ });

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: cleanQ,
        history: conversationHistory.slice(-6)
      })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const answerText =
      data.answer ||
      data.reply ||
      data.text ||
      "Je n'ai pas pu formuler de réponse détaillée pour le moment.";

    conversationHistory.push({ role: 'assistant', content: answerText });
    aiCvAnswer.textContent = answerText;
    assistantBubble.textContent = answerText;
    currentEmotion = 'happy';
    setStatus('Réponse reçue.', false);
    speakText(answerText);
  } catch (err) {
    console.error('Erreur Worker:', err);
    const fallback =
      "La liaison avec le service IA n'a pas pu aboutir immédiatement. Vous pouvez parcourir directement la rubrique mise en avant à droite.";
    aiCvAnswer.textContent = fallback;
    assistantBubble.textContent = fallback;
    currentEmotion = 'neutral';
    setStatus('Service IA indisponible — consultation directe du CV.', true);
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
