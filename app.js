/* ============================================================================
   app.js — MacroMax application logic (vanilla JS, no build step)
   Persists everything to localStorage so data survives across days & reloads.
   ========================================================================== */

/* ----------------------------- tiny helpers ------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const pad2 = (n) => String(n).padStart(2, "0");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
// For numeric form fields: show an empty box (placeholder visible) when the
// value is zero/blank, so typing replaces it instead of landing after a "0".
const fieldNum = (v) => (v == null || v === "" || Number(v) === 0) ? "" : v;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EQUIP_ORDER = ["Barbell", "Dumbbell", "Machine", "Cable", "Bodyweight", "Other"];
const MUSCLE_ORDER = ["Chest", "Back", "Shoulders", "Legs", "Biceps", "Triceps", "Core", "Custom"];

function todayKey() { return dateToKey(new Date()); }
function dateToKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function keyToDate(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mondayOf(d) { const x = new Date(d); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
function formatLong(k) { const d = keyToDate(k); return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; }

/* ------------------------------- storage --------------------------------- */
const STORAGE_KEY = "macromax_v1";

function defaultDB() {
  return {
    profile: { weightKg: 70 },
    goals: { ...DEFAULT_GOALS },
    customFoods: [],
    customExercises: [],
    customSplits: [],
    logs: {},      // dateKey -> { food: [], cardio: [] }
    sessions: {},  // dateKey -> { label, exercises: [{id,name,muscle,sets:[{reps,weight}]}] }
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultDB();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultDB(), parsed);
  } catch (e) {
    console.warn("Could not read saved data, starting fresh.", e);
    return defaultDB();
  }
}

function saveDB() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(DB)); }
  catch (e) { console.warn("Could not save data.", e); flash("⚠️ Could not save — storage blocked"); }
}

let DB = loadDB();

/* ------------------------------- app state ------------------------------- */
const state = {
  tab: "dashboard",
  date: todayKey(),               // selected day for nutrition / cardio
  weekStart: dateToKey(mondayOf(new Date())),
  cardioMode: "calc",             // 'calc' | 'manual'
  editingSession: null,           // working copy in the workout editor
  editingSplit: null,             // working copy in the split builder
  editorShowPrefill: false,       // is the editor's "prefill from split" panel open
  picker: null,                   // multi-select exercise picker working state
};

/* --------------------------- catalog accessors --------------------------- */
const allFoods = () => SEED_FOODS.concat(DB.customFoods);
const allExercises = () => SEED_EXERCISES.concat(DB.customExercises);
const allSplits = () => SEED_SPLITS.concat(DB.customSplits);
const findFood = (id) => allFoods().find((f) => f.id === id);
const findExercise = (id) => allExercises().find((e) => e.id === id);

function getLog(key) {
  if (!DB.logs[key]) DB.logs[key] = { food: [], cardio: [] };
  if (!DB.logs[key].food) DB.logs[key].food = [];
  if (!DB.logs[key].cardio) DB.logs[key].cardio = [];
  return DB.logs[key];
}

/* ---------------------------- calculations ------------------------------- */
// kcal burned = MET * 3.5 * weightKg / 200 * minutes
function cardioCalories(met, minutes) {
  return met * 3.5 * DB.profile.weightKg / 200 * minutes;
}

function dayTotals(key) {
  const log = getLog(key);
  const t = { kcal: 0, p: 0, c: 0, f: 0, burned: 0 };
  log.food.forEach((it) => { t.kcal += it.kcal; t.p += it.p; t.c += it.c; t.f += it.f; });
  log.cardio.forEach((it) => { t.burned += it.kcal; });
  t.net = t.kcal - t.burned;
  return t;
}

/* -------------------------------- flash ---------------------------------- */
let flashTimer;
function flash(msg) {
  const el = $("#flash");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

/* -------------------------------- modals --------------------------------- */
function openModal(html, id) {
  const root = $("#modal-root");
  const back = document.createElement("div");
  back.className = "modal-backdrop";
  if (id) back.id = id;
  back.innerHTML = `<div class="modal">${html}</div>`;
  back.addEventListener("mousedown", (e) => { if (e.target === back) closeModal(); });
  root.appendChild(back);
  return back;
}
function closeModal() {
  const root = $("#modal-root");
  if (root.lastElementChild) root.removeChild(root.lastElementChild);
}
function closeAllModals() { $("#modal-root").innerHTML = ""; }

/* ============================ RENDER: ROUTER ============================== */
function render() {
  const wv = $("#weight-value");
  if (wv) wv.innerHTML = `${DB.profile.weightKg}<small>kg</small>`;
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === state.tab));
  const app = $("#app");
  if (state.tab === "dashboard") app.innerHTML = viewDashboard();
  else if (state.tab === "nutrition") { app.innerHTML = viewNutrition(); bindNutrition(); }
  else if (state.tab === "cardio") app.innerHTML = viewCardio();
  else if (state.tab === "workouts") app.innerHTML = viewWorkouts();
}

/* ----------------------------- shared bits ------------------------------- */
function progressBar(value, goal, cls) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const over = goal > 0 && value > goal;
  return `<div class="progress bar-${cls} ${over ? "bar-over" : ""}"><span style="width:${pct}%"></span></div>`;
}

function dateNav() {
  return `<div class="date-nav">
    <button class="btn ghost" data-action="prev-date">◀</button>
    <input type="date" id="date-input" value="${state.date}">
    <button class="btn ghost" data-action="next-date">▶</button>
    <button class="btn small secondary" data-action="today-date">Today</button>
  </div>`;
}

