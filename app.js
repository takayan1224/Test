// --- Utilities ---
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fromISO = (s) => {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
};
const dayJP = ["日","月","火","水","木","金","土"];
const isSameDate = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();

// --- Storage keys ---
const KEY_SETTINGS = "srd_settings_v1";
const KEY_LOG = "srd_log_v1";

// --- Default settings: based on your plan (2026) ---
const defaultSettings = {
  startDate: "2026-02-02",
  testDate: "2026-02-26",
  boostDays: 7, // 1週間前から増量
  subjects: { A: "教科A", B: "教科B", C: "教科C", D: "教科D" },

  // Hours (you asked: weekday 3h until 21:30; juku Tue/Thu shorter)
  weekdayHours: 3.0,      // Mon/Wed/Fri
  jukuHours: 2.0,         // Tue/Thu (before juku)
  weekendHours: 4.0,      // Sat/Sun

  // Boost week (increase)
  boostWeekdayHours: 3.5, // non-juku weekdays in last week
  boostWeekendHours: 5.5  // weekend in last week
};

// Load/save
function loadSettings() {
  try {
    return { ...defaultSettings, ...(JSON.parse(localStorage.getItem(KEY_SETTINGS)) || {}) };
  } catch {
    return { ...defaultSettings };
  }
}
function saveSettings(s) {
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
}

function loadLog() {
  try {
    return JSON.parse(localStorage.getItem(KEY_LOG)) || {};
  } catch {
    return {};
  }
}
function saveLog(log) {
  localStorage.setItem(KEY_LOG, JSON.stringify(log));
}

// log entry: { status: "done"|"fail", ts: number }
function setTodayStatus(status) {
  const log = loadLog();
  const todayISO = toISO(new Date());
  log[todayISO] = { status, ts: Date.now() };
  saveLog(log);
  return log[todayISO];
}

// --- Plan generator (simple but practical) ---
// We generate today's "recommended distribution" with editable subjects.
// Rule:
//  - rotate focus A/B/C, add D as light if needed
//  - juku days: 2 subjects equally
//  - normal weekdays: 2 subjects 1.5/1.5 for 3h (or if 3.5 then 2.0/1.5)
//  - weekends: 2 or 3 subjects
function isBoostPeriod(date, settings) {
  const test = fromISO(settings.testDate);
  const diffDays = Math.ceil((test - date) / (1000*60*60*24));
  return diffDays <= settings.boostDays && diffDays >= 1; // up to day before test
}

function hoursForDate(date, settings) {
  const dow = date.getDay();
  const boost = isBoostPeriod(date, settings);
  const isWeekend = (dow === 0 || dow === 6);
  const isJuku = (dow === 2 || dow === 4); // Tue/Thu

  if (isWeekend) return boost ? settings.boostWeekendHours : settings.weekendHours;
  if (isJuku) return settings.jukuHours;
  return boost ? settings.boostWeekdayHours : settings.weekdayHours;
}

// Focus rotation by day index from startDate
function focusOrder(date, settings) {
  const start = fromISO(settings.startDate);
  const idx = Math.floor((date - start) / (1000*60*60*24));
  const cycle = ["A","B","C","A","B","C","A"]; // simple
  const main = cycle[((idx % cycle.length)+cycle.length)%cycle.length];
  // secondary: next in cycle
  const sec = cycle[(((idx+1) % cycle.length)+cycle.length)%cycle.length];
  return [main, sec];
}

function distribution(date, settings) {
  const h = hoursForDate(date, settings);
  const dow = date.getDay();
  const boost = isBoostPeriod(date, settings);
  const isWeekend = (dow === 0 || dow === 6);
  const isJuku = (dow === 2 || dow === 4);

  const [m, s] = focusOrder(date, settings);

  // Returns array like [{key:"A", name:"数学", hours:1.5}, ...]
  let plan = [];

  if (isJuku) {
    // 2.0h = 1.0 + 1.0
    plan = [
      { key: m, hours: +(h/2).toFixed(1) },
      { key: s, hours: +(h/2).toFixed(1) }
    ];
  } else if (!isWeekend) {
    // Weekday: 3.0 => 1.5/1.5, 3.5 => 2.0/1.5
    if (h === 3.0) {
      plan = [
        { key: m, hours: 1.5 },
        { key: s, hours: 1.5 }
      ];
    } else {
      plan = [
        { key: m, hours: 2.0 },
        { key: s, hours: +(h - 2.0).toFixed(1) }
      ];
    }
  } else {
    // Weekend: 4.0 => 2.0/2.0, 5.5 => 2.0/2.0/1.5
    if (h <= 4.0) {
      plan = [
        { key: m, hours: +(h/2).toFixed(1) },
        { key: s, hours: +(h/2).toFixed(1) }
      ];
    } else {
      // add third subject lightly (D if exists, else rotate)
      const third = "D";
      plan = [
        { key: m, hours: 2.0 },
        { key: s, hours: 2.0 },
        { key: third, hours: +(h - 4.0).toFixed(1) }
      ];
    }
  }

  // Map subject names
  return plan.map(p => ({
    ...p,
    name: settings.subjects[p.key] || `教科${p.key}`
  }));
}

