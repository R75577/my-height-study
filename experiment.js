/***********************
 * Perception Study (PNG images)
 * One image + four 1–7 sliders per trial (with “Not so much” / “Very” endpoints)
 * Two blocks (Male / Female) — block order randomized; trials randomized within blocks
 * Saves each trial immediately to Firebase (/responses_stream) + full payload at end (/responses)
 * No local CSV downloads; optional CloudResearch redirect
 ***********************/

/* ========= BASIC OPTIONS ========= */

const IMAGE_EXT = '.png';   // your files are PNG

// Slider tick labels (1..7 with endpoint text)
const tickRowHTML = `
  <div class="slider-ticks">
    <span>1<br><small>Not so much</small></span>
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

// Stream a single trial row immediately (for partial-completer capture)
async function saveTrialRow(row) {
  try {
    await db.ref('responses_stream').push(row);
  } catch (e) {
    console.warn('Partial save failed:', e);
  }
}

/* ========= INIT JPSYCH ========= */

const jsPsych = initJsPsych({
  show_progress_bar: true,
  message_progress_bar: 'Progress',

  // STREAM EACH IMAGE TRIAL AS IT FINISHES
  on_trial_finish: function (data) {
    if (data.trial_type === 'survey-html-form') {
      saveTrialRow({
        participant_id,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        block: data.block,
        image: data.image,
        sex: data.sex,
        face_id: data.face_id,
        height_label: data.height_label,
        attract_label: data.attract_label,
        rt: data.rt,
        Q1: Number(data.response?.Q1),
        Q2: Number(data.response?.Q2),
        Q3: Number(data.response?.Q3),
        Q4: Number(data.response?.Q4)
      });
    }
  },

  // FINAL FULL SAVE (ONE RECORD PER PARTICIPANT)
  on_finish: async function () {
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
        rt: row.rt,
        Q1: Number(row.response?.Q1),
        Q2: Number(row.response?.Q2),
        Q3: Number(row.response?.Q3),
        Q4: Number(row.response?.Q4)
      }));

    const payload = {
      participant_id,
      trials,
      client_version: 'v1',
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    try {
      await db.ref('responses').push(payload);
      console.log('Firebase final save OK');
    } catch (e) {
      console.error('Firebase final save failed:', e);
      // No CSV fallback (you asked for no downloads)
    }

    if (CLOUDRESEARCH_COMPLETION_URL) {
      setTimeout(() => { window.location.href = CLOUDRESEARCH_COMPLETION_URL; }, 1200);
    }
  }
});

// Participant ID (captures ?workerId, ?pid, or generates one)
const participant_id =
  getParam('pid') || getParam('workerId') || getParam('PROLIFIC_PID') || safeUUID();
jsPsych.data.addProperties({ participant_id });

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
       <p>On each screen, you will see <strong>one image</strong> and <strong>four questions</strong>.</p>
       <p>Use the 1–7 scale for each question. All four answers are required.</p>
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

function makeImageTrial(blockLabel, imgPath) {
  const htmlBlock = `
    <div class="q-block">
      ${sliderHTML('Q1', questionTexts[0])}
      ${sliderHTML('Q2', questionTexts[1])}
      ${sliderHTML('Q3', questionTexts[2])}
      ${sliderHTML('Q4', questionTexts[3])}
    </div>`;

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

      // Mark as answered on ANY interaction (including click on current value)
      sliders.forEach(s => {
        const mark = () => { s.dataset.touched = '1'; checkAllTouched(); };

        s.addEventListener('input', mark,       { once: true });
        s.addEventListener('change', mark,      { once: true });
        s.addEventListener('pointerdown', mark, { once: true });
        s.addEventListener('mousedown', mark,   { once: true });
        s.addEventListener('touchstart', mark,  { once: true });
        s.addEventListener('focus', mark,       { once: true });
        s.addEventListener('keydown', mark,     { once: true });
      });

      checkAllTouched();
    }
    // RT is recorded automatically as "rt"
  };
}

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

// Ensure anonymous auth completes, then run
ensureFirebaseAuth().finally(() => {
  jsPsych.run(timeline);
});