/* ============================== DASHBOARD ================================= */
function viewDashboard() {
  const key = todayKey();
  const t = dayTotals(key);
  const g = DB.goals;
  const remaining = g.calories - t.net;

  const macroStat = (label, value, goal, unit, cls) => `
    <div class="stat">
      <div class="label"><span class="dot-${cls}"></span>${label}</div>
      <div class="value">${r0(value)}<small> / ${r0(goal)} ${unit}</small></div>
      <div class="goalline">${goal - value >= 0 ? `${r0(goal - value)} ${unit} left` : `${r0(value - goal)} ${unit} over`}</div>
      ${progressBar(value, goal, cls)}
    </div>`;

  // recent workouts (last 8)
  const sessionKeys = Object.keys(DB.sessions)
    .filter((k) => DB.sessions[k] && DB.sessions[k].exercises && DB.sessions[k].exercises.length)
    .sort().reverse().slice(0, 8);

  const recentRows = sessionKeys.length ? sessionKeys.map((k) => {
    const s = DB.sessions[k];
    let sets = 0, vol = 0;
    s.exercises.forEach((ex) => ex.sets.forEach((st) => { sets++; vol += num(st.reps) * num(st.weight); }));
    return `<tr>
      <td>${formatLong(k)}</td>
      <td><b>${escapeHtml(s.label || "Workout")}</b></td>
      <td class="num">${s.exercises.length}</td>
      <td class="num">${sets}</td>
      <td class="num">${r0(vol).toLocaleString()} kg</td>
    </tr>`;
  }).join("") : `<tr><td colspan="5" class="empty">No workouts logged yet. Go to the Workouts tab to start.</td></tr>`;

  return `
    <div class="view-head"><h2>Today</h2><span style="color:var(--text-dim)">${formatLong(key)}</span></div>

    <div class="grid cols-4 dash-macros">
      ${macroStat("Calories (net)", t.net, g.calories, "kcal", "cal")}
      ${macroStat("Protein", t.p, g.protein, "g", "protein")}
      ${macroStat("Carbs", t.c, g.carbs, "g", "carbs")}
      ${macroStat("Fat", t.f, g.fat, "g", "fat")}
    </div>

    <div class="card">
      <h3>Calorie balance <span class="sub">food eaten minus cardio burned, vs your goal</span></h3>
      <div class="net-row">
        <span class="net-chip dot-cal">Goal <b>${r0(g.calories)}</b></span>
        <span class="net-op">−</span>
        <span class="net-chip">Eaten <b>${r0(t.kcal)}</b></span>
        <span class="net-op">+</span>
        <span class="net-chip dot-cardio">Burned <b>${r0(t.burned)}</b></span>
        <span class="net-op">=</span>
        <span class="net-chip" style="background:var(--accent-dim)">Remaining <b>${r0(remaining)} kcal</b></span>
      </div>
      <p class="hint">Net intake today: ${r0(t.net)} kcal (${r0(t.kcal)} eaten − ${r0(t.burned)} burned). Cardio adds back to your daily budget.</p>
    </div>

    <div class="card">
      <h3>Recent workouts <span class="sub">what you trained &amp; when</span></h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Workout</th><th class="num">Exercises</th><th class="num">Sets</th><th class="num">Volume</th></tr></thead>
        <tbody>${recentRows}</tbody>
      </table></div>
    </div>`;
}

/* ============================== NUTRITION ================================= */
function foodOptions() {
  const cats = [
    ["meal", "Meals & dishes"], ["protein", "Protein"], ["dairy", "Dairy"],
    ["carb", "Carbs & grains"], ["fruit", "Fruit"], ["veg", "Vegetables"],
    ["fat", "Fats & nuts"], ["snack", "Snacks & sweets"], ["drink", "Drinks"],
  ];
  const foods = allFoods();
  return cats.map(([cat, label]) => {
    const items = foods.filter((f) => f.cat === cat);
    if (!items.length) return "";
    return `<optgroup label="${label}">` +
      items.map((f) => `<option value="${f.id}">${escapeHtml(f.name)} — ${f.kcal} kcal/100g</option>`).join("") +
      `</optgroup>`;
  }).join("");
}

function viewNutrition() {
  const key = state.date;
  const log = getLog(key);
  const t = dayTotals(key);
  const g = DB.goals;

  const rows = log.food.length ? log.food.map((it) => `
    <tr>
      <td>${escapeHtml(it.foodName)} <span class="tag">${it.cat}</span></td>
      <td class="num">${r0(it.amount)} g</td>
      <td class="num">${r0(it.kcal)}</td>
      <td class="num">${r1(it.p)}</td>
      <td class="num">${r1(it.c)}</td>
      <td class="num">${r1(it.f)}</td>
      <td class="num"><button class="btn danger" data-action="del-food" data-id="${it.id}">✕</button></td>
    </tr>`).join("") : `<tr><td colspan="7" class="empty">Nothing logged for this day yet.</td></tr>`;

  return `
    <div class="view-head"><h2>Nutrition</h2>${dateNav()}</div>

    <div class="grid cols-2">
      <div class="card">
        <h3>Daily goal <span class="sub">applies to every day until you change it</span></h3>
        <div class="form-grid">
          <div><label class="field">Calories</label><input type="number" id="goal-cal" value="${g.calories}"></div>
          <div><label class="field">Protein (g)</label><input type="number" id="goal-p" value="${g.protein}"></div>
          <div><label class="field">Carbs (g)</label><input type="number" id="goal-c" value="${g.carbs}"></div>
          <div><label class="field">Fat (g)</label><input type="number" id="goal-f" value="${g.fat}"></div>
        </div>
        <div class="btn-row"><button class="btn" data-action="save-goals">Save goal</button></div>
        <p class="hint">Calorie goal automatically counts cardio burned: budget = goal − eaten + burned.</p>
      </div>

      <div class="card">
        <h3>Log food or drink</h3>
        <div>
          <label class="field">Food / drink</label>
          <select id="food-select">${foodOptions()}</select>
        </div>
        <div class="form-row" style="margin-top:12px">
          <div style="flex:0 0 110px">
            <label class="field">Amount</label>
            <input type="number" id="food-amount" value="100" min="0" step="any">
          </div>
          <div>
            <label class="field">Unit</label>
            <select id="food-unit"></select>
          </div>
          <button class="btn" data-action="add-food">Add</button>
        </div>
        <div class="btn-row"><button class="btn secondary small" data-action="open-custom-food">+ Create custom food</button></div>
      </div>
    </div>

    <div class="card">
      <h3>Food log <span class="sub">${formatLong(key)}</span></h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Item</th><th class="num">Amount</th><th class="num">kcal</th><th class="num">P (g)</th><th class="num">C (g)</th><th class="num">F (g)</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="totals">
          <td>Total</td><td class="num"></td>
          <td class="num">${r0(t.kcal)}</td><td class="num">${r1(t.p)}</td><td class="num">${r1(t.c)}</td><td class="num">${r1(t.f)}</td><td></td>
        </tr></tfoot>
      </table></div>
      <p class="hint">Goal: ${g.calories} kcal · P ${g.protein} · C ${g.carbs} · F ${g.fat} &nbsp;|&nbsp; Cardio burned today: ${r0(t.burned)} kcal → net ${r0(t.net)} kcal</p>
    </div>`;
}