function timeTableText(date, settings) {
  const dow = date.getDay();
  const isWeekend = (dow === 0 || dow === 6);
  const isJuku = (dow === 2 || dow === 4);
  const boost = isBoostPeriod(date, settings);

  if (isWeekend) {
    // simple blocks
    if (boost) return "10:00-12:00 / 15:00-17:00 / 19:30-21:00";
    return "10:00-12:00 / 15:00-17:00";
  }
  if (isJuku) {
    return "17:30-19:30（塾20:00-22:00）";
  }
  // normal weekday: must end 21:30 (your request)
  // boost weekday ends 21:45 in old plan; but user asked weekday end 21:30, so keep 21:30 even in boost.
  // We increase by density (集中) rather than end time: keep same end time but higher質.
  // Here we keep the time blocks same; total hours increase by tightening breaks.
  return boost
    ? "17:30-18:50 / 19:10-20:20 / 20:40-21:30（休憩短め）"
    : "17:30-18:45 / 19:15-20:00 / 20:30-21:30";
}

// --- UI render ---
const elTodayText = document.getElementById("todayText");
const elPlanBox = document.getElementById("planBox");
const elFeedback = document.getElementById("feedback");
const elHistoryList = document.getElementById("historyList");
const elHistoryCal = document.getElementById("historyCalendar");
const elStats = document.getElementById("stats");

const tabList = document.getElementById("tabList");
const tabCalendar = document.getElementById("tabCalendar");

const settingsDialog = document.getElementById("settingsDialog");
const openSettingsBtn = document.getElementById("openSettings");
const saveSettingsBtn = document.getElementById("saveSettings");

const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");
const resetBtn = document.getElementById("resetBtn");

// Settings inputs
const startDateI = document.getElementById("startDate");
const testDateI = document.getElementById("testDate");
const boostDaysI = document.getElementById("boostDays");
const subjAI = document.getElementById("subjA");
const subjBI = document.getElementById("subjB");
const subjCI = document.getElementById("subjC");
const subjDI = document.getElementById("subjD");
const weekdayHoursI = document.getElementById("weekdayHours");
const jukuHoursI = document.getElementById("jukuHours");
const weekendHoursI = document.getElementById("weekendHours");
const boostWeekdayHoursI = document.getElementById("boostWeekdayHours");
const boostWeekendHoursI = document.getElementById("boostWeekendHours");

function render() {
  const settings = loadSettings();
  const log = loadLog();
  const today = new Date();
  const todayISO = toISO(today);
  const dText = `${todayISO}（${dayJP[today.getDay()]}）`;
  elTodayText.textContent = dText;

  // Today plan
  const h = hoursForDate(today, settings);
  const dist = distribution(today, settings);
  const tt = timeTableText(today, settings);

  const status = log[todayISO]?.status || "none";
  const badge = status === "done" ? "✅ クリア済" : status === "fail" ? "❌ 未達" : "— 未記録";

  elPlanBox.innerHTML = `
    <div class="title">今日のルーティーン</div>
    <div class="meta">合計：<b>${h.toFixed(1)}h</b> / 時程：${tt} / 状態：${badge}</div>
    <ul>
      ${dist.map(x => `<li>${x.name}：${x.hours.toFixed(1)}h（内容は自由に書き換えOK）</li>`).join("")}
    </ul>
  `;

  // Feedback
  if (status === "done") {
    elFeedback.textContent = "いいね。今日の分はクリア！";
  } else if (status === "fail") {
    elFeedback.textContent = "がんばれ。次は1コマだけでもOK。";
  } else {
    elFeedback.textContent = "";
  }

  // Stats + History
  renderStatsAndHistory(settings, log);
}

function renderStatsAndHistory(settings, log) {
  const start = fromISO(settings.startDate);
  const test = fromISO(settings.testDate);
  const end = new Date(test.getFullYear(), test.getMonth(), test.getDate() - 1); // day before test

  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    days.push(new Date(d));
  }

  let done = 0, fail = 0, none = 0;
  for (const d of days) {
    const iso = toISO(d);
    const s = log[iso]?.status || "none";
    if (s === "done") done++;
    else if (s === "fail") fail++;
    else none++;
  }

  const today = new Date();
  const total = days.length;
  const passed = days.filter(d => d < new Date(today.getFullYear(), today.getMonth(), today.getDate())).length;
  const remaining = total - passed;

  elStats.innerHTML = `
    <div>記録期間：${settings.startDate} 〜 ${toISO(end)}（全${total}日）</div>
    <div>達成：${done}日 / 未達：${fail}日 / 未記録：${none}日</div>
    <div>残り：${remaining}日（テスト：${settings.testDate}）</div>
  `;

  // List view
  elHistoryList.innerHTML = days.slice().reverse().map(d => {
    const iso = toISO(d);
    const dow = dayJP[d.getDay()];
    const h = hoursForDate(d, settings);
    const dist = distribution(d, settings);
    const s = log[iso]?.status || "none";
    const badgeClass = s === "done" ? "ok" : s === "fail" ? "ng" : "none";
    const badgeText = s === "done" ? "クリア" : s === "fail" ? "未達" : "未記録";
    return `
      <div class="item">
        <div>
          <div><b>${iso}（${dow}）</b> 合計 ${h.toFixed(1)}h</div>
          <div class="label">${dist.map(x => `${x.name}:${x.hours.toFixed(1)}h`).join(" / ")}</div>
        </div>
        <div class="badge ${badgeClass}">${badgeText}</div>
      </div>
    `;
  }).join("");

  // Calendar view (month of today)
  renderCalendar(settings, log);
}

