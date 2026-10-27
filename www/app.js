const $ = id => document.getElementById(id);

const SAVED_KEY = "whatif_dashboard_saved_v1";
const PREFS_KEY = "whatif_user_prefs_v1";
const TASKS_KEY = "whatif_tasks_v1";
const EVENTS_KEY = "whatif_activity_log_v1";
const FOCUS_KEY = "whatif_focus_stats_v1";

let currentScenario = null;
let timerSeconds = 25 * 60;
let timerRunning = false;
let timerInterval = null;
let showAllSaved = false;

function esc(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}
function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast("تعذر حفظ البيانات محليًا. تحقق من مساحة التخزين.");
    return false;
  }
}
function toast(message) {
  const element = $("toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2400);
}
function saved() { return readJSON(SAVED_KEY, []); }
function getTasks() { return readJSON(TASKS_KEY, []); }
function getEvents() { return readJSON(EVENTS_KEY, []); }
function getFocusStats() { return readJSON(FOCUS_KEY, { sessions: 0, totalMinutes: 0 }); }

function logEvent(type, label, extra = {}) {
  const events = getEvents();
  events.push({ type, label: label || "", at: new Date().toISOString(), ...extra });
  // Keep a bounded local history instead of growing storage forever.
  writeJSON(EVENTS_KEY, events.slice(-500));
}
function localStorageAvailable() {
  const probe = "__whatif_storage_probe__";
  try {
    localStorage.setItem(probe, "ok");
    const works = localStorage.getItem(probe) === "ok";
    localStorage.removeItem(probe);
    return works;
  } catch {
    return false;
  }
}
function dateTime() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
  $("dateText").textContent = now.toLocaleDateString("ar-IQ", { year: "numeric", month: "long", day: "numeric" });
  $("dayText").textContent = now.toLocaleDateString("ar-IQ", { weekday: "long" });
}
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function eventsLastDays(days) {
  const cutoff = startOfDay(new Date());
  cutoff.setDate(cutoff.getDate() - (days - 1));
  return getEvents().filter(event => {
    const at = new Date(event.at);
    return !Number.isNaN(at.getTime()) && at >= cutoff;
  });
}
function eventDescription(event) {
  const labels = {
    simulation_created: "إنشاء محاكاة",
    scenario_saved: "حفظ سيناريو",
    task_added: "إضافة مهمة",
    task_completed: "إكمال مهمة",
    focus_completed: "إكمال جلسة تركيز",
    saved_scenarios_cleared: "حذف المحفوظات"
  };
  const verb = labels[event.type] || "نشاط";
  return event.label ? `${verb}: ${event.label}` : verb;
}
function updateRiskDescription(risk) {
  const descriptions = {
    "حذر": "يفضّل خطوات صغيرة واختبار الفكرة قبل التزام أكبر.",
    "متوازن": "يوازن بين فرصة التقدم والتكلفة المحتملة للمخاطرة.",
    "جريء": "يفضّل استكشاف خيارات أكبر مع إبقاء المخاطر واضحة."
  };
  $("riskLabel").textContent = risk;
  $("riskDescription").textContent = descriptions[risk] || descriptions["متوازن"];
  const positions = { "حذر": "0%", "متوازن": "50%", "جريء": "100%" };
  $("riskMarker").style.right = positions[risk] || "50%";
}
function renderWeeklyActivity() {
  const container = $("weeklyActivity");
  const events = getEvents();
  const now = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(now.getDate() - i);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    const count = events.filter(event => {
      const at = new Date(event.at);
      return !Number.isNaN(at.getTime()) && at >= d && at < next;
    }).length;
    days.push({
      date: d,
      count,
      label: d.toLocaleDateString("ar-IQ", { weekday: "short" })
    });
  }
  const total = days.reduce((sum, day) => sum + day.count, 0);
  if (!total) {
    container.innerHTML = '<div class="chart-empty">لا يوجد نشاط مسجّل خلال الأيام السبعة الأخيرة. سيظهر الرسم تلقائيًا بعد إنشاء محاكاة أو إكمال مهمة أو جلسة تركيز.</div>';
    return;
  }
  const max = Math.max(...days.map(day => day.count));
  container.innerHTML = days.map(day => {
    const height = day.count === 0 ? 3 : Math.max(12, Math.round(day.count / max * 100));
    const tip = `${day.date.toLocaleDateString("ar-IQ", { day: "numeric", month: "short" })}: ${day.count} نشاط`;
    return `<div class="activity-day" title="${esc(tip)}">
      <span class="activity-count">${day.count || ""}</span>
      <i style="height:${height}%" aria-label="${esc(tip)}"></i>
      <span>${esc(day.label)}</span>
    </div>`;
  }).join("");
}
function renderSaved() {
  const all = saved();
  const list = showAllSaved ? all : all.slice(0, 4);
  $("savedList").innerHTML = list.length ? list.map((scenario, i) => {
    const originalIndex = all.indexOf(scenario);
    const date = scenario.createdAt ? new Date(scenario.createdAt) : null;
    const dateText = date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString("ar-IQ", { day: "numeric", month: "short" })
      : "تاريخ الإنشاء غير متوفر";
    return `<div class="saved-row">
      <span class="saved-dot"></span>
      <div class="saved-copy"><strong>${esc(scenario.decision)}</strong><small>${esc(scenario.horizon || "فترة غير محددة")} · ${esc(scenario.risk || "متوازن")} · ${esc(dateText)}</small></div>
      <button data-open-saved="${originalIndex}">فتح</button>
    </div>`;
  }).join("") : '<div class="empty-state">لا توجد سيناريوهات محفوظة حتى الآن. أنشئ محاكاة ثم احفظها لتظهر هنا.</div>';

  document.querySelectorAll("[data-open-saved]").forEach(button => {
    button.addEventListener("click", () => {
      const scenario = saved()[Number(button.dataset.openSaved)];
      if (scenario) {
        $("decision").value = scenario.decision || "";
        $("horizon").value = scenario.horizon || "سنة واحدة";
        $("priority").value = scenario.priority || "بناء مهارة ومشروع";
        $("riskSelect").value = scenario.risk || "متوازن";
        showPanel("simulate");
        renderResult(scenario);
      }
    });
  });
  $("viewAll").textContent = showAllSaved ? "عرض أقل ↑" : "عرض الكل ↗";
}
function updateStats() {
  const tasks = getTasks();
  const done = tasks.filter(task => task.done).length;
  const total = tasks.length;
  const count = saved().length;
  const lastSeven = eventsLastDays(7);
  const simulationsThisWeek = lastSeven.filter(event => event.type === "simulation_created").length;
  const percent = total ? Math.round(done / total * 100) : null;

  $("taskDoneCount").textContent = done;
  $("savedCount").textContent = count;
  $("weekSimulationCount").textContent = simulationsThisWeek;
  $("taskDoneRatio").textContent = percent === null ? "—" : `${percent}%`;
  $("taskProgressText").textContent = total ? `${done} من ${total}` : "لا توجد مهام";
  $("progressBar").style.width = `${percent === null ? 0 : percent}%`;
  $("taskDonut").style.setProperty("--task-progress", `${(percent || 0) * 3.6}deg`);
  $("activitySummary").textContent = total
    ? `أكملت ${done} من أصل ${total} مهمة أضفتها. هذه النسبة محسوبة من قائمتك الفعلية.`
    : "أضف مهامك أولًا لتظهر نسبة إنجاز حقيقية بدل نسبة افتراضية.";
  $("settingsTaskCount").textContent = `${done} مكتملة من ${total}`;
  $("settingStorageStatus").textContent = localStorageAvailable() ? "متاح ويعمل" : "غير متاح";
  const focus = getFocusStats();
  $("focusSessionsCount").textContent = `${focus.sessions || 0}`;
  const events = getEvents().slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  $("lastActivityText").textContent = events.length
    ? `${eventDescription(events[0])} · ${new Date(events[0].at).toLocaleString("ar-IQ", { dateStyle: "short", timeStyle: "short" })}`
    : "لم يُسجّل أي نشاط بعد";
  $("systemLastActivity").textContent = events.length
    ? new Date(events[0].at).toLocaleString("ar-IQ", { dateStyle: "short", timeStyle: "short" })
    : "لا يوجد سجل بعد";
  $("systemSavedCount").textContent = String(count);
  $("systemSimulationCount").textContent = String(getEvents().filter(event => event.type === "simulation_created").length);
  renderSaved();
  renderTasks();
  renderWeeklyActivity();
}
function renderTasks() {
  const tasks = getTasks();
  const container = $("taskList");
  if (!tasks.length) {
    container.innerHTML = '<div class="task-empty">لا توجد مهام بعد. أضف أول خطوة تريد تنفيذها.</div>';
    return;
  }
  container.innerHTML = tasks.slice().reverse().map(task => `
    <label class="task" data-task-row="${esc(task.id)}">
      <input type="checkbox" data-task-toggle="${esc(task.id)}" ${task.done ? "checked" : ""}>
      <span>${esc(task.title)}</span>
      <small>${task.done ? "مكتمل" : "قيد التنفيذ"}</small>
      <button type="button" class="delete-task" data-task-delete="${esc(task.id)}" aria-label="حذف المهمة">×</button>
    </label>`).join("");
}
function showPanel(id) {
  document.querySelectorAll(".sim-panel").forEach(element => element.classList.add("hidden"));
  const element = $(id);
  if (element) {
    element.classList.remove("hidden");
    element.scrollIntoView({ behavior: loadPrefs().reduceMotion ? "auto" : "smooth", block: "start" });
  }
}
function createScenario(decision, horizon, priority, risk) {
  const coding = /برمج|تطبيق|كود|تقني|program|coding|app/i.test(decision);
  const focus = coding ? "المهارة التقنية" : "القرار";
  const paths = [
    { title:"التجربة التدريجية", tag:"مخاطرة محدودة", assumption:"يمكن تجربة خطوة صغيرة وقياس ما يحدث قبل التزام أكبر.", gain:["جمع معلومات من تجربة واقعية","إمكانية التراجع بتكلفة أقل"], cost:["قد يكون التقدم أبطأ","تحتاج التجربة إلى معيار واضح"], risk:["قد لا تكفي التجربة الصغيرة للحكم على النتيجة"], first:"ابدأ بتجربة محدودة خلال أسبوعين، ثم دوّن ما تعلمته." },
    { title:"الالتزام المنظّم", tag:"توازن بين التقدم والحذر", assumption:"يمكن تخصيص وقت منتظم ومراجعة الخطة كل فترة.", gain:[`بناء خبرة متراكمة في ${focus}`,"تحويل الهدف إلى خطوات قابلة للقياس"], cost:["يحتاج إلى وقت وجهد ثابتين","قد يتطلب تقليل بعض الأنشطة"], risk:["قد تصبح الخطة مرهقة إذا كانت أكبر من مواردك"], first:"ضع جدولًا أسبوعيًا واقعيًا ومخرجًا واضحًا لكل شهر." },
    { title:"التغيير المكثّف", tag:"مخاطرة أعلى", assumption:"تتوفر موارد كافية وخطة بديلة إذا لم تتحقق التوقعات.", gain:["وقت أكبر للتركيز على الهدف","اكتشاف سريع لما تحتاج إلى تعلمه"], cost:["تكلفة فرصة أعلى","مرونة أقل تجاه الالتزامات الأخرى"], risk:["قد تتراكم الخسائر أو الإرهاق إذا أخفقت الافتراضات"], first:"حدد سقفًا للوقت والمال ونقطة واضحة لإعادة تقييم القرار." }
  ];
  if (risk === "حذر") { paths[0].tag = "الأقرب لأسلوبك"; paths[2].tag = "يحتاج احتياطات إضافية"; }
  else if (risk === "جريء") { paths[2].tag = "الأقرب لأسلوبك"; paths[0].tag = "أبطأ والتزامه أقل"; }
  else { paths[1].tag = "الأقرب لأسلوبك"; }
  if (priority.includes("الاستقرار")) {
    paths[0].gain.unshift("حماية قدر أكبر من الاستقرار الحالي");
    paths[2].cost.unshift("قد يؤثر في الاستقرار على المدى القصير");
  } else if (priority.includes("مهارة") || priority.includes("مشروع")) {
    paths[1].gain.unshift("إنشاء دليل عملي على تطور مهارتك");
    paths[1].first = "اختر مهارة أساسية وابنِ بها نموذجًا صغيرًا يمكن تجربته.";
  } else if (priority.includes("الإبداع")) {
    paths[1].gain.unshift("مساحة منتظمة للتجريب وتطوير أسلوبك");
  }
  return { decision, horizon, priority, risk, createdAt:new Date().toISOString(), paths };
}
function renderResult(scenario) {
  currentScenario = scenario;
  $("results").classList.remove("hidden");
  const prefs = loadPrefs();
  const warning = prefs.transparency === false ? "" :
    '<div class="result-warning"><b>شفافية المحاكاة:</b> هذه سيناريوهات افتراضية وليست توقعات مؤكدة. لا تُعرض نسب نجاح مختلقة.</div>';
  const treeMarkup = `
    <section class="decision-tree" aria-label="شجرة القرار المتفرعة">
      <div class="tree-heading">
        <div><span class="tree-eyebrow">DECISION MAP · خريطة القرار</span><h3>إذا اخترت هذا المسار… ماذا قد يحدث؟</h3>
        <p>استكشف الفوائد المحتملة، والأضرار أو التكاليف، وعلامات الخطر، وخطوة الحد من الضرر. هذه احتمالات نوعية وليست تنبؤات مؤكدة.</p></div>
        <span class="tree-symbol" aria-hidden="true">✳</span>
      </div>
      <div class="tree-root"><small>نقطة البداية</small><strong>${esc(scenario.decision)}</strong><span>${esc(scenario.horizon)} · أولوية: ${esc(scenario.priority)}</span></div>
      <div class="tree-trunk" aria-hidden="true"></div>
      <div class="tree-branches">
        ${scenario.paths.map((path, i) => {
          const branchDetails = [
            { outcome: "تعلّم تدريجي مع التزام أقل", benefit: path.gain[0] || "تعلّم من التجربة", harm: path.cost[0] || "تقدّم أبطأ", signal: "تكرار التأجيل أو عدم ظهور دليل ملموس على التقدم", mitigation: "ضع مدة محددة للتجربة ومقياسًا بسيطًا للمراجعة." },
            { outcome: "تقدم منتظم مقابل وقت وجهد ثابتين", benefit: path.gain[0] || "تراكم الخبرة", harm: path.cost[0] || "الحاجة إلى الاستمرارية", signal: "تراجع الالتزام أو تضخم المهام مقارنة بالوقت المتاح", mitigation: "راجع الخطة أسبوعيًا وصغّر الخطوات عندما تصبح مرهقة." },
            { outcome: "تقدم مكثف مع تكلفة فرصة أكبر", benefit: path.gain[0] || "تركيز أكبر على الهدف", harm: path.cost[0] || "التزام أعلى", signal: "استنزاف الوقت أو المال أو إهمال التزامات أساسية", mitigation: "حدّد سقفًا للخسارة ونقطة توقف وخطة بديلة قبل البدء." }
          ][i];
          return `<article class="tree-branch branch-${i+1}">
            <div class="branch-connector" aria-hidden="true"></div>
            <button type="button" class="branch-node" data-tree-toggle="${i}" aria-expanded="${i === 1 ? "true" : "false"}">
              <span class="branch-letter">${["A","B","C"][i]}</span>
              <span class="branch-node-copy"><small>${esc(path.tag)}</small><strong>${esc(path.title)}</strong><em>${esc(branchDetails.outcome)}</em></span>
              <span class="branch-chevron" aria-hidden="true">${i === 1 ? "−" : "+"}</span>
            </button>
            <div class="branch-detail ${i === 1 ? "" : "hidden"}" data-tree-detail="${i}">
              <div class="branch-fact benefit"><span>↗ فائدة محتملة</span><p>${esc(branchDetails.benefit)}</p></div>
              <div class="branch-fact cost"><span>↘ ضرر / تكلفة محتملة</span><p>${esc(branchDetails.harm)}</p></div>
              <div class="branch-fact signal"><span>⚑ علامة تستحق الانتباه</span><p>${esc(branchDetails.signal)}</p></div>
              <div class="branch-fact safeguard"><span>◇ كيف تقلّل الضرر؟</span><p>${esc(branchDetails.mitigation)}</p></div>
              <div class="branch-next"><b>الخطوة الأولى</b><p>${esc(path.first)}</p></div>
            </div>
          </article>`;
        }).join("")}
      </div>
      <div class="tree-checkpoint"><span>◎</span><div><strong>نقطة مراجعة مشتركة</strong><p>بعد أول مرحلة من التنفيذ، قارن ما حدث فعليًا بافتراضاتك. استمر أو عدّل المسار أو توقف بناءً على أدلة واقعية، لا على التفاؤل وحده.</p></div></div>
    </section>`;
  $("results").innerHTML = `${warning}<p style="font-size:12px;color:#aab8d4">القرار: <b>${esc(scenario.decision)}</b> · الفترة: ${esc(scenario.horizon)}</p>` +
    treeMarkup +
    scenario.paths.map((path, i) => `<article class="result-card">
      <h4>${["A","B","C"][i]} · ${esc(path.title)} <small style="color:#8998b8">— ${esc(path.tag)}</small></h4>
      <p><b>الافتراض:</b> ${esc(path.assumption)}</p>
      <p><b>المكاسب المحتملة</b></p><ul>${path.gain.map(item => `<li>${esc(item)}</li>`).join("")}</ul>
      <p><b>التكاليف</b></p><ul>${path.cost.map(item => `<li>${esc(item)}</li>`).join("")}</ul>
      <p><b>المخاطر</b></p><ul>${path.risk.map(item => `<li>${esc(item)}</li>`).join("")}</ul>
      <p><b>خطوة أولى:</b> ${esc(path.first)}</p>
    </article>`).join("") + '<button class="main-btn" id="saveScenario">＋ حفظ السيناريو</button>';
  $("saveScenario").addEventListener("click", () => {
    const items = saved();
    if (items.some(item => item.decision === scenario.decision && item.horizon === scenario.horizon && item.priority === scenario.priority && item.risk === scenario.risk)) {
      toast("هذا السيناريو محفوظ مسبقًا.");
      return;
    }
    items.unshift(scenario);
    if (writeJSON(SAVED_KEY, items)) {
      logEvent("scenario_saved", scenario.decision);
      updateStats();
      toast("تم حفظ السيناريو على هذا الجهاز.");
    }
  });
}
function addTask() {
  const title = prompt("اكتب الخطوة التي تريد تنفيذها:");
  if (!title || !title.trim()) return;
  const task = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim(),
    done: false,
    createdAt: new Date().toISOString()
  };
  const tasks = getTasks();
  tasks.push(task);
  if (writeJSON(TASKS_KEY, tasks)) {
    logEvent("task_added", task.title);
    updateStats();
    toast("أُضيفت المهمة وحُفظت على هذا الجهاز.");
  }
}
function toggleTask(id, done) {
  const tasks = getTasks();
  const task = tasks.find(item => String(item.id) === String(id));
  if (!task) return;
  task.done = done;
  if (done) {
    task.completedAt = new Date().toISOString();
    logEvent("task_completed", task.title);
  } else {
    delete task.completedAt;
  }
  writeJSON(TASKS_KEY, tasks);
  updateStats();
}
function deleteTask(id) {
  const tasks = getTasks();
  const next = tasks.filter(task => String(task.id) !== String(id));
  if (next.length !== tasks.length) {
    writeJSON(TASKS_KEY, next);
    toast("تم حذف المهمة.");
    updateStats();
  }
}
function timerDisplay(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  $("timer").textContent = `${String(minutes).padStart(2,"0")}:${String(remaining).padStart(2,"0")}`;
}
function finishFocusSession() {
  clearInterval(timerInterval);
  timerRunning = false;
  const duration = Number(loadPrefs().timer || 25);
  const stats = getFocusStats();
  stats.sessions = (stats.sessions || 0) + 1;
  stats.totalMinutes = (stats.totalMinutes || 0) + duration;
  writeJSON(FOCUS_KEY, stats);
  logEvent("focus_completed", `${duration} دقيقة`);
  $("timerBtn").innerHTML = "<span>▶</span> ابدأ جلسة جديدة";
  toast(`اكتملت جلسة التركيز (${duration} دقيقة).`);
  timerSeconds = duration * 60;
  timerDisplay(timerSeconds);
  updateStats();
}
function setTimerButton() {
  $("timerBtn").innerHTML = timerRunning ? "<span>Ⅱ</span> إيقاف مؤقت" : "<span>▶</span> ابدأ الجلسة";
}
function startOrPauseTimer() {
  if (timerRunning) {
    clearInterval(timerInterval);
    timerRunning = false;
    setTimerButton();
    return;
  }
  if (timerSeconds <= 0) timerSeconds = Number(loadPrefs().timer || 25) * 60;
  timerRunning = true;
  setTimerButton();
  timerInterval = setInterval(() => {
    timerSeconds = Math.max(0, timerSeconds - 1);
    timerDisplay(timerSeconds);
    if (timerSeconds === 0) finishFocusSession();
  }, 1000);
}
function loadPrefs() {
  return readJSON(PREFS_KEY, {});
}
function applyPrefs(prefs) {
  const dark = prefs.dark !== false;
  document.documentElement.classList.toggle("light", !dark);
  document.documentElement.classList.toggle("reduce-motion", !!prefs.reduceMotion);
  document.documentElement.classList.toggle("large-font", !!prefs.largeFont);
  document.documentElement.classList.toggle("compact-layout", prefs.comfort === false);
  document.documentElement.dir = prefs.rtl === false ? "ltr" : "rtl";
  document.body.classList.add("no-copy");

  $("settingDark").checked = dark;
  $("settingMotion").checked = !!prefs.reduceMotion;
  $("settingFont").checked = !!prefs.largeFont;
  $("settingComfort").checked = prefs.comfort !== false;
  $("settingRTL").checked = prefs.rtl !== false;
  $("settingTransparency").checked = prefs.transparency !== false;
  $("settingRisk").value = prefs.risk || "متوازن";
  $("settingTimer").value = String(prefs.timer || 25);
  $("riskSelect").value = prefs.risk || "متوازن";
  updateRiskDescription(prefs.risk || "متوازن");

  if (!timerRunning) {
    timerSeconds = Number(prefs.timer || 25) * 60;
    timerDisplay(timerSeconds);
  }
}
function savePrefs() {
  const prefs = {
    dark: $("settingDark").checked,
    reduceMotion: $("settingMotion").checked,
    largeFont: $("settingFont").checked,
    comfort: $("settingComfort").checked,
    rtl: $("settingRTL").checked,
    transparency: $("settingTransparency").checked,
    risk: $("settingRisk").value,
    timer: Number($("settingTimer").value)
  };
  if (writeJSON(PREFS_KEY, prefs)) {
    applyPrefs(prefs);
    toast("تم تطبيق إعداداتك على الواجهة.");
  }
}