// after rendering nutrition, wire up the food unit select + change handler
function bindNutrition() {
  const sel = $("#food-select");
  if (sel) { updateFoodUnits(); sel.addEventListener("change", updateFoodUnits); }
}
function updateFoodUnits() {
  const f = findFood($("#food-select").value);
  const unit = $("#food-unit");
  const isDrink = f && f.cat === "drink";
  let opts = `<option value="g">${isDrink ? "millilitres (ml)" : "grams (g)"}</option>`;
  if (f && f.serving) opts += `<option value="serving">× serving (${escapeHtml(f.serving.label)})</option>`;
  unit.innerHTML = opts;
}

function addFood() {
  const f = findFood($("#food-select").value);
  if (!f) return;
  const amountInput = num($("#food-amount").value);
  const unit = $("#food-unit").value;
  const grams = unit === "serving" && f.serving ? amountInput * f.serving.grams : amountInput;
  if (grams <= 0) { flash("Enter an amount"); return; }
  const factor = grams / 100;
  getLog(state.date).food.push({
    id: uid(), foodName: f.name, cat: f.cat, amount: grams,
    kcal: f.kcal * factor, p: f.p * factor, c: f.c * factor, f: f.f * factor,
  });
  saveDB();
  flash(`Added ${f.name}`);
  render();
}

/* ----------------------- custom food modal ------------------------------- */
function openCustomFood() {
  openModal(`
    <div class="modal-head"><h3>Create custom food</h3><button class="modal-close" data-action="close-modal">×</button></div>
    <div><label class="field">Name</label><input id="cf-name" placeholder="e.g. Mom's lasagna"></div>
    <div style="margin-top:12px"><label class="field">Category</label>
      <select id="cf-cat">
        <option value="meal">Meals &amp; dishes</option><option value="protein">Protein</option>
        <option value="dairy">Dairy</option><option value="carb">Carbs &amp; grains</option>
        <option value="fruit">Fruit</option><option value="veg">Vegetables</option>
        <option value="fat">Fats &amp; nuts</option><option value="snack">Snacks &amp; sweets</option>
        <option value="drink">Drink</option>
      </select>
    </div>
    <p class="hint">Enter macros per 100 g (or per 100 ml for drinks).</p>
    <div class="form-grid">
      <div><label class="field">Calories</label><input type="number" id="cf-kcal" min="0" step="any"></div>
      <div><label class="field">Protein (g)</label><input type="number" id="cf-p" min="0" step="any"></div>
      <div><label class="field">Carbs (g)</label><input type="number" id="cf-c" min="0" step="any"></div>
      <div><label class="field">Fat (g)</label><input type="number" id="cf-f" min="0" step="any"></div>
    </div>
    <div class="form-row" style="margin-top:12px">
      <div><label class="field">Serving label (optional)</label><input id="cf-slabel" placeholder="e.g. 1 portion"></div>
      <div style="flex:0 0 130px"><label class="field">Serving (g)</label><input type="number" id="cf-sgrams" min="0" step="any"></div>
    </div>
    <div class="btn-row"><button class="btn secondary" data-action="close-modal">Cancel</button><button class="btn" data-action="save-custom-food">Save food</button></div>
  `);
}
function saveCustomFood() {
  const name = $("#cf-name").value.trim();
  if (!name) { flash("Name is required"); return; }
  const food = {
    id: "cf-" + uid(), name, cat: $("#cf-cat").value,
    kcal: num($("#cf-kcal").value), p: num($("#cf-p").value), c: num($("#cf-c").value), f: num($("#cf-f").value),
  };
  const sg = num($("#cf-sgrams").value);
  if (sg > 0) food.serving = { label: $("#cf-slabel").value.trim() || `1 serving (${sg} g)`, grams: sg };
  DB.customFoods.push(food);
  saveDB();
  closeModal();
  flash("Custom food saved");
  render();
}

function saveGoals() {
  DB.goals = {
    calories: num($("#goal-cal").value), protein: num($("#goal-p").value),
    carbs: num($("#goal-c").value), fat: num($("#goal-f").value),
  };
  saveDB();
  flash("Goal saved — applies to all days");
  render();
}

/* ================================ CARDIO ================================== */
function viewCardio() {
  const key = state.date;
  const log = getLog(key);
  const totalBurned = log.cardio.reduce((s, it) => s + it.kcal, 0);

  const rows = log.cardio.length ? log.cardio.map((it) => `
    <tr>
      <td>${escapeHtml(it.name)} <span class="tag">${it.mode}</span></td>
      <td class="num">${it.minutes ? r0(it.minutes) + " min" : "—"}</td>
      <td class="num">${r0(it.kcal)} kcal</td>
      <td class="num"><button class="btn danger" data-action="del-cardio" data-id="${it.id}">✕</button></td>
    </tr>`).join("") : `<tr><td colspan="4" class="empty">No cardio logged for this day yet.</td></tr>`;

  const activityOpts = CARDIO_ACTIVITIES
    .map((a) => `<option value="${a.id}">${escapeHtml(a.name)} (${a.met} MET)</option>`).join("");

  const calcForm = `
    <div class="form-row">
      <div style="flex:2"><label class="field">Activity</label><select id="cardio-activity">${activityOpts}</select></div>
      <div style="flex:0 0 120px"><label class="field">Minutes</label><input type="number" id="cardio-minutes" value="30" min="0" step="any"></div>
      <button class="btn" data-action="add-cardio-calc">Add</button>
    </div>
    <p class="hint">Calories are estimated from the activity's MET value and your body weight (${DB.profile.weightKg} kg). Update your weight in the top bar for accuracy.</p>`;

  const manualForm = `
    <div class="form-row">
      <div style="flex:2"><label class="field">Activity name</label><input id="cardio-name" placeholder="e.g. Spin class"></div>
      <div style="flex:0 0 130px"><label class="field">Calories burned</label><input type="number" id="cardio-kcal" min="0" step="any"></div>
      <div style="flex:0 0 110px"><label class="field">Minutes (opt.)</label><input type="number" id="cardio-man-min" min="0" step="any"></div>
      <button class="btn" data-action="add-cardio-manual">Add</button>
    </div>`;

  return `
    <div class="view-head"><h2>Cardio</h2>${dateNav()}</div>

    <div class="card">
      <h3>Log cardio</h3>
      <div class="segment" style="margin-bottom:16px">
        <button class="${state.cardioMode === "calc" ? "active" : ""}" data-action="set-cardio-mode" data-mode="calc">From activity</button>
        <button class="${state.cardioMode === "manual" ? "active" : ""}" data-action="set-cardio-mode" data-mode="manual">Manual entry</button>
      </div>
      ${state.cardioMode === "calc" ? calcForm : manualForm}
    </div>

    <div class="card">
      <h3>Cardio log <span class="sub">${formatLong(key)}</span></h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Activity</th><th class="num">Duration</th><th class="num">Burned</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="totals"><td>Total burned</td><td class="num"></td><td class="num">${r0(totalBurned)} kcal</td><td></td></tr></tfoot>
      </table></div>
      <p class="hint">These calories are added back to today's calorie budget on the Dashboard &amp; Nutrition tabs.</p>
    </div>`;
}

