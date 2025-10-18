/***********************
 * Perception Study (PNG images)
 * One image + four 1–7 sliders per trial
 * Two blocks (Male / Female) — block order randomized; trials randomized within blocks
 * ❗ Saves ONLY at the very end (no partial/streaming saves)
 ***********************/

/* ========= BASIC OPTIONS ========= */

const IMAGE_EXT = '.png';   // your files are PNG

// Slider tick labels (1..7 with endpoint text)
const tickRowHTML = `
  <div class="slider-ticks">
    <span>1<br><small>Not at all</small></span>
    <span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>
    <span>7<br><small>Very</small></span>
  </div>`;

// Your four questions
const questionTexts = [
  "How attractive is this person?",
  "How tall is this person?",
  "How athletic is this person?",
  "How intelligent is this person?"
];

// Optional: paste your CloudResearch completion URL (leave "" to skip redirect)
const CLOUDRESEARCH_COMPLETION_URL = "";

/* ========= UTILITIES ========= */

// Safe UUID (works even if crypto.randomUUID is missing)
function safeUUID() {
  try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); }
  catch(_) {}
  return 'pid_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Read a URL parameter (e.g., ?pid=ABC123)
function getParam(name) {
  const m = new URLSearchParams(location.search).get(name);
  return m ? decodeURIComponent(m) : null;
}

// Build filenames from your scheme: F.F.1_1.2.png, M.F.6_3.png, etc.
const NUM_FACES_PER_SEX = 6;
const HEIGHT_CODES = ['1','2','3'];    // 1=Tall, 2=Average, 3=Short
const ATTR_CODES   = ['', '.2', '.3'];  // ''=Attractive, .2=Less, .3=Very unattractive

function buildFiles(sexTag /* "M.F" or "F.F" */) {
  const files = [];
  for (let face = 1; face <= NUM_FACES_PER_SEX; face++) {
    for (const h of HEIGHT_CODES) {
      for (const a of ATTR_CODES) {
        files.push(`${sexTag}.${face}_${h}${a}${IMAGE_EXT}`);
      }
    }
  }
  return files;
}

const maleFiles   = buildFiles('M.F');
const femaleFiles = buildFiles('F.F');

const malePaths   = maleFiles.map(f => `all_images/${f}`);
const femalePaths = femaleFiles.map(f => `all_images/${f}`);

// Parse meta from a filename into clean columns
function parseMeta(imgPath) {
  const name = imgPath.split('/').pop();
  const m = name.match(/^([FM]\.F)\.(\d+)_([123])(?:\.([23]))?\.(png|jpg|jpeg)$/i);

  const meta = { sex:null, face_id:null, height_code:null, height_label:null, attract_code:null, attract_label:null };
  if (!m) return meta;

  const tag = m[1], face = parseInt(m[2],10), h = m[3], a = m[4] || '';
  meta.sex = (tag === 'F.F') ? 'Female' : 'Male';
  meta.face_id = face;
  meta.height_code = h;
  meta.height_label = (h==='1') ? 'Tall' : (h==='2') ? 'Average' : 'Short';
  meta.attract_code = a || null;
  meta.attract_label = (a==='') ? 'Attractive' : (a==='2') ? 'LessAttractive' : 'VeryUnattractive';
  return meta;
}

/* ========= FIREBASE INIT & AUTH ========= */

firebase.initializeApp(window.FIREBASE_CONFIG);

// Sign in anonymously so DB rules `auth != null` pass
let fbUser = null;
function ensureFirebaseAuth() {
  return new Promise((resolve) => {
    firebase.auth().onAuthStateChanged((user) => { fbUser = user; resolve(user); });
    firebase.auth().signInAnonymously().catch((e) => {
      console.warn('Anonymous sign-in failed:', e);
      resolve(null); // still run
    });
  });
}

const db = firebase.database();

/* ========= INIT JPSYCH ========= */

const jsPsych = initJsPsych({
  show_progress_bar: true,
  message_progress_bar: 'Progress',
  // ❌ Removed on_trial_finish streaming; we only save at the end
});

// Participant IDs (supports CloudResearch Connect params, MTurk/Prolific, or fallback UUID)
const participant_id =
  getParam('pid') || getParam('workerId') || getParam('PROLIFIC_PID') || safeUUID();
const participantId = getParam('participantId') || '';  // CR Connect
const assignmentId  = getParam('assignmentId')  || '';
const projectId     = getParam('projectId')     || '';

jsPsych.data.addProperties({ participant_id, participantId, assignmentId, projectId });

/* ========= PREVENT ACCIDENTAL EXITS ========= */
// Shows a native warning if user tries to close/reload mid-study
window.addEventListener('beforeunload', (e) => {
  e.preventDefault();
  e.returnValue = '';
});

/* ========= PRELOAD ========= */

const preload = {
  type: jsPsychPreload,
  images: [...malePaths, ...femalePaths]
};

/* ========= SCREENS ========= */

const fullscreen = { type: jsPsychFullscreen, fullscreen_mode: true };