function renderCalendar(settings, log) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m+1, 0);
  const startDow = first.getDay();
  const totalDays = last.getDate();

  // build cells (include leading blanks)
  const cells = [];
  for (let i=0; i<startDow; i++) cells.push(null);
  for (let d=1; d<=totalDays; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  elHistoryCal.innerHTML = `
    <div class="calHead">
      <div><b>${y}年${m+1}月</b></div>
      <div class="label">●=クリア / ●=未達 / ●=未記録</div>
    </div>
    <div class="grid">
      ${["日","月","火","水","木","金","土"].map(w => `<div class="cell" style="background:rgba(255,255,255,0.03)"><b>${w}</b></div>`).join("")}
      ${cells.map(d => {
        if (!d) return `<div class="cell"></div>`;
        const iso = toISO(d);
        const s = log[iso]?.status || "none";
        const dotClass = s === "done" ? "ok" : s === "fail" ? "ng" : "none";
        const isToday = isSameDate(d, new Date());
        return `
          <div class="cell" style="${isToday ? "outline:2px solid rgba(255,200,87,0.55);" : ""}">
            <div class="d">${d.getDate()}</div>
            <div class="dot ${dotClass}"></div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// --- Buttons ---
document.getElementById("btnDone").addEventListener("click", () => {
  setTodayStatus("done");
  render();
});
document.getElementById("btnFail").addEventListener("click", () => {
  setTodayStatus("fail");
  render();
});

// Tabs
tabList.addEventListener("click", () => {
  tabList.classList.add("btn-active");
  tabCalendar.classList.remove("btn-active");
  document.getElementById("historyList").classList.remove("hidden");
  document.getElementById("historyCalendar").classList.add("hidden");
});
tabCalendar.addEventListener("click", () => {
  tabCalendar.classList.add("btn-active");
  tabList.classList.remove("btn-active");
  document.getElementById("historyCalendar").classList.remove("hidden");
  document.getElementById("historyList").classList.add("hidden");
});

// Settings open/save
openSettingsBtn.addEventListener("click", () => {
  const s = loadSettings();
  startDateI.value = s.startDate;
  testDateI.value = s.testDate;
  boostDaysI.value = s.boostDays;

  subjAI.value = s.subjects.A || "";
  subjBI.value = s.subjects.B || "";
  subjCI.value = s.subjects.C || "";
  subjDI.value = s.subjects.D || "";

  weekdayHoursI.value = s.weekdayHours;
  jukuHoursI.value = s.jukuHours;
  weekendHoursI.value = s.weekendHours;
  boostWeekdayHoursI.value = s.boostWeekdayHours;
  boostWeekendHoursI.value = s.boostWeekendHours;

  settingsDialog.showModal();
});

saveSettingsBtn.addEventListener("click", () => {
  const s = loadSettings();
  s.startDate = startDateI.value || s.startDate;
  s.testDate = testDateI.value || s.testDate;
  s.boostDays = Number(boostDaysI.value || s.boostDays);

  s.subjects = {
    A: subjAI.value || "教科A",
    B: subjBI.value || "教科B",
    C: subjCI.value || "教科C",
    D: subjDI.value || "教科D"
  };

  s.weekdayHours = Number(weekdayHoursI.value || s.weekdayHours);
  s.jukuHours = Number(jukuHoursI.value || s.jukuHours);
  s.weekendHours = Number(weekendHoursI.value || s.weekendHours);
  s.boostWeekdayHours = Number(boostWeekdayHoursI.value || s.boostWeekdayHours);
  s.boostWeekendHours = Number(boostWeekendHoursI.value || s.boostWeekendHours);

  saveSettings(s);
  render();
});

// Export / Import / Reset
exportBtn.addEventListener("click", () => {
  const data = {
    settings: loadSettings(),
    log: loadLog()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "study-routine-diary-backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (data.settings) saveSettings(data.settings);
    if (data.log) saveLog(data.log);
    render();
    alert("インポートしました。");
  } catch {
    alert("読み込みに失敗しました（JSON形式を確認してください）。");
  } finally {
    importFile.value = "";
  }
});

resetBtn.addEventListener("click", () => {
  if (!confirm("設定と記録をすべて消去します。よろしいですか？")) return;
  localStorage.removeItem(KEY_SETTINGS);
  localStorage.removeItem(KEY_LOG);
  render();
});

// PWA service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

// Initial render
render();