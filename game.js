/*
 * 虛詞偵探社：遊戲程式
 * 純前端，不連網、不收集資料；進度存在瀏覽器的 localStorage。
 * 網址加 ?teacher=1 進入教師模式（全部關卡開放，並顯示答案）。
 */
(function () {
  "use strict";

  const ROOMS = window.ROOMS || [];
  const CASES = window.CASES || [];
  const POSITIONS = window.POSITIONS || {};
  const STORE_KEY = "xuci-detective-v1";
  const TEACHER = new URLSearchParams(location.search).get("teacher") === "1";
  const FIVE = ["乃", "莫", "因", "為", "焉"];
  const LEVEL_NAMES = ["第一層", "第二層", "第三層"];
  // 三枚徽章：［章上的字、名稱、取得條件］
  const BADGES = [
    ["查", "查證章", "位置和線索一次答對"],
    ["結", "結案章", "選對意思"],
    ["神", "神探章", "全程一次答對，沒有用提示"]
  ];

  // 代入語譯時，選項文字與實際放進句子的字眼不同的情況
  const GLOBAL_SUBS = {
    "怎麼／哪裏": "怎麼",
    "之（它）": "它",
    "停頓（不用譯）": "",
    "了（或不譯）": "了",
    "作為（動詞）": "作為",
    "對、向": "對",
    "依靠、憑借": "依靠",
    "於是、就": "於是",
    "趁着、乘此": "趁着"
  };

  const app = document.getElementById("app");
  const live = document.getElementById("live");
  const idChip = document.getElementById("id-chip");

  /* ---------- 進度儲存 ---------- */
  function freshStore() { return { name: "", font: 0, cases: {} }; }
  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && typeof s === "object" && s.cases) return s;
    } catch (e) { /* 讀取失敗就重新開始 */ }
    return freshStore();
  }
  let store = loadStore();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 私密瀏覽等情況無法儲存 */ }
  }
  function rec(id) { return store.cases[id] || null; }
  // 每宗案件取得過的徽章（舊紀錄只有星數時，按數目推算）
  function badgesOf(id) {
    const r = rec(id);
    if (!r) return [false, false, false];
    if (Array.isArray(r.badges)) return r.badges;
    const n = r.stars || 0;
    return [n > 0, n > 1, n > 2];
  }
  function badgeCount(id) { return badgesOf(id).filter(Boolean).length; }

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  const PUNCT = /[，。、；：？！「」『』（）《》〈〉·…—]/;

  // 把句子標記拆成逐字的資料：type 為 plain／target／clue
  function parseSentence(s) {
    const out = [];
    let mode = "plain", group = -1, g = 0;
    for (const ch of s) {
      if (ch === "【") { mode = "target"; continue; }
      if (ch === "】") { mode = "plain"; continue; }
      if (ch === "〔") { mode = "clue"; group = g++; continue; }
      if (ch === "〕") { mode = "plain"; continue; }
      out.push({ ch: ch, type: mode, group: mode === "clue" ? group : -1 });
    }
    return out;
  }
  function plainHtml(s) {
    return parseSentence(s).map(function (t) {
      return t.type === "target" ? "<b>" + esc(t.ch) + "</b>" : esc(t.ch);
    }).join("");
  }
  function targetChar(c) {
    const t = parseSentence(c.sentence).find(function (x) { return x.type === "target"; });
    return t ? t.ch : "";
  }
  function subOf(c, label) {
    if (c.subs && Object.prototype.hasOwnProperty.call(c.subs, label)) return c.subs[label];
    if (Object.prototype.hasOwnProperty.call(GLOBAL_SUBS, label)) return GLOBAL_SUBS[label];
    return label.replace(/（.*?）/g, "").split(/[、／]/)[0];
  }
  // 把意思代入語譯，以 <mark> 標示
  function fillHtml(c, label) {
    if (c.type === "translate") return esc(label);
    const sub = subOf(c, label);
    return c.translation.split("{x}").map(esc).join("<mark>" + esc(sub) + "</mark>");
  }
  function fillText(c, label) {
    if (c.type === "translate") return label;
    return c.translation.split("{x}").join(subOf(c, label));
  }
  // 小徽章列（用於清單）
  function badgesHtml(arr) {
    const n = arr.filter(Boolean).length;
    return '<span class="badges" role="img" aria-label="徽章 ' + n + '／3">' + BADGES.map(function (b, i) {
      return '<span class="badge' + (arr[i] ? " on" : "") + '" aria-hidden="true">' + b[0] + "</span>";
    }).join("") + "</span>";
  }
  function announce(text) {
    live.textContent = "";
    setTimeout(function () { live.textContent = text; }, 30);
  }
  function go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  }
  function roomHref(id) { return "#/room/" + encodeURIComponent(id); }

  /* ---------- 案房與案件 ---------- */
  function room(id) { return ROOMS.find(function (r) { return r.id === id; }); }
  function casesOf(roomId) {
    // 基本案件在前，懸案在後
    const list = CASES.filter(function (c) { return c.room === roomId; });
    return list.filter(function (c) { return c.level !== "懸案"; })
      .concat(list.filter(function (c) { return c.level === "懸案"; }));
  }
  function caseById(id) { return CASES.find(function (c) { return c.id === id; }); }
  function roomStats(roomId) {
    const list = casesOf(roomId);
    const basic = list.filter(function (c) { return c.level !== "懸案"; });
    const hard = list.filter(function (c) { return c.level === "懸案"; });
    const done = function (c) { const r = rec(c.id); return !!(r && r.done); };
    let badges = 0;
    list.forEach(function (c) { badges += badgeCount(c.id); });
    return {
      basic: basic.length, basicDone: basic.filter(done).length,
      hard: hard.length, hardDone: hard.filter(done).length,
      badges: badges, maxBadges: list.length * 3
    };
  }
  function isUnlocked(roomId) {
    if (TEACHER) return true;
    if (FIVE.indexOf(roomId) >= 0) return true;
    if (roomId === "綜合") {
      return FIVE.every(function (r) { const s = roomStats(r); return s.basicDone === s.basic; });
    }
    if (roomId === "終極") {
      const s = roomStats("綜合");
      return isUnlocked("綜合") && s.basicDone === s.basic;
    }
    return false;
  }
  function lockText(roomId) {
    if (roomId === "綜合") return "完成五間案房的基本案件後啟封";
    if (roomId === "終極") return "完成綜合案後啟封";
    return "";
  }
  function caseLabel(c) {
    if (c.bookNo) return "校本第 " + c.bookNo + " 題";
    if (c.part) return c.part;
    return c.level === "懸案" ? "懸案" : "基本案件";
  }
  function doorChar(r) { return r.id === "綜合" ? "五" : (r.id === "終極" ? "柳" : r.id); }
  function progressText(s) {
    // 分成兩段，窄畫面換行時不會把「懸案 0／3」拆開
    return '<span class="pg">基本 ' + s.basicDone + "／" + s.basic + "</span>" +
      (s.hard ? '<span class="pg">懸案 ' + s.hardDone + "／" + s.hard + "</span>" : "");
  }

  /* ---------- 畫面：開始（偵探證） ---------- */
  function renderStart() {
    const hasProgress = Object.keys(store.cases).length > 0;
    app.innerHTML =
      '<section class="screen start">' +
        '<div class="start-intro">' +
          '<h1 class="title">虛詞偵探社</h1>' +
          '<p class="lead">文言城裏有五個虛詞經常「冒認身份」：<strong class="kai">乃、莫、因、為、焉</strong>。請你查明它們在每句話中的真正身份。</p>' +
        "</div>" +
        '<div class="start-grid">' +
          '<div class="id-card">' +
            '<div class="id-head"><span>偵探證</span><span class="mono">XUCI-02</span></div>' +
            '<div class="id-body">' +
              '<div class="id-photo" aria-hidden="true"><svg viewBox="0 0 60 72" width="60" height="72"><circle cx="30" cy="26" r="13" fill="#5a4d36"/><path d="M6 72c2-16 12-24 24-24s22 8 24 24z" fill="#5a4d36"/></svg></div>' +
              '<div class="id-fields">' +
                '<p class="id-rank">見習偵探</p>' +
                '<label for="det-name">姓名或班別學號（選填）</label>' +
                '<input id="det-name" maxlength="20" autocomplete="off" value="' + esc(store.name || "") + '">' +
                '<p class="id-note">只會印在偵探筆記上，不會上傳。</p>' +
              "</div>" +
            "</div>" +
            '<div class="id-foot">負責案件：<span class="kai">乃　莫　因　為　焉</span></div>' +
          "</div>" +
          '<div class="sheet procedure">' +
            '<h2 class="serif">查案三步</h2><ol>' +
              "<li><strong>看位置</strong>：嫌疑字在動作前、人或事物前、句末，還是句中停頓？</li>" +
              "<li><strong>找線索</strong>：在句子中點出幫助判斷的字詞，插上證物牌，再想想它們的關係。</li>" +
              "<li><strong>代入結案</strong>：選出意思，放回句子，通順才算破案。</li>" +
            "</ol>" +
            '<p class="muted">每宗案件最多三枚徽章：</p>' +
            '<ul class="badge-legend">' + BADGES.map(function (b) {
              return '<li><span class="badge on" aria-hidden="true">' + b[0] + "</span><span><strong>" + b[1] + "</strong>：" + b[2] + "</span></li>";
            }).join("") + "</ul>" +
          "</div>" +
        "</div>" +
        '<div class="row actions">' +
          '<button type="button" class="btn primary" data-act="start">' + (hasProgress ? "繼續查案" : "開始查案") + "</button>" +
        "</div>" +
        (TEACHER ? '<p class="sheet teacher">教師模式：全部卷宗已啟封，案件畫面會顯示答案。</p>' : "") +
      "</section>";
  }

  /* ---------- 畫面：大堂（檔案櫃） ---------- */
  function renderHall() {
    let doors = "";
    ROOMS.forEach(function (r) {
      const s = roomStats(r.id);
      const open = isUnlocked(r.id);
      doors +=
        '<li><button type="button" class="folder' + (open ? "" : " sealed") + '" data-act="room" data-id="' + esc(r.id) + '"' + (open ? "" : " disabled") + ">" +
          '<span class="folder-tab">' + esc(r.name) + "</span>" +
          '<span class="folder-body">' +
            '<span class="folder-char kai" aria-hidden="true">' + esc(doorChar(r)) + "</span>" +
            '<span class="folder-tag">' + esc(r.tag) + "</span>" +
            (open
              ? '<span class="folder-progress">' + progressText(s) + '</span><span class="folder-badges">徽章 <span class="mono">' + s.badges + " / " + s.maxBadges + "</span></span>"
              : '<span class="folder-progress">' + esc(lockText(r.id)) + "</span>") +
            (open ? "" : '<span class="seal-strip" aria-hidden="true">封存中</span>') +
          "</span>" +
          (open ? "" : '<span class="visually-hidden">（封存中）</span>') +
        "</button></li>";
    });
    app.innerHTML =
      '<section class="screen hall">' +
        '<h1 class="title">檔案櫃</h1>' +
        '<p class="on-desk">' + (store.name ? esc(store.name) + " 偵探，" : "") + "請選擇卷宗。建議次序：乃、莫 → 因 → 為 → 焉 → 綜合案 → 終極懸案。</p>" +
        '<ul class="cabinet">' + doors + "</ul>" +
      "</section>";
  }

  /* ---------- 畫面：案房（打開的卷宗） ---------- */
  function rulesTable(r) {
    return '<table class="rules"><tbody>' + r.rules.map(function (x) {
      return "<tr><td>" + esc(x[0]) + "</td><td>" + esc(x[1]) + "</td></tr>";
    }).join("") + "</tbody></table>";
  }
  function memoCard(r) {
    return '<div class="memo-card"><p class="memo-label">口訣卡</p>' +
      '<p class="memo-motto serif">' + esc(r.motto) + "</p>" + rulesTable(r) + "</div>";
  }
  function caseListHtml(list) {
    return '<ul class="case-list">' + list.map(function (c) {
      const r = rec(c.id);
      return '<li><button type="button" class="case-item" data-act="case" data-id="' + esc(c.id) + '">' +
        '<span class="cid mono">' + esc(c.id) + "</span>" +
        '<span class="ctext kai">' + plainHtml(c.sentence) + "</span>" +
        '<span class="cmeta">' + esc(caseLabel(c)) + "</span>" +
        (r && r.done ? badgesHtml(badgesOf(c.id)) : '<span class="cmeta">未查</span>') +
      "</button></li>";
    }).join("") + "</ul>";
  }
  function firstTodo(roomId) {
    const list = casesOf(roomId);
    const todo = list.find(function (c) { const r = rec(c.id); return c.level !== "懸案" && !(r && r.done); }) ||
      list.find(function (c) { const r = rec(c.id); return !(r && r.done); });
    return todo || list[0];
  }
  function renderRoom(roomId) {
    const r = room(roomId);
    if (!r || !isUnlocked(roomId)) { go("#/hall"); return; }
    const list = casesOf(roomId);
    const basic = list.filter(function (c) { return c.level !== "懸案"; });
    const hard = list.filter(function (c) { return c.level === "懸案"; });
    const s = roomStats(roomId);
    app.innerHTML =
      '<section class="screen room">' +
        '<div class="row"><a class="btn ghost" href="#/hall">← 檔案櫃</a></div>' +
        '<div class="folder-open">' +
          '<span class="folder-tab">' + esc(r.name) + "</span>" +
          '<div class="folder-body">' +
            '<div class="brief">' +
              '<div class="sheet">' +
                '<h1 class="serif">' + esc(r.name) + ' <small class="muted">' + esc(r.tag) + "</small></h1>" +
                '<h2 class="sheet-label mono">BRIEFING　案情簡報</h2>' +
                "<p>" + esc(r.intro) + "</p>" +
                '<p class="muted">示範：' + esc(r.example) + "</p>" +
              "</div>" +
              memoCard(r) +
            "</div>" +
            '<div class="row actions">' +
              '<button type="button" class="btn primary" data-act="case" data-id="' + esc(firstTodo(roomId).id) + '">' +
                (s.basicDone + s.hardDone > 0 ? "繼續查案" : "明白，開始查案") + "</button>" +
              '<span class="folder-badges">' + progressText(s) + "　徽章 <span class=\"mono\">" + s.badges + " / " + s.maxBadges + "</span></span>" +
            "</div>" +
            '<h2 class="serif list-title">基本案件（必做）</h2>' + caseListHtml(basic) +
            (hard.length ? '<h2 class="serif list-title">懸案（選做，較難）</h2>' + caseListHtml(hard) : "") +
          "</div>" +
        "</div>" +
      "</section>";
  }

  /* ---------- 畫面：案房小結 ---------- */
  function renderSummary(roomId) {
    const r = room(roomId);
    if (!r) { go("#/hall"); return; }
    const list = casesOf(roomId);
    const s = roomStats(roomId);
    const review = list.filter(function (c) { const x = rec(c.id); return x && x.review; });
    const hardTodo = list.find(function (c) { const x = rec(c.id); return c.level === "懸案" && !(x && x.done); });
    let next = "";
    if (roomId === "綜合" && isUnlocked("終極")) next = '<a class="btn primary" href="' + roomHref("終極") + '">前往終極懸案</a>';
    else if (FIVE.indexOf(roomId) >= 0 && isUnlocked("綜合") && !TEACHER) next = '<a class="btn primary" href="' + roomHref("綜合") + '">綜合案已啟封</a>';
    app.innerHTML =
      '<section class="screen summary">' +
        '<div class="folder-open">' +
          '<span class="folder-tab">' + esc(r.name) + "</span>" +
          '<div class="folder-body">' +
            '<div class="brief">' +
              '<div class="sheet">' +
                '<h1 class="serif">案房小結</h1>' +
                "<p>" + progressText(s) + "</p>" +
                "<p>本房徽章：<span class=\"mono\">" + s.badges + " / " + s.maxBadges + "</span></p>" +
              "</div>" +
              memoCard(r) +
            "</div>" +
            (review.length
              ? '<h2 class="serif list-title">要重溫的案件（第一次選錯意思）</h2>' + caseListHtml(review)
              : '<p class="sheet">本房沒有要重溫的案件。</p>') +
            '<div class="row actions">' +
              (hardTodo ? '<button type="button" class="btn primary" data-act="case" data-id="' + esc(hardTodo.id) + '">挑戰懸案</button>' : "") +
              (review.length ? '<button type="button" class="btn" data-act="case" data-id="' + esc(review[0].id) + '">重查錯案</button>' : "") +
              next +
              '<a class="btn" href="' + roomHref(roomId) + '">返回案房</a>' +
              '<a class="btn" href="#/hall">返回檔案櫃</a>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</section>";
  }

  /* ---------- 畫面：偵探筆記 ---------- */
  function renderNotebook() {
    let total = 0, max = 0;
    ROOMS.forEach(function (r) { const s = roomStats(r.id); total += s.badges; max += s.maxBadges; });
    const review = CASES.filter(function (c) { const x = rec(c.id); return x && x.review; });
    const rules = ROOMS.filter(function (r) { return FIVE.indexOf(r.id) >= 0; }).map(function (r) {
      const s = roomStats(r.id);
      return '<div class="nb-room"><h3 class="serif">' + esc(r.name) + "</h3>" +
        '<p class="memo-motto serif">' + esc(r.motto) + "</p>" + rulesTable(r) +
        '<p class="muted">' + progressText(s) + "　徽章 " + s.badges + "</p></div>";
    }).join("");
    const reviewHtml = review.length
      ? '<ul class="review-list">' + review.map(function (c) {
          return '<li><p class="s kai">' + plainHtml(c.sentence) + "</p>" +
            '<p class="muted"><span class="mono">' + esc(c.id) + "</span>｜" + esc(c.source) + "</p>" +
            "<p>正確意思：<strong>" + esc(c.answer[0]) + "</strong></p>" +
            '<p class="memo">判斷理由：' + esc(c.memo) + "</p></li>";
        }).join("") + "</ul>"
      : "<p>暫時沒有錯案。</p>";
    const d = new Date();
    app.innerHTML =
      '<section class="screen notebook">' +
        '<div class="notepad">' +
          '<h1 class="serif">偵探筆記</h1>' +
          '<p class="nb-meta">偵探：' + (store.name ? esc(store.name) : "（未填）") +
            "　日期：<span class=\"mono\">" + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() + "</span>" +
            "　徽章：<span class=\"mono\">" + total + " / " + max + "</span></p>" +
          '<h2 class="serif">五字口訣</h2>' +
          '<div class="nb-rules">' + rules + "</div>" +
          '<h2 class="serif">錯案重溫</h2>' + reviewHtml +
        "</div>" +
        '<div class="row actions no-print">' +
          '<button type="button" class="btn primary" data-act="print">列印／存成 PDF</button>' +
          '<a class="btn" href="#/hall">返回檔案櫃</a>' +
          '<button type="button" class="btn ghost" data-act="reset">清除全部進度</button>' +
        "</div>" +
      "</section>";
  }

  /* ---------- 畫面：案件 ---------- */
  let play = null;

  function startCase(id) {
    const c = caseById(id);
    if (!c || !isUnlocked(c.room)) { go("#/hall"); return false; }
    const tokens = parseSentence(c.sentence);
    const isTr = c.type === "translate";
    play = {
      c: c,
      tokens: tokens,
      hasClues: tokens.some(function (t) { return t.type === "clue"; }),
      step: isTr ? 3 : 1,
      posWrong: [],
      tapFound: false, tapWrong: false, wrongTaps: [], foundGroup: -1,
      qOrder: c.clueQ ? shuffle(c.clueQ.options.map(function (_, i) { return i; })) : [],
      qWrong: [],
      mOrder: shuffle(c.choices), mWrong: [],
      hints: 0,
      feedback: null,
      done: false, solved: false, badges: [false, false, false],
      mottoOpen: null,   // 口訣卡是否展開；null＝按螢幕闊度決定
      justFound: false,  // 剛找到線索：證物牌播放落下動畫
      justClosed: false  // 剛結案：播放蓋印動畫
    };
    return true;
  }

  function setFeedback(kind, html) {
    play.feedback = { kind: kind, html: html };
    const verdict = kind === "ok" ? "證據成立。" : (kind === "bad" ? "推理不成立。" : "");
    announce(verdict + html.replace(/<[^>]+>/g, ""));
  }

  // 證物牌編號：學生找到的線索是 1；第三步起其餘線索由系統補上，依次編號
  function markerNo(group) {
    const p = play;
    if (group === p.foundGroup) return 1;
    if (!(p.done || p.step === 3)) return 0;
    const groups = [];
    p.tokens.forEach(function (t) { if (t.type === "clue" && groups.indexOf(t.group) < 0 && t.group !== p.foundGroup) groups.push(t.group); });
    return groups.indexOf(group) + (p.foundGroup >= 0 ? 2 : 1);
  }

  function sentenceHtml() {
    const p = play;
    const tapping = p.step === 2 && p.hasClues && !p.tapFound && !p.done;
    let firstTarget = true;
    function tok(t, i) {
      if (t.type === "target") {
        const tag = firstTarget ? '<span class="suspect-tag" aria-hidden="true">嫌疑</span>' : "";
        firstTarget = false;
        return '<span class="tk target">' + tag + esc(t.ch) + "</span>";
      }
      const miss = p.wrongTaps.indexOf(i) >= 0 ? " miss" : "";
      if (tapping) {
        return '<button type="button" class="tk tap' + miss + '" data-act="tap" data-i="' + i + '" aria-label="線索候選：' + esc(t.ch) + '">' + esc(t.ch) + "</button>";
      }
      return '<span class="tk' + miss + '">' + esc(t.ch) + "</span>";
    }
    let html = "", i = 0;
    const toks = p.tokens;
    while (i < toks.length) {
      const t = toks[i];
      if (t.type !== "clue") { html += tok(t, i); i++; continue; }
      const g = t.group;
      let inner = "";
      while (i < toks.length && toks[i].type === "clue" && toks[i].group === g) { inner += tok(toks[i], i); i++; }
      const n = markerNo(g);
      if (!n) { html += inner; continue; }
      const own = g === p.foundGroup;
      html += '<span class="clue-group' + (own ? " found" : " revealed") + '">' +
        '<span class="marker' + (own && p.justFound ? " drop" : "") + '" aria-hidden="true">' + n + "</span>" +
        inner + "</span>";
    }
    return html;
  }

  function stepsHtml() {
    const p = play;
    if (p.c.type === "translate") return '<ol class="steps"><li class="' + (p.done ? "passed" : "now") + '">全句語譯' + (p.done ? " ✔" : "") + "</li></ol>";
    const names = ["① 看位置", "② 找線索", "③ 代入結案"];
    return '<ol class="steps">' + names.map(function (n, i) {
      const k = i + 1;
      let cls = "";
      if (p.done || k < p.step) cls = "passed";
      else if (k === p.step) cls = "now";
      return '<li class="' + cls + '"' + (cls === "now" ? ' aria-current="step"' : "") + ">" + n + (cls === "passed" ? " ✔" : "") + "</li>";
    }).join("") + "</ol>";
  }

  function optionButtons(items, act, wrongList, isLong, isKai) {
    // items：[{value, label}]；isLong＝單欄排列；isKai＝選項是文言語譯，用楷書
    const keys = "ABCDEFG";
    return '<div class="options' + (isLong ? " single" : "") + '">' + items.map(function (it, i) {
      const wrong = wrongList.indexOf(it.value) >= 0;
      return '<button type="button" class="opt' + (isKai ? " kai-opt" : "") + '" data-act="' + act + '" data-v="' + esc(it.value) + '"' +
        (wrong ? ' disabled aria-label="已排除：' + esc(it.label) + '"' : "") + ">" +
        '<span class="key mono">' + keys[i] + "</span><span>" + esc(it.label) + "</span>" + (wrong ? '<span class="x">✘</span>' : "") + "</button>";
    }).join("") + "</div>";
  }

  function panelHtml() {
    const p = play, c = p.c, x = targetChar(c);
    if (p.done) return closedHtml();
    if (p.step === 1) {
      const items = Object.keys(POSITIONS).map(function (k) { return { value: k, label: POSITIONS[k] }; });
      return '<h3 class="step-title">步驟①　看位置</h3>' +
        '<p class="q">嫌疑字「<span class="kai q-char">' + esc(x) + "</span>」在句中甚麼位置？</p>" +
        optionButtons(items, "pos", p.posWrong, false);
    }
    if (p.step === 2) {
      if (p.hasClues && !p.tapFound) {
        return '<h3 class="step-title">步驟②　找線索</h3>' +
          '<p class="q">在證物紙條上點出可以幫助判斷「<span class="kai q-char">' + esc(x) + "</span>」的線索字詞（點其中一個字即可）。</p>" +
          '<p class="muted">下面有虛線的字都可以點。點中線索，就會插上證物牌。</p>';
      }
      const items = p.qOrder.map(function (i) { return { value: String(i), label: c.clueQ.options[i] }; });
      return '<h3 class="step-title">步驟②　找線索</h3>' +
        '<p class="q">' + esc(c.clueQ.prompt) + "</p>" +
        optionButtons(items, "clue", p.qWrong, true);
    }
    // 步驟③
    const items = p.mOrder.map(function (v) { return { value: v, label: v }; });
    const isTr = c.type === "translate";
    return '<h3 class="step-title">' + (isTr ? "全句語譯" : "步驟③　代入結案") + "</h3>" +
      '<p class="q">' + (isTr ? esc(c.prompt) : "「<span class=\"kai q-char\">" + esc(x) + "</span>」在這裏解作甚麼？") + "</p>" +
      optionButtons(items, "meaning", p.mWrong, isTr, isTr);
  }

  function closedHtml() {
    const p = play, c = p.c, x = targetChar(c);
    const nextId = nextCaseId(c);
    return '<div class="closed">' +
      '<h3 class="step-title">' + (p.solved ? "本案已結案" : "未能結案：答案已公開") + "</h3>" +
      (c.type === "translate"
        ? ""
        : "<p>「<span class=\"kai q-char\">" + esc(x) + "</span>」在這裏解作：<strong>" + esc(c.answer[0]) + "</strong></p>") +
      '<p class="translation">語譯：' + fillHtml(c, c.answer[0]) + "</p>" +
      '<p class="memo">偵探手記：' + esc(c.memo) + "</p>" +
      (c.note ? '<p class="note">補充：' + esc(c.note) + "</p>" : "") +
      '<ul class="badge-list">' + BADGES.map(function (b, i) {
        const on = p.badges[i];
        return '<li class="' + (on ? "on" : "") + '"><span class="badge big' + (on ? " on" : "") + '" aria-hidden="true">' + b[0] + "</span>" +
          "<span><strong>" + b[1] + "</strong>" + (on ? "　已取得" : "　未取得") + '<br><span class="muted">' + b[2] + "</span></span></li>";
      }).join("") + "</ul>" +
      '<div class="row actions">' +
        (nextId
          ? '<button type="button" class="btn primary" data-act="case" data-id="' + esc(nextId) + '">下一宗</button>'
          : '<a class="btn primary" href="#/summary/' + encodeURIComponent(c.room) + '">案房小結</a>') +
        '<button type="button" class="btn" data-act="case" data-id="' + esc(c.id) + '">重查本案</button>' +
        '<a class="btn" href="' + roomHref(c.room) + '">返回案房</a>' +
      "</div></div>";
  }

  // 下一宗：基本案件完成後先到小結（再由小結挑戰懸案）
  function nextCaseId(c) {
    const list = casesOf(c.room);
    const i = list.indexOf(c);
    const nx = list[i + 1];
    if (!nx) return null;
    if (c.level !== "懸案" && nx.level === "懸案") return null;
    return nx.id;
  }

  function hintsHtml() {
    const p = play, c = p.c;
    if (p.done) return "";
    const left = c.hints.length - p.hints;
    const shown = c.hints.slice(0, p.hints).map(function (h, i) {
      return "<li><strong>" + LEVEL_NAMES[i] + "</strong>：" + esc(h) + "</li>";
    }).join("");
    return '<div class="hint-card">' +
      '<p class="memo-label">卡住了？</p>' +
      '<button type="button" class="btn dark" data-act="hint"' + (left <= 0 ? " disabled" : "") + ">提示（剩 " + left + " 次）</button>" +
      (shown ? "<ol>" + shown + "</ol>" : '<p class="small">用了提示，就不能取得神探章。</p>') +
      "</div>";
  }

  function teacherHtml() {
    if (!TEACHER) return "";
    const c = play.c;
    const parts = [];
    if (c.position) parts.push("位置：" + c.position + "（" + POSITIONS[c.position] + "）");
    if (c.clueQ) parts.push("線索題：" + c.clueQ.options[c.clueQ.answer]);
    parts.push("意思：" + c.answer.join("／"));
    return '<div class="sheet teacher no-print"><strong>教師參考</strong>：' + esc(parts.join("；")) + "</div>";
  }

  function feedbackHtml() {
    const fb = play.feedback;
    if (!fb || play.done) return "";
    const verdict = fb.kind === "ok" ? '<span class="verdict ok">證據成立</span>'
      : (fb.kind === "bad" ? '<span class="verdict bad">推理不成立</span>' : "");
    return '<div class="feedback ' + fb.kind + '">' + verdict + '<div class="fb-body">' + fb.html + "</div></div>";
  }

  function renderCase() {
    const p = play, c = p.c, r = room(c.room);
    const list = casesOf(c.room);
    const tapping = p.step === 2 && p.hasClues && !p.tapFound && !p.done;
    const mottoOpen = p.mottoOpen === null ? window.innerWidth >= 960 : p.mottoOpen;
    const seal = p.done
      ? '<span class="seal' + (p.solved ? "" : " fail") + (p.justClosed ? " press" : "") + '" aria-hidden="true">' + (p.solved ? "結案" : "未能結案") + "</span>"
      : "";
    app.innerHTML =
      '<section class="screen case">' +
        '<div class="file-head">' +
          '<a class="btn ghost" href="' + roomHref(c.room) + '">← ' + esc(r.name) + "</a>" +
          '<p class="case-no"><span class="mono">CASE No. ' + esc(c.id) + "　" + (list.indexOf(c) + 1) + " / " + list.length + "</span>　" + esc(caseLabel(c)) + "</p>" +
        "</div>" +
        '<figure class="evidence' + (tapping ? " tapping" : "") + '">' +
          '<span class="clip" aria-hidden="true"></span>' +
          '<p class="ev-label">證物　古籍殘句' + (tapping ? "　｜　點選句中字詞，標出線索" : "") + "</p>" +
          '<p class="sentence kai" lang="zh-Hant">' + sentenceHtml() + "</p>" +
          '<figcaption class="source">出處：' + esc(c.source) + "</figcaption>" +
          seal +
        "</figure>" +
        '<div class="desk">' +
          '<div class="clipboard">' +
            '<span class="clipboard-clip" aria-hidden="true"></span>' +
            '<h2 class="serif cb-title">偵查程序</h2>' +
            stepsHtml() +
            '<div class="panel">' + panelHtml() + "</div>" +
            feedbackHtml() +
          "</div>" +
          '<div class="side">' +
            '<details class="memo-card"' + (mottoOpen ? " open" : "") + ">" +
              '<summary><span class="memo-label">口訣卡</span><span class="memo-motto serif">' + esc(r.motto) + "</span></summary>" +
              rulesTable(r) +
            "</details>" +
            hintsHtml() +
            teacherHtml() +
          "</div>" +
        "</div>" +
      "</section>";
    p.justFound = false;
    p.justClosed = false;
  }

  /* ---------- 作答處理 ---------- */
  function onPos(v) {
    const p = play, c = p.c, x = targetChar(c);
    if (v === c.position) {
      p.step = 2;
      setFeedback("ok", "<p>位置：" + esc(POSITIONS[v]) + "。</p>");
      if (!p.hasClues) p.tapFound = true;
      return;
    }
    p.posWrong.push(v);
    let note = c.posNote;
    if (!note) {
      const ti = p.tokens.findIndex(function (t) { return t.type === "target"; });
      const nx = p.tokens[ti + 1];
      note = (!nx || PUNCT.test(nx.ch))
        ? "「" + x + "」後面已經是標點。"
        : "再看看「" + x + "」緊接後面的「" + nx.ch + "」：它是動作、狀態，還是人或事物？";
    }
    setFeedback("bad", "<p>" + esc(note) + "</p>");
  }

  function onTap(i) {
    const p = play, t = p.tokens[i];
    if (!t) return;
    if (t.type === "clue") {
      p.tapFound = true;
      p.foundGroup = t.group;
      p.justFound = true;
      const text = p.tokens.filter(function (x) { return x.group === t.group; }).map(function (x) { return x.ch; }).join("");
      setFeedback("ok", "<p>找到線索：「" + esc(text) + "」，已插上證物牌 1。</p>");
      return;
    }
    if (p.wrongTaps.indexOf(i) < 0) p.wrongTaps.push(i);
    p.tapWrong = true;
    setFeedback("bad", "<p>「" + esc(t.ch) + "」不是關鍵線索，再找找。卡住了可以按「提示」。</p>");
  }

  function onClue(v) {
    const p = play, c = p.c;
    if (Number(v) === c.clueQ.answer) {
      p.step = 3;
      setFeedback("ok", "<p>" + esc(c.clueQ.options[c.clueQ.answer]) + "。</p><p>現在選出意思，代入句子檢驗。</p>");
      return;
    }
    p.qWrong.push(v);
    setFeedback("bad", "<p>再想想。看看證物牌標示的線索，或按「提示」。</p>");
  }

  function onMeaning(v) {
    const p = play, c = p.c;
    if (c.answer.indexOf(v) >= 0) { finish(true); return; }
    p.mWrong.push(v);
    if (p.mWrong.length >= 2) { finish(false); return; }
    const why = (c.absurd && c.absurd[v])
      ? esc(c.absurd[v])
      : "代入：「" + fillHtml(c, v) + "」這樣說通順嗎？";
    const mid = c.hints[1] ? "<p>想一想：" + esc(c.hints[1]) + "</p>" : "";
    setFeedback("bad", "<p>荒謬代入：" + why + "</p>" + mid + "<p>再選一次。</p>");
  }

  function finish(solved) {
    const p = play, c = p.c;
    const check = c.type === "translate" ? true : (p.posWrong.length === 0 && !p.tapWrong && p.qWrong.length === 0);
    const close = solved;
    const ace = check && solved && p.mWrong.length === 0 && p.hints === 0;
    p.done = true;
    p.solved = solved;
    p.justClosed = true;
    p.badges = [check, close, ace];
    // 徽章取歷次最好的結果；「要重溫」只看最近一次
    const old = badgesOf(c.id);
    const best = p.badges.map(function (b, i) { return b || old[i]; });
    store.cases[c.id] = {
      done: true,
      badges: best,
      stars: best.filter(Boolean).length,
      review: !(solved && p.mWrong.length === 0)
    };
    save();
    const got = BADGES.filter(function (_, i) { return p.badges[i]; }).map(function (b) { return b[1]; });
    announce((solved ? "結案。" : "未能結案。") + "正確意思：" + c.answer[0] + "。語譯：" + fillText(c, c.answer[0]) + "。" +
      (got.length ? "取得" + got.join("、") + "。" : "本案沒有取得徽章。"));
  }

  function onHint() {
    const p = play;
    if (p.hints >= p.c.hints.length) return;
    p.hints += 1;
    announce(LEVEL_NAMES[p.hints - 1] + "提示：" + p.c.hints[p.hints - 1]);
  }

  /* ---------- 事件 ---------- */
  app.addEventListener("click", function (e) {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    switch (act) {
      case "start": {
        const input = document.getElementById("det-name");
        store.name = input ? input.value.trim().slice(0, 20) : "";
        save();
        updateChip();
        go("#/hall");
        return;
      }
      case "room": go(roomHref(el.dataset.id)); return;
      case "case": go("#/case/" + encodeURIComponent(el.dataset.id)); return;
      case "print": window.print(); return;
      case "reset":
        if (window.confirm("確定要清除全部進度嗎？清除後不能還原。")) {
          const font = store.font;
          store = freshStore();
          store.font = font;
          save();
          updateChip();
          go("#/start");
        }
        return;
    }
    if (!play) return;
    if (act === "pos") onPos(el.dataset.v);
    else if (act === "tap") onTap(Number(el.dataset.i));
    else if (act === "clue") onClue(el.dataset.v);
    else if (act === "meaning") onMeaning(el.dataset.v);
    else if (act === "hint") onHint();
    else return;
    renderCase();
    focusPanel();
  });

  // 記住口訣卡的展開狀態，重繪時保持不變（toggle 事件不冒泡，所以用捕獲階段）
  app.addEventListener("toggle", function (e) {
    if (play && e.target.classList && e.target.classList.contains("memo-card")) play.mottoOpen = e.target.open;
  }, true);

  // 重繪後把焦點放回作答區，方便鍵盤使用者
  function focusPanel() {
    const target = app.querySelector(".sentence button.tk, .panel .opt:not(:disabled), .panel .btn");
    if (target) target.focus({ preventScroll: true });
  }

  /* ---------- 頂欄：偵探證、字體大小 ---------- */
  function updateChip() {
    if (idChip) idChip.textContent = store.name ? "偵探證　" + store.name : "偵探證";
  }
  function applyFont() {
    document.documentElement.dataset.font = String(store.font || 0);
    document.querySelectorAll(".font-ctrl button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.font) === (store.font || 0)));
    });
  }
  document.querySelectorAll(".font-ctrl button").forEach(function (b) {
    b.addEventListener("click", function () {
      store.font = Number(b.dataset.font);
      save();
      applyFont();
    });
  });

  /* ---------- 路由 ---------- */
  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#/, "")) || "/start";
    const parts = h.split("/").filter(Boolean);
    play = null;
    document.body.dataset.screen = parts[0] || "start";
    switch (parts[0]) {
      case "hall": renderHall(); break;
      case "room": renderRoom(parts[1]); break;
      case "summary": renderSummary(parts[1]); break;
      case "notebook": renderNotebook(); break;
      case "case":
        if (startCase(parts[1])) renderCase();
        break;
      default: document.body.dataset.screen = "start"; renderStart();
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", route);
  applyFont();
  updateChip();
  route();
})();