const welcome = {
  type: jsPsychInstructions,
  pages: [
    `<div class="center">
       <h2>Welcome</h2>
       <p>Welcome to the experiment. This experiment will take approximately 30–40 minutes to complete.</p>
       <p>Please make sure you are in a quiet space and have a strong Wi-Fi connection while doing this experiment.</p>
       <p>If you wish to stop participating in this study at any point, simply close the window and your data will not be recorded.</p>
     </div>`
  ],
  show_clickable_nav: true,
  button_label_next: 'Continue'
};

const instructions = {
  type: jsPsychInstructions,
  pages: [
    `<div class="center">
       <h2>Instructions</h2>
       <p><strong>In this experiment, we will ask you to make judgments about a series of male and female images.</strong></p>
       <p>On each screen, you will see one image and four questions. <strong>Please answer the questions based on your perception of the image.</strong></p>
       <p>Use the 1–7 scale for each question. <strong>The scale is pre-set to 4 by default. However, you must still click or tap on your chosen response — including 4 — to record your answer<strong>. <p>
       <p>All four answers are required.</p>
     </div>`
  ],
  show_clickable_nav: true,
  button_label_next: 'Start'
};

function blockIntroHTML(label) {
  const line = (label === 'Male')
    ? 'Please view and rate the following male images'
    : 'Please view and rate the following female images';
  return `<div class="center">
            <h2>${label} Images</h2>
            <p>${line}.</p>
            <p>Click Continue to begin.</p>
          </div>`;
}
function makeBlockIntro(label){
  return {
    type: jsPsychInstructions,
    pages: [ blockIntroHTML(label) ],
    show_clickable_nav: true,
    button_label_next: 'Continue'
  };
}

/* ========= SLIDER TRIAL (one screen with 4 sliders, all required) ========= */

function sliderHTML(name, prompt) {
  return `
    <div class="q">
      <div class="q-title">${prompt}</div>
      <div class="slider-row">
        <input class="slider" type="range" min="1" max="7" step="1" value="4" name="${name}">
        ${tickRowHTML}
      </div>
    </div>`;
}

// ⬇️⬇️⬇️ REPLACED: adds per-question active manipulation time (Q*_interact_ms)
function makeImageTrial(blockLabel, imgPath) {
  const htmlBlock = `
    <div class="q-block">
      ${sliderHTML('Q1', questionTexts[0])}
      ${sliderHTML('Q2', questionTexts[1])}
      ${sliderHTML('Q3', questionTexts[2])}
      ${sliderHTML('Q4', questionTexts[3])}
    </div>`;

  // accumulators for "active manipulation" time (ms)
  const interact = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  const activeSince = { Q1: null, Q2: null, Q3: null, Q4: null };

  return {
    type: jsPsychSurveyHtmlForm,
    preamble: `<div class="preamble-wrap">
                 <img class="stimulus-image" src="${imgPath}" alt="stimulus">
               </div>`,
    html: htmlBlock,
    button_label: 'Continue',
    data: {
      block: blockLabel,
      image: imgPath,
      ...parseMeta(imgPath)
    },

    // Require interacting with every slider before enabling Continue.
    // Counts a click on "4" as answered.
    on_load: () => {
      const btn =
        document.querySelector('#jspsych-survey-html-form-next') ||
        document.querySelector('form button[type="submit"]');

      if (!btn) return;

      btn.disabled = true;

      const msg = document.createElement('div');
      msg.id = 'move-all-sliders-msg';
      msg.style.textAlign = 'center';
      msg.style.color = '#b00';
      msg.style.margin = '6px 0 0';
      msg.textContent = 'Please answer all four questions to continue.';
      btn.parentElement.insertBefore(msg, btn);

      const sliders = Array.from(document.querySelectorAll('input[type="range"]'));
      sliders.forEach(s => { s.dataset.touched = '0'; });

      function checkAllTouched() {
        const ok = sliders.every(s => s.dataset.touched === '1');
        btn.disabled = !ok;
        msg.style.display = ok ? 'none' : 'block';
      }

      // === Active-manipulation helpers ===
      function startActive(name){
        // stop any other active slider to avoid overlap
        stopAll();
        if (activeSince[name] == null) {
          activeSince[name] = performance.now();
        }
      }
      function stopActive(name){
        if (activeSince[name] != null) {
          interact[name] += performance.now() - activeSince[name];
          activeSince[name] = null;
        }
      }
      function stopAll(){ ['Q1','Q2','Q3','Q4'].forEach(stopActive); }

      // Keep your "must touch all" gate (first touch unlocks)
      sliders.forEach(s => {
        const mark = () => { s.dataset.touched = '1'; checkAllTouched(); };

        s.addEventListener('input',       mark, { once: true });
        s.addEventListener('change',      mark, { once: true });
        s.addEventListener('pointerdown', mark, { once: true });
        s.addEventListener('mousedown',   mark, { once: true });
        s.addEventListener('touchstart',  mark, { once: true });
        s.addEventListener('focus',       mark, { once: true });
        s.addEventListener('keydown',     mark, { once: true });
      });

      // Bind timing events per slider (engage → release)
      sliders.forEach(s => {
        const name = s.name; // "Q1".."Q4"

        const onStart = () => { startActive(name); };
        const onStop  = ()  => { stopActive(name); };

        // Engage events (mouse/touch/keyboard/focus)
        s.addEventListener('pointerdown', onStart);
        s.addEventListener('mousedown',   onStart);
        s.addEventListener('touchstart',  onStart, { passive: true });
        s.addEventListener('keydown',     onStart);
        s.addEventListener('focus',       onStart);

        // Release/leave events
        s.addEventListener('pointerup',   onStop);
        s.addEventListener('mouseup',     onStop);
        s.addEventListener('touchend',    onStop);
        s.addEventListener('keyup',       onStop);
        s.addEventListener('blur',        onStop);
        s.addEventListener('mouseleave',  onStop);
      });

      // If they switch tabs or the page hides, stop any active timers
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) ['Q1','Q2','Q3','Q4'].forEach(stopActive);
      });

      // On submit, finalize timers and stash for on_finish
      btn.addEventListener('click', () => {
        ['Q1','Q2','Q3','Q4'].forEach(stopActive);
        document.body.dataset.interactTimes = JSON.stringify({
          Q1: Math.round(interact.Q1),
          Q2: Math.round(interact.Q2),
          Q3: Math.round(interact.Q3),
          Q4: Math.round(interact.Q4)
        });
      }, { once: true });

      checkAllTouched();
    }
    // RT is recorded automatically as "rt"

    ,on_finish: (data) => {
      // attach interact times (ms) to the trial row
      try {
        const t = JSON.parse(document.body.dataset.interactTimes || '{}');
        data.Q1_interact_ms = t.Q1 ?? null;
        data.Q2_interact_ms = t.Q2 ?? null;
        data.Q3_interact_ms = t.Q3 ?? null;
        data.Q4_interact_ms = t.Q4 ?? null;
      } catch (_) {
        data.Q1_interact_ms = data.Q2_interact_ms =
        data.Q3_interact_ms = data.Q4_interact_ms = null;
      }
      // data.rt (page-level) remains unchanged
    }
  };
}
// ⬆️⬆️⬆️ END replacement