function addCardioCalc() {
  const a = CARDIO_ACTIVITIES.find((x) => x.id === $("#cardio-activity").value);
  const minutes = num($("#cardio-minutes").value);
  if (!a || minutes <= 0) { flash("Enter minutes"); return; }
  getLog(state.date).cardio.push({ id: uid(), name: a.name, minutes, kcal: cardioCalories(a.met, minutes), mode: "calc" });
  saveDB(); flash(`Burned ~${r0(cardioCalories(a.met, minutes))} kcal`); render();
}
function addCardioManual() {
  const name = $("#cardio-name").value.trim() || "Cardio";
  const kcal = num($("#cardio-kcal").value);
  const minutes = num($("#cardio-man-min").value);
  if (kcal <= 0) { flash("Enter calories burned"); return; }
  getLog(state.date).cardio.push({ id: uid(), name, minutes, kcal, mode: "manual" });
  saveDB(); flash(`Logged ${r0(kcal)} kcal`); render();
}

/* =============================== WORKOUTS ================================= */
function viewWorkouts() {
  return `
    <div class="view-head"><h2>Workouts</h2></div>
    ${workoutWeekHtml()}
    ${workoutSplitsHtml()}`;
}

function workoutWeekHtml() {
  const start = keyToDate(state.weekStart);
  const end = addDays(start, 6);
  const label = `${start.getDate()} ${MON[start.getMonth()]} – ${end.getDate()} ${MON[end.getMonth()]} ${end.getFullYear()}`;
  const today = todayKey();

  const cards = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const key = dateToKey(d);
    const s = DB.sessions[key];
    const has = s && s.exercises && s.exercises.length;
    let sets = 0;
    if (has) s.exercises.forEach((ex) => sets += ex.sets.length);
    return `<div class="day-card ${key === today ? "today" : ""}" data-action="open-day" data-date="${key}">
      <div class="dow">${DOW[d.getDay()]}</div>
      <div class="dnum">${d.getDate()}</div>
      ${has
        ? `<div class="wname">${escapeHtml(s.label || "Workout")}</div><div class="wmeta">${s.exercises.length} exercises · ${sets} sets</div>`
        : `<div class="rest">Rest / tap to log</div>`}
    </div>`;
  }).join("");

  return `<div class="card">
    <h3>Weekly sheet <span class="sub">tap a day to build &amp; log your workout</span></h3>
    <div class="view-head" style="margin-bottom:14px">
      <button class="btn ghost" data-action="prev-week">◀</button>
      <b>${label}</b>
      <button class="btn ghost" data-action="next-week">▶</button>
      <button class="btn small secondary" data-action="this-week">This week</button>
    </div>
    <div class="week-grid">${cards}</div>
  </div>`;
}

function workoutSplitsHtml() {
  const cards = allSplits().map((sp) => {
    const days = sp.days.map((d, i) =>
      `<button class="split-day-chip" data-action="split-day-apply" data-split="${sp.id}" data-day="${i}" title="Log “${escapeHtml(d.name)}” for today">${escapeHtml(d.name)} <span class="chip-count">${d.exercises.length}</span></button>`
    ).join("");
    return `<div class="stat split-card">
      <div class="split-card-head">
        <b style="flex:1;font-size:16px">${escapeHtml(sp.name)}</b>
        ${sp.builtIn ? `<span class="tag">built-in</span>` : `<button class="btn danger" data-action="del-split" data-id="${sp.id}">✕</button>`}
      </div>
      <div class="split-days">${days}</div>
      <div class="btn-row">
        <button class="btn small secondary" data-action="${sp.builtIn ? "customize-split" : "edit-split"}" data-id="${sp.id}">${sp.builtIn ? "Customize a copy" : "Edit"}</button>
      </div>
    </div>`;
  }).join("");

  return `<div class="card">
    <h3>Workout splits <span class="sub">tap any day to log it for today, or build your own</span></h3>
    <div class="grid cols-2">${cards}</div>
    <div class="btn-row" style="margin-top:16px"><button class="btn" data-action="open-split-builder">+ Create new split</button></div>
  </div>`;
}

/* ---------------------- workout day editor (modal) ----------------------- */
function openWorkoutEditor(dateKey, opts = {}) {
  const existing = DB.sessions[dateKey];
  state.editingSession = existing
    ? JSON.parse(JSON.stringify(existing))
    : { label: "", exercises: [] };
  state.editingSession._date = dateKey;
  state.editorShowPrefill = false;

  openModal(`
    <div class="modal-head"><h3>Workout — ${formatLong(dateKey)}</h3><button class="modal-close" data-action="close-modal">×</button></div>
    <div id="editor-body"></div>
  `, "editor-modal");
  refreshEditorBody();
  // optional one-tap prefill (e.g. when launched from a split-day chip)
  if (opts.prefill) prefillSplitDay(opts.prefill.split, opts.prefill.day);
}

/* Expandable "prefill from a split" panel — split days shown as tappable chips */
function prefillPanelHtml() {
  const groups = allSplits().map((sp) => {
    const days = sp.days.map((d, i) =>
      `<button class="prefill-day-chip" data-action="prefill-day" data-split="${sp.id}" data-day="${i}">${escapeHtml(d.name)} <span class="chip-count">${d.exercises.length}</span></button>`
    ).join("");
    return `<div class="prefill-split-group"><span class="prefill-split-name">${escapeHtml(sp.name)}</span><div class="pick-list">${days}</div></div>`;
  }).join("");
  return `<div class="prefill-panel">${groups}</div>`;
}

