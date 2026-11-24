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

// --- Découpage du speech en phrases avec gestes de présentatrice ---
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
  presenterState.syllablePhase += 1