function makeBlockTrials(label, paths) {
  const trials = paths.map(p => makeImageTrial(label, p));
  return jsPsych.randomization.shuffle(trials); // randomize within block
}

/* ========= BLOCKS & TIMELINE ========= */

const maleIntro   = makeBlockIntro('Male');
const femaleIntro = makeBlockIntro('Female');

const maleTrials   = makeBlockTrials('Male', malePaths);
const femaleTrials = makeBlockTrials('Female', femalePaths);

// Randomize the order of Male vs Female blocks
const blocks = jsPsych.randomization.shuffle([
  { intro: maleIntro,   trials: maleTrials },
  { intro: femaleIntro, trials: femaleTrials }
]);

const thankYou = {
  type: jsPsychInstructions,
  pages: [
    `<div class="center">
       <h2>Thank you!</h2>
       <p>Your responses have been recorded.</p>
     </div>`
  ],
  show_clickable_nav: true,
  button_label_next: 'Finish'
};

// Run (start after Firebase auth)
const timeline = [];
timeline.push(fullscreen);          // remove this line if you don't want fullscreen
timeline.push(preload, welcome, instructions);

// First randomized block, then the other
timeline.push(blocks[0].intro, ...blocks[0].trials);
timeline.push(blocks[1].intro, ...blocks[1].trials);

timeline.push(thankYou);

// ===== FINAL SAVE ONLY (no streaming) =====
function finalSave() {
  const trials = jsPsych.data.get()
    .filter({ trial_type: 'survey-html-form' })
    .values()
    .map(row => ({
      block: row.block,
      image: row.image,
      sex: row.sex,
      face_id: row.face_id,
      height_label: row.height_label,
      attract_label: row.attract_label,

      // built-in page RT
      rt: row.rt,

      // slider responses
      Q1: Number(row.response?.Q1),
      Q2: Number(row.response?.Q2),
      Q3: Number(row.response?.Q3),
      Q4: Number(row.response?.Q4),

      // NEW: per-question active manipulation time (ms)
      Q1_interact_ms: row.Q1_interact_ms ?? null,
      Q2_interact_ms: row.Q2_interact_ms ?? null,
      Q3_interact_ms: row.Q3_interact_ms ?? null,
      Q4_interact_ms: row.Q4_interact_ms ?? null
    }));

  const payload = {
    participant_id,
    participantId,
    assignmentId,
    projectId,
    trials,
    client_version: 'v2', // keep/adjust as you wish
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };

  return db.ref('responses').push(payload);
}

// Ensure anonymous auth completes, then run and save
ensureFirebaseAuth().finally(() => {
  jsPsych.run(timeline).then(async () => {
    try {
      await finalSave(); // ✅ only here
      if (CLOUDRESEARCH_COMPLETION_URL) {
        setTimeout(() => { window.location.href = CLOUDRESEARCH_COMPLETION_URL; }, 1200);
      }
    } catch (e) {
      console.error('Firebase final save failed:', e);
    }
  });
});