function editorBodyHtml() {
  const s = state.editingSession;
  const exHtml = s.exercises.length ? s.exercises.map((ex, ei) => {
    const setRows = ex.sets.map((st, si) => `
      <div class="set-row" data-ex="${ei}" data-set="${si}">
        <span class="setno">Set ${si + 1}</span>
        <input type="number" inputmode="numeric" data-field="set" data-ex="${ei}" data-set="${si}" data-prop="reps" value="${fieldNum(st.reps)}" placeholder="reps">
        <input type="number" inputmode="decimal" data-field="set" data-ex="${ei}" data-set="${si}" data-prop="weight" value="${fieldNum(st.weight)}" placeholder="kg">
        <button class="btn danger" data-action="del-set" data-ex="${ei}" data-set="${si}">✕</button>
      </div>`).join("");
    return `<div class="exercise-block">
      <div class="exercise-head">
        <span class="ename">${escapeHtml(ex.name)}</span>
        ${ex.muscle ? `<span class="tag">${escapeHtml(ex.muscle)}</span>` : ""}
        ${ex.equip ? `<span class="tag">${escapeHtml(ex.equip)}</span>` : ""}
        <button class="btn danger" data-action="del-exercise" data-ex="${ei}">Remove</button>
      </div>
      <div class="set-row"><span></span><span class="set-head">Reps</span><span class="set-head">Weight (kg)</span><span></span></div>
      ${setRows}
      <div class="btn-row"><button class="btn small secondary" data-action="add-set" data-ex="${ei}">+ Add set</button></div>
    </div>`;
  }).join("") : `<p class="empty">No exercises yet — add one below, or prefill from a split day.</p>`;

  return `
    <div><label class="field">Workout name</label><input data-field="session-label" value="${escapeHtml(s.label || "")}" placeholder="e.g. Push Day"></div>
    <div class="prefill-zone">
      <button class="btn secondary small ${state.editorShowPrefill ? "is-open" : ""}" data-action="toggle-prefill">↺ Prefill from a split ${state.editorShowPrefill ? "▴" : "▾"}</button>
      ${state.editorShowPrefill ? prefillPanelHtml() : ""}
    </div>
    <div style="margin-top:18px">${exHtml}</div>
    <div class="btn-row" style="margin-top:8px"><button class="btn secondary" data-action="add-exercise-to-session">+ Add exercise</button></div>
    <div class="btn-row" style="justify-content:flex-end;margin-top:22px">
      ${DB.sessions[s._date] ? `<button class="btn danger" data-action="delete-session">Delete workout</button>` : ""}
      <button class="btn secondary" data-action="close-modal">Cancel</button>
      <button class="btn" data-action="save-session">Save workout</button>
    </div>`;
}
function refreshEditorBody() {
  const body = $("#editor-body");
  if (body) body.innerHTML = editorBodyHtml();
}

function prefillSplitDay(splitId, idx) {
  const sp = allSplits().find((x) => x.id === splitId);
  if (!sp) return;
  const day = sp.days[Number(idx)];
  if (!day) return;
  if (!state.editingSession.label) state.editingSession.label = day.name;
  day.exercises.forEach((exId) => {
    const ex = findExercise(exId);
    state.editingSession.exercises.push({
      id: uid(), name: ex ? ex.name : exId, muscle: ex ? ex.muscle : "", equip: ex ? ex.equip : "",
      sets: [{ reps: 10, weight: 0 }, { reps: 10, weight: 0 }, { reps: 10, weight: 0 }],
    });
  });
  state.editorShowPrefill = false;
  refreshEditorBody();
  flash(`Prefilled “${day.name}” — ${day.exercises.length} exercises`);
}

function addSet(ei) {
  const sets = state.editingSession.exercises[ei].sets;
  const last = sets[sets.length - 1] || { reps: 10, weight: 0 };
  sets.push({ reps: last.reps, weight: last.weight });
  refreshEditorBody();
}
function delSet(ei, si) {
  state.editingSession.exercises[ei].sets.splice(si, 1);
  if (!state.editingSession.exercises[ei].sets.length)
    state.editingSession.exercises[ei].sets.push({ reps: 0, weight: 0 });
  refreshEditorBody();
}
function delExercise(ei) { state.editingSession.exercises.splice(ei, 1); refreshEditorBody(); }

function saveSession() {
  const s = state.editingSession;
  const key = s._date;
  if (!s.exercises.length) { delete DB.sessions[key]; }
  else DB.sessions[key] = { label: s.label || "Workout", exercises: s.exercises.map((e) => ({ id: e.id, name: e.name, muscle: e.muscle, equip: e.equip, sets: e.sets })) };
  saveDB(); closeModal(); flash("Workout saved"); render();
}
function deleteSession() {
  delete DB.sessions[state.editingSession._date];
  saveDB(); closeModal(); flash("Workout deleted"); render();
}

/* ------------- exercise picker (searchable, multi-select) ----------------
   One reusable picker drives both the workout editor and the split builder.
   Open it with a callback that receives the array of chosen exercise ids:
     openExercisePicker((ids) => { ... }, { title: "Add exercises" })
   Selecting toggles chips (no modal churn); "Add N" confirms them all at once.
   ------------------------------------------------------------------------ */
function openExercisePicker(onConfirm, opts = {}) {
  state.picker = {
    selected: [], query: "", equip: "all", muscle: "all",
    onConfirm, title: opts.title || "Add exercises",
  };
  openModal(`
    <div class="modal-head"><h3>${escapeHtml(state.picker.title)}</h3><button class="modal-close" data-action="close-modal">×</button></div>
    <div class="picker-search-wrap">
      <span class="picker-search-ico">⌕</span>
      <input id="picker-search" type="text" autocomplete="off" placeholder="Search exercises…" data-field="picker-search">
    </div>
    <div id="picker-filters">${pickerFiltersHtml()}</div>
    <div id="picker-list" class="picker-scroll">${pickerListHtml()}</div>
    <div id="picker-create" class="picker-create" hidden>${pickerCreateHtml()}</div>
    <div class="picker-foot">
      <button class="btn secondary small" data-action="toggle-create-ex">+ New exercise</button>
      <div class="picker-foot-actions">
        <span class="picker-selected-count" id="picker-count">No exercises selected</span>
        <button class="btn" data-action="picker-confirm" id="picker-add-btn" disabled>Add</button>
      </div>
    </div>
  `, "picker-modal");
  setTimeout(() => { const s = $("#picker-search"); if (s) s.focus(); }, 60);
}