document.querySelectorAll("[data-open]").forEach(button => {
  button.addEventListener("click", () => {
    const id = button.dataset.open;
    if (id === "compare") {
      if (!currentScenario) {
        showPanel("simulate");
        toast("أنشئ محاكاة أولًا لتظهر المسارات للمقارنة.");
      } else {
        showPanel("simulate");
        $("results").scrollIntoView({ behavior: loadPrefs().reduceMotion ? "auto" : "smooth", block: "start" });
      }
      return;
    }
    showPanel(id);
    if (id === "simulate") $("decision").focus();
  });
});
document.querySelectorAll("[data-target]").forEach(button => {
  button.addEventListener("click", () => {
    const target = button.dataset.target;
    document.querySelectorAll(".nav").forEach(nav => nav.classList.toggle("active", nav === button));
    const element = $(target);
    if (element) {
      element.scrollIntoView({ behavior: loadPrefs().reduceMotion ? "auto" : "smooth", block: "start" });
      if (target === "saved") updateStats();
    }
  });
});
$("simulateBtn").addEventListener("click", () => {
  const decision = $("decision").value.trim();
  if (decision.length < 5) {
    toast("اكتب وصفًا واضحًا للقرار أولًا.");
    $("decision").focus();
    return;
  }
  const scenario = createScenario(decision, $("horizon").value, $("priority").value, $("riskSelect").value);
  logEvent("simulation_created", decision);
  renderResult(scenario);
  updateStats();
  $("results").scrollIntoView({ behavior: loadPrefs().reduceMotion ? "auto" : "smooth", block: "start" });
});
$("results").addEventListener("click", event => {
  const toggle = event.target.closest("[data-tree-toggle]");
  if (!toggle) return;
  const index = toggle.dataset.treeToggle;
  const detail = $("results").querySelector(`[data-tree-detail="${index}"]`);
  if (!detail) return;
  const expanded = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!expanded));
  detail.classList.toggle("hidden", expanded);
  const chevron = toggle.querySelector(".branch-chevron");
  if (chevron) chevron.textContent = expanded ? "+" : "−";
});
$("closeSim").addEventListener("click", () => $("simulate").classList.add("hidden"));
$("viewAll").addEventListener("click", () => {
  showAllSaved = !showAllSaved;
  updateStats();
});
$("mobileSaved").addEventListener("click", () => $("saved").scrollIntoView({ behavior: "smooth", block: "start" }));
$("riskSelect").addEventListener("change", event => {
  $("settingRisk").value = event.target.value;
  savePrefs();
});
$("themeBtn")?.addEventListener("click", () => {
  $("settingDark").checked = !$("settingDark").checked;
  savePrefs();
});
$("addTask").addEventListener("click", addTask);
$("timerBtn").addEventListener("click", startOrPauseTimer);
$("taskList").addEventListener("change", event => {
  if (event.target.matches("[data-task-toggle]")) {
    toggleTask(event.target.dataset.taskToggle, event.target.checked);
  }
});
$("taskList").addEventListener("click", event => {
  const button = event.target.closest("[data-task-delete]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  deleteTask(button.dataset.taskDelete);
});
[
  "settingDark", "settingMotion", "settingFont", "settingComfort",
  "settingRTL", "settingTransparency", "settingRisk", "settingTimer"
].forEach(id => $(id).addEventListener("change", () => {
  if (id === "settingRisk") $("riskSelect").value = $("settingRisk").value;
  savePrefs();
}));

$("welcomeStart").addEventListener("click", () => {
  try { localStorage.setItem("whatif_welcome_seen_v1", "yes"); } catch {}
  $("onboarding").classList.add("hidden");
  toast("أهلًا بك! ابدأ بإنشاء أول محاكاة.");
});
$("clearSaved").addEventListener("click", () => {
  if (!confirm("هل تريد حذف جميع السيناريوهات المحفوظة من هذا الجهاز؟ لا يمكن التراجع عن هذا الإجراء.")) return;
  if (writeJSON(SAVED_KEY, [])) {
    // Keep the activity history: deleting an item should not erase the audit trail.
    logEvent("saved_scenarios_cleared", "حُذفت جميع السيناريوهات المحفوظة");
    updateStats();
    toast("تم حذف السيناريوهات المحفوظة.");
  }
});

// Best-effort UI-level copy deterrent. Inputs remain selectable/editable.
// Screenshots and system-level extraction cannot be blocked reliably by a web interface.
document.addEventListener("contextmenu", event => {
  if (!event.target.closest("input,textarea,select,button,a")) event.preventDefault();
});
["copy", "cut", "selectstart", "dragstart"].forEach(type => {
  document.addEventListener(type, event => {
    if (!event.target.closest("input,textarea,select")) event.preventDefault();
  });
});
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && ["c","x","a","s","u"].includes(event.key.toLowerCase()) &&
      !event.target.closest("input,textarea,select")) event.preventDefault();
});

dateTime();
setInterval(dateTime, 30000);
applyPrefs(loadPrefs());
try {
  if (localStorage.getItem("whatif_welcome_seen_v1") === "yes") $("onboarding").classList.add("hidden");
} catch {}
updateStats();