function pickerFiltersHtml() {
  const p = state.picker;
  const row = (items, key, active) => `<div class="pick-filter-row">` + items.map(([v, l]) =>
    `<button class="pick-chip ${active === v ? "active" : ""}" data-action="picker-set" data-key="${key}" data-val="${v}">${l}</button>`).join("") + `</div>`;
  const muscle = [["all", "All"]].concat(MUSCLE_ORDER.map((m) => [m, m]));
  const equip = [["all", "All"]].concat(EQUIP_ORDER.map((e) => [e, e]));
  return `<div class="pick-filter-label">Muscle</div>${row(muscle, "muscle", p.muscle)}` +
         `<div class="pick-filter-label">Equipment</div>${row(equip, "equip", p.equip)}`;
}

function pickerListHtml() {
  const p = state.picker;
  const q = p.query.trim().toLowerCase();
  const exs = allExercises().filter((e) => {
    if (p.equip !== "all" && (e.equip || "Other") !== p.equip) return false;
    if (p.muscle !== "all" && (e.muscle || "Custom") !== p.muscle) return false;
    if (q && !e.name.toLowerCase().includes(q)) return false;
    return true;
  });
  if (!exs.length) {
    const ql = p.query.trim();
    return `<div class="picker-empty">
      <p class="empty">No exercises match${ql ? ` “${escapeHtml(ql)}”` : " these filters"}.</p>
      ${ql ? `<button class="btn small" data-action="picker-create-from-search">+ Create “${escapeHtml(ql)}”</button>` : ""}
    </div>`;
  }
  let html = "";
  MUSCLE_ORDER.forEach((m) => {
    const inM = exs.filter((e) => (e.muscle || "Custom") === m);
    if (!inM.length) return;
    html += `<div class="muscle-group">${m}</div><div class="pick-list">` + inM.map((e) => {
      const on = p.selected.includes(e.id);
      return `<button class="pick-ex ${on ? "selected" : ""}" data-action="picker-toggle" data-exid="${e.id}">${escapeHtml(e.name)}${e.equip ? `<span class="pick-ex-eq">${escapeHtml(e.equip)}</span>` : ""}</button>`;
    }).join("") + `</div>`;
  });
  return html;
}

function pickerCreateHtml() {
  const muscleOpts = MUSCLE_ORDER.map((m) => `<option>${m}</option>`).join("");
  const equipOpts = EQUIP_ORDER.map((e) => `<option>${e}</option>`).join("");
  return `<div class="pick-filter-label">Create a custom exercise</div>
    <div class="form-row">
      <div style="flex:2"><input id="new-ex-name" placeholder="e.g. Cable Pullover"></div>
      <div><select id="new-ex-muscle">${muscleOpts}</select></div>
      <div><select id="new-ex-equip">${equipOpts}</select></div>
      <button class="btn small" data-action="add-new-exercise">Create</button>
    </div>
    <p class="hint">Saved to your library and selected automatically.</p>`;
}

function pickerToggle(exId, btn) {
  const sel = state.picker.selected;
  const i = sel.indexOf(exId);
  if (i >= 0) sel.splice(i, 1); else sel.push(exId);
  if (btn) btn.classList.toggle("selected", i < 0);
  updatePickerCount();
}
function updatePickerCount() {
  const n = state.picker.selected.length;
  const c = $("#picker-count"), b = $("#picker-add-btn");
  if (c) c.textContent = n ? `${n} selected` : "No exercises selected";
  if (b) { b.disabled = !n; b.textContent = n ? `Add ${n}` : "Add"; }
}
function refreshPicker() {
  const f = $("#picker-filters"); if (f) f.innerHTML = pickerFiltersHtml();
  const l = $("#picker-list"); if (l) l.innerHTML = pickerListHtml();
}
function pickerConfirm() {
  const ids = state.picker.selected.slice();
  const cb = state.picker.onConfirm;
  closeModal();
  if (cb) cb(ids);
}
function createExerciseFromPicker(name, muscle, equip) {
  name = (name || "").trim();
  if (!name) { flash("Enter a name"); return; }
  const p = state.picker;
  muscle = muscle || (p.muscle !== "all" ? p.muscle : "Custom");
  equip = equip || (p.equip !== "all" ? p.equip : "Other");
  const ex = { id: "ce-" + uid(), name, muscle, equip };
  DB.customExercises.push(ex); saveDB();
  p.selected.push(ex.id);
  p.query = "";
  const s = $("#picker-search"); if (s) s.value = "";
  const panel = $("#picker-create"); if (panel) panel.hidden = true;
  refreshPicker();
  updatePickerCount();
  flash(`Created & selected ${name}`);
}

/* ----------------------- split builder (modal) --------------------------- */
function openSplitBuilder(copyFromId) {
  if (copyFromId) {
    const src = allSplits().find((s) => s.id === copyFromId);
    state.editingSplit = JSON.parse(JSON.stringify(src));
    state.editingSplit.builtIn = false;
    if (src.builtIn) { state.editingSplit.name = src.name + " (my copy)"; state.editingSplit._editId = null; }
    else state.editingSplit._editId = src.id;
  } else {
    state.editingSplit = { name: "", days: [{ name: "Day 1", exercises: [] }], _editId: null };
  }
  openModal(`
    <div class="modal-head"><h3>Workout split</h3><button class="modal-close" data-action="close-modal">×</button></div>
    <div id="split-body"></div>
  `, "split-modal");
  refreshSplitBody();
}

function splitBodyHtml() {
  const sp = state.editingSplit;
  const days = sp.days.map((d, di) => {
    const chips = d.exercises.map((exId, xi) => {
      const ex = findExercise(exId);
      return `<button class="split-ex-chip" data-action="split-del-exercise" data-day="${di}" data-idx="${xi}">${escapeHtml(ex ? ex.name : exId)} <span class="x">✕</span></button>`;
    }).join("");
    return `<div class="exercise-block">
      <div class="form-row">
        <div style="flex:2"><label class="field">Day name</label><input data-field="split-day-name" data-day="${di}" value="${escapeHtml(d.name)}"></div>
        ${sp.days.length > 1 ? `<button class="btn danger" data-action="split-del-day" data-day="${di}">Remove day</button>` : ""}
      </div>
      <div style="margin-top:10px"><label class="field">Exercises <span class="count-soft">${d.exercises.length}</span></label>
        <div class="pick-list split-ex-list">${chips || `<span class="empty">No exercises yet — add some below.</span>`}</div>
        <div class="btn-row" style="margin-top:8px"><button class="btn secondary small" data-action="split-add-exercise" data-day="${di}">+ Add exercises</button></div>
      </div>
    </div>`;
  }).join("");

  return `
    <div><label class="field">Split name</label><input data-field="split-name" value="${escapeHtml(sp.name)}" placeholder="e.g. My PPL"></div>
    <div style="margin-top:16px">${days}</div>
    <div class="btn-row"><button class="btn secondary small" data-action="split-add-day">+ Add day</button></div>
    <div class="btn-row" style="justify-content:flex-end;margin-top:22px">
      <button class="btn secondary" data-action="close-modal">Cancel</button>
      <button class="btn" data-action="save-split">Save split</button>
    </div>`;
}
function refreshSplitBody() { const b = $("#split-body"); if (b) b.innerHTML = splitBodyHtml(); }

function saveSplit() {
  const sp = state.editingSplit;
  if (!sp.name.trim()) { flash("Name your split"); return; }
  const clean = { id: sp._editId || ("cs-" + uid()), name: sp.name.trim(), builtIn: false,
    days: sp.days.map((d) => ({ name: d.name, exercises: d.exercises })) };
  const idx = DB.customSplits.findIndex((x) => x.id === clean.id);
  if (idx >= 0) DB.customSplits[idx] = clean; else DB.customSplits.push(clean);
  saveDB(); closeModal(); flash("Split saved"); render();
}

/* ----------------------- weight / profile modal -------------------------- */
function openWeightModal() {
  openModal(`
    <div class="modal-head"><h3>Body weight</h3><button class="modal-close" data-action="close-modal">×</button></div>
    <div><label class="field">Weight (kg)</label><input type="number" id="weight-input" value="${DB.profile.weightKg}" min="0" step="any"></div>
    <p class="hint">Used to estimate calories burned during cardio.</p>
    <div class="btn-row"><button class="btn secondary" data-action="close-modal">Cancel</button><button class="btn" data-action="save-weight">Save</button></div>
  `);
}
function saveWeight() {
  const w = num($("#weight-input").value);
  if (w > 0) { DB.profile.weightKg = w; saveDB(); flash("Weight updated"); }
  closeModal(); render();
}

/* ============================ EVENT WIRING =============================== */
// tab nav
$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  state.tab = btn.dataset.tab;
  render();
});
$("#weight-pill").addEventListener("click", openWeightModal);

// global click delegation for [data-action]
document.body.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  const D = el.dataset;

  switch (a) {
    // date nav
    case "prev-date": state.date = dateToKey(addDays(keyToDate(state.date), -1)); render(); break;
    case "next-date": state.date = dateToKey(addDays(keyToDate(state.date), 1)); render(); break;
    case "today-date": state.date = todayKey(); render(); break;
    // nutrition
    case "save-goals": saveGoals(); break;
    case "add-food": addFood(); break;
    case "del-food": getLog(state.date).food = getLog(state.date).food.filter((x) => x.id !== D.id); saveDB(); render(); break;
    case "open-custom-food": openCustomFood(); break;
    case "save-custom-food": saveCustomFood(); break;
    // cardio
    case "set-cardio-mode": state.cardioMode = D.mode; render(); break;
    case "add-cardio-calc": addCardioCalc(); break;
    case "add-cardio-manual": addCardioManual(); break;
    case "del-cardio": getLog(state.date).cardio = getLog(state.date).cardio.filter((x) => x.id !== D.id); saveDB(); render(); break;
    // workouts: week nav
    case "prev-week": state.weekStart = dateToKey(addDays(keyToDate(state.weekStart), -7)); render(); break;
    case "next-week": state.weekStart = dateToKey(addDays(keyToDate(state.weekStart), 7)); render(); break;
    case "this-week": state.weekStart = dateToKey(mondayOf(new Date())); render(); break;
    case "open-day": openWorkoutEditor(D.date); break;
    // workout editor: prefill from split
    case "toggle-prefill": state.editorShowPrefill = !state.editorShowPrefill; refreshEditorBody(); break;
    case "prefill-day": prefillSplitDay(D.split, Number(D.day)); break;
    // workout editor: add exercises (searchable multi-select picker)
    case "add-exercise-to-session":
      openExercisePicker((ids) => {
        ids.forEach((id) => {
          const ex = findExercise(id); if (!ex) return;
          state.editingSession.exercises.push({ id: uid(), name: ex.name, muscle: ex.muscle, equip: ex.equip, sets: [{ reps: 10, weight: 0 }] });
        });
        refreshEditorBody();
        if (ids.length) flash(`Added ${ids.length} exercise${ids.length > 1 ? "s" : ""}`);
      }, { title: "Add exercises" });
      break;
    // exercise picker internals
    case "picker-set": state.picker[D.key] = D.val; refreshPicker(); break;
    case "picker-toggle": pickerToggle(D.exid, el); break;
    case "picker-confirm": pickerConfirm(); break;
    case "toggle-create-ex": {
      const panel = $("#picker-create");
      if (panel) { panel.hidden = !panel.hidden; if (!panel.hidden) { const n = $("#new-ex-name"); if (n) n.focus(); } }
      break;
    }
    case "add-new-exercise": createExerciseFromPicker($("#new-ex-name").value, $("#new-ex-muscle").value, $("#new-ex-equip").value); break;
    case "picker-create-from-search": createExerciseFromPicker(state.picker.query, null, null); break;
    case "add-set": addSet(Number(D.ex)); break;
    case "del-set": delSet(Number(D.ex), Number(D.set)); break;
    case "del-exercise": delExercise(Number(D.ex)); break;
    case "save-session": saveSession(); break;
    case "delete-session": if (confirm("Delete this workout?")) deleteSession(); break;
    // splits
    case "open-split-builder": openSplitBuilder(); break;
    case "customize-split": case "edit-split": openSplitBuilder(D.id); break;
    case "split-day-apply": openWorkoutEditor(todayKey(), { prefill: { split: D.split, day: Number(D.day) } }); break;
    case "del-split": if (confirm("Delete this split?")) { DB.customSplits = DB.customSplits.filter((x) => x.id !== D.id); saveDB(); render(); } break;
    case "split-add-day": state.editingSplit.days.push({ name: `Day ${state.editingSplit.days.length + 1}`, exercises: [] }); refreshSplitBody(); break;
    case "split-del-day": state.editingSplit.days.splice(Number(D.day), 1); refreshSplitBody(); break;
    case "split-add-exercise": {
      const di = Number(D.day);
      openExercisePicker((ids) => {
        ids.forEach((id) => state.editingSplit.days[di].exercises.push(id));
        refreshSplitBody();
        if (ids.length) flash(`Added ${ids.length} exercise${ids.length > 1 ? "s" : ""}`);
      }, { title: `Add to “${state.editingSplit.days[di].name || "day"}”` });
      break;
    }
    case "split-del-exercise": state.editingSplit.days[Number(D.day)].exercises.splice(Number(D.idx), 1); refreshSplitBody(); break;
    case "save-split": saveSplit(); break;
    // profile / modal
    case "edit-weight": openWeightModal(); break;
    case "save-weight": saveWeight(); break;
    case "close-modal": closeModal(); break;
  }
});

// live-sync inputs that must survive a re-render (workout editor + split builder)
document.body.addEventListener("input", (e) => {
  const el = e.target;
  const field = el.dataset.field;
  if (!field) return;
  if (field === "session-label" && state.editingSession) state.editingSession.label = el.value;
  else if (field === "set" && state.editingSession) {
    const ex = state.editingSession.exercises[Number(el.dataset.ex)];
    if (ex) ex.sets[Number(el.dataset.set)][el.dataset.prop] = el.value;
  } else if (field === "split-name" && state.editingSplit) state.editingSplit.name = el.value;
  else if (field === "split-day-name" && state.editingSplit) state.editingSplit.days[Number(el.dataset.day)].name = el.value;
  else if (field === "picker-search" && state.picker) {
    state.picker.query = el.value;
    const l = $("#picker-list"); if (l) l.innerHTML = pickerListHtml();
  }
});

// date picker change
document.body.addEventListener("change", (e) => {
  if (e.target.id === "date-input") { state.date = e.target.value; render(); }
});

// seamless numeric entry: tapping a number field selects its contents, so the
// first keystroke replaces the existing value instead of appending to it
document.body.addEventListener("focusin", (e) => {
  if (e.target.matches('input[type="number"]')) {
    const el = e.target;
    setTimeout(() => { try { el.select(); } catch (_) {} }, 0);
  }
});

/* ===================== APPLE SHORTCUTS / URL ACTIONS =====================
   The app can be driven by opening a URL with a ?do=... query, e.g.
     ?do=food&item=banana&serving=1
     ?do=food&item=chicken-breast&grams=200
     ?do=cardio&activity=run-10&min=30
     ?do=cardio&kcal=300&name=Spin%20class
     ?do=weight&kg=72
     ?do=open&tab=nutrition
   A Shortcut's "Open URLs" action can build one of these to quick-log an entry.
   ======================================================================== */
function findFoodLoose(q) {
  if (!q) return null;
  const foods = allFoods();
  const ql = q.trim().toLowerCase();
  return foods.find((x) => x.id === q) ||
         foods.find((x) => x.name.toLowerCase() === ql) ||
         foods.find((x) => x.name.toLowerCase().includes(ql)) || null;
}
function findActivityLoose(q) {
  if (!q) return null;
  const ql = q.trim().toLowerCase();
  return CARDIO_ACTIVITIES.find((x) => x.id === q) ||
         CARDIO_ACTIVITIES.find((x) => x.name.toLowerCase().includes(ql)) || null;
}

let _pendingFlash = "";
function handleDeepLink() {
  const p = new URLSearchParams(location.search);
  const action = p.get("do");
  if (!action) return;
  const minutes = parseFloat(p.get("min") || p.get("minutes") || "0");

  if (action === "food") {
    const f = findFoodLoose(p.get("item") || p.get("food"));
    if (f) {
      const grams = (p.get("serving") && f.serving)
        ? parseFloat(p.get("serving")) * f.serving.grams
        : parseFloat(p.get("grams") || p.get("g") || "100");
      if (grams > 0) {
        const factor = grams / 100;
        getLog(todayKey()).food.push({
          id: uid(), foodName: f.name, cat: f.cat, amount: grams,
          kcal: f.kcal * factor, p: f.p * factor, c: f.c * factor, f: f.f * factor,
        });
        saveDB(); state.tab = "nutrition"; state.date = todayKey();
        _pendingFlash = `✓ Logged ${r0(grams)} g ${f.name}`;
      }
    } else _pendingFlash = `Food not found: "${p.get("item") || p.get("food") || ""}"`;
  } else if (action === "cardio") {
    if (p.get("kcal")) {
      const kcal = parseFloat(p.get("kcal"));
      getLog(todayKey()).cardio.push({ id: uid(), name: p.get("name") || "Cardio", minutes, kcal, mode: "manual" });
      saveDB(); state.tab = "cardio"; _pendingFlash = `✓ Logged ${r0(kcal)} kcal burned`;
    } else {
      const a = findActivityLoose(p.get("activity"));
      if (a && minutes > 0) {
        const kcal = cardioCalories(a.met, minutes);
        getLog(todayKey()).cardio.push({ id: uid(), name: a.name, minutes, kcal, mode: "calc" });
        saveDB(); state.tab = "cardio"; _pendingFlash = `✓ ${a.name}, ${r0(minutes)} min (~${r0(kcal)} kcal)`;
      } else _pendingFlash = "Could not log cardio — check activity & minutes";
    }
  } else if (action === "weight") {
    const kg = parseFloat(p.get("kg") || p.get("kgs") || "");
    if (kg > 0) { DB.profile.weightKg = kg; saveDB(); _pendingFlash = `✓ Body weight set to ${kg} kg`; }
  } else if (action === "open") {
    const t = p.get("tab");
    if (["dashboard", "nutrition", "cardio", "workouts"].includes(t)) state.tab = t;
  }
  // strip the query so a manual reload won't repeat the action
  history.replaceState(null, "", location.pathname);
}

/* --------------------------------- init ---------------------------------- */
handleDeepLink();
render();
if (_pendingFlash) setTimeout(() => flash(_pendingFlash), 120);

// register the service worker (only over http/https; ignored when opened as a file)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
