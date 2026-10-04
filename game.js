/* =========================================================
   DRUNK SNAKE — 游戏逻辑

   小蛇在草地上匀速前进，吃地上的酒瓶。
   喝得越多：速度越不稳、方向越不受控。

   文件分工：index.html 结构 / style.css 样式 / game.js 逻辑（本文件）
   调手感看 CFG，调画面看「8. 绘制」那一段，加音频看 AUDIO 和 audio/README.md。
   ========================================================= */

"use strict";

/* ---------------------------------------------------------
   1. 参数
   --------------------------------------------------------- */
const CFG = {
  headRadius: 13,          // 蛇头半径（身体粗细跟着它走）
  bodySpacing: 9,          // 身体采样点间距 px
  bodySegments: 26,        // 初始身长（采样点数量）
  growPerBottle: 7,        // 每喝一瓶变长多少
  baseSpeed: 168,          // 清醒时前进速度 px/s
  bottleRadius: 11,        // 酒瓶碰撞半径
  edge: 16,                // 草地围栏厚度
  maxDrunk: 1.0,

  /* ---- 转向手感：长按一边，转向速度会越来越快 ---- */
  turnSensitivity: 10,     // 灵敏度刻度 0~10，10 = 默认平均水平，越大越灵敏
  turnAccel: 34,           // 转向加速度 rad/s²：越大越快达到最大转向速度
  turnDecel: 40,           // 松手后转向速度回落的加速度 rad/s²：越大越干脆
  turnDrunkPenalty: 0.5,   // 醉酒削弱转向的比例：0.5 = 烂醉时只剩一半操控力
  accelDrunkPenalty: 0.35, // 醉酒让转向加速变慢的比例

  /* ---- 前进速度：加速 / 减速 ---- */
  accel: 400,              // 加速度 px/s²（提速用）
  decel: 480,              // 减速度 px/s²（降速用）

  // 醉酒强度曲线：0 瓶 = 0，越喝越接近 1
  drunkOf: n => 1 - Math.exp(-n / 6)
};

// 由 0~10 灵敏度换算出的最大转向角速度（rad/s）：turnSensitivity 10 → 5.0 rad/s
const MAX_TURN_RATE = CFG.turnSensitivity * 0.5;

// 醉酒阶段：阈值 / HUD 文字 / 颜色
const DRUNK_STAGES = [
  { limit: 0.06, label: "SOBER",    color: "#8ee04f" },
  { limit: 0.28, label: "TIPSY",    color: "#d7e04f" },
  { limit: 0.55, label: "DIZZY",    color: "#ffd23f" },
  { limit: 0.78, label: "WASTED",   color: "#ff9f3d" },
  { limit: 1.01, label: "BLACKOUT", color: "#ff4d4d" }
];

/* ---------------------------------------------------------
   音频配置
   把音频文件丢进 audio/ 文件夹就行，文件名对上就能响；
   缺文件不会报错，也不会影响游戏。详见 audio/README.md
   --------------------------------------------------------- */
const AUDIO = {
  dir: "audio/",

  master: 0.9,        // 总音量 0 ~ 1
  musicVolume: 0.55,  // 背景音乐音量
  sfxVolume: 0.9,     // 音效音量
  musicRate: 0.06,    // 越醉音乐越快：1 + 0.06 = 最多快 6%

  // 每一项可以写一个文件名，也可以写一列候选：按顺序找，第一个能加载的就用。
  // 所以 mp3 / wav / ogg 随便丢哪种进来都能自动匹配。
  files: {
    music: ["music.mp3", "music.wav", "music.ogg"],   // 背景音乐（循环）
    eat:   ["eat.wav", "eat.mp3", "eat.ogg"],         // 吃到酒瓶
    stage: ["stage.wav", "stage.mp3", "stage.ogg"],   // 醉酒升一档
    crash: ["crash.wav", "crash.mp3", "crash.ogg"],   // 撞死
    start: ["start.wav", "start.mp3", "start.ogg"],   // 开局
    click: ["click.wav", "click.mp3", "click.ogg"]    // 按钮点击
  }
};

/* ---------------------------------------------------------
   2. DOM
   --------------------------------------------------------- */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const overlay = document.getElementById("overlay");
const startPanel = document.getElementById("startPanel");
const overPanel = document.getElementById("overPanel");

const elBottles = document.getElementById("bottleCount");
const elFill = document.getElementById("drunkFill");
const elDrunkText = document.getElementById("drunkText");
const elSpeed = document.getElementById("speedText");

const elOverReason = document.getElementById("overReason");
const elOverCount = document.getElementById("overCount");
const elOverLabel = document.getElementById("overLabel");

/* ---------------------------------------------------------
   3. 音频
   文件放 audio/ 文件夹即可，不用改代码。
   --------------------------------------------------------- */
const muteBtn = document.getElementById("muteBtn");
const sound = createSoundSystem(AUDIO);

function createSoundSystem(cfg) {
  // 每个音效解析成一列候选路径：按顺序试，第一个能加载的就用
  const candidates = {};
  for (const name in cfg.files) {
    const value = cfg.files[name];
    candidates[name] = (Array.isArray(value) ? value : [value]).map(f => cfg.dir + f);
  }

  let muted = false;
  let musicWanted = false;    // 游戏进行中是否想放 BGM
  let musicBroken = false;
  let musicLogged = false;

  const fileName = src => String(src).split("/").pop().split("\\").pop();

  // ---- 背景音乐：候选换着试，哪个能加载就用哪个 ----
  const music = new Audio();
  let musicPick = 0;
  music.loop = true;
  music.preload = "auto";
  music.addEventListener("error", () => {
    musicPick++;
    if (musicPick >= candidates.music.length) { musicBroken = true; return; }
    music.src = candidates.music[musicPick];
  });
  music.addEventListener("canplay", () => { if (musicWanted && !muted) playMusic(); });
  music.addEventListener("playing", () => {
    if (musicLogged) return;
    musicLogged = true;
    console.info("[audio] BGM 开始播放：" + fileName(music.src));
  });
  music.src = candidates.music[0];

  // ---- 音效：每个一个槽，同样支持候选 ----
  const sfx = {};
  for (const name in candidates) {
    if (name === "music") continue;
    sfx[name] = makeSlot(candidates[name]);
  }

  function makeSlot(list) {
    const slot = { list: list, pick: 0, el: null, broken: false };
    load();
    function load() {
      const el = new Audio();
      el.preload = "auto";
      el.addEventListener("error", () => {
        slot.pick++;
        if (slot.pick >= list.length) { slot.broken = true; return; }
        load();
      });
      el.src = list[slot.pick];
      slot.el = el;
    }
    return slot;
  }

  const volumeOf = v => Math.max(0, Math.min(1, cfg.master * v));

  function play(name) {
    if (muted) return;
    const slot = sfx[name];
    if (!slot || slot.broken || !slot.el) return;
    const node = slot.el.cloneNode();        // 克隆一份，方便同一个音效叠着响
    node.volume = volumeOf(cfg.sfxVolume);
    const p = node.play();
    if (p && p.catch) p.catch(() => {});     // 文件缺失 / 被浏览器拦截都不报错
  }

  function playMusic(fromStart) {
    musicWanted = true;
    if (muted || musicBroken) return;
    if (fromStart) { try { music.currentTime = 0; } catch (e) { /* 还没加载好就算了 */ } }
    music.volume = volumeOf(cfg.musicVolume);
    const p = music.play();
    if (p && p.catch) p.catch(() => {});
  }

  function stopMusic() {
    musicWanted = false;
    music.pause();
  }

  // 越醉放得越快
  function setRate(rate) {
    if (musicBroken) return;
    try { music.playbackRate = rate; } catch (e) { /* 个别浏览器不支持就算了 */ }
  }

  function setMuted(value) {
    muted = value;
    music.muted = value;   // 静音而不是暂停，取消静音能从原位置接着放
  }

  // 浏览器要求先有一次用户操作才让出声；?auto=1 直接开局时靠这里补上
  ["pointerdown", "keydown", "touchstart"].forEach(ev => {
    window.addEventListener(ev, () => { if (musicWanted) playMusic(); }, { passive: true });
  });

  // 自查：每个音效实际加载到的是哪个文件（控制台里敲 sound.report() 也能看）
  function report() {
    const rows = [];
    let missing = 0;

    if (musicBroken) { rows.push("music=没找到"); missing++; }
    else rows.push("music=" + fileName(music.src));

    for (const name in sfx) {
      if (sfx[name].broken) { rows.push(name + "=没找到"); missing++; }
      else rows.push(name + "=" + fileName(sfx[name].el.src));
    }

    rows.push("BGM=" + (musicBroken ? "没找到" : (music.paused ? "待机中" : "播放中")));
    rows.push("缺失 " + missing + " 个");
    return rows;
  }

  // 启动 1.5 秒后把加载结果报到控制台，方便排查
  setTimeout(() => {
    const rows = report();
    const missing = rows[rows.length - 1] !== "缺失 0 个";
    const line = "[audio] " + rows.join("，");
    if (missing) console.warn(line + "   （把文件放进 audio/ 文件夹就会自动生效）");
    else console.info(line + " ✓");
  }, 1500);

  return {
    play: play,
    playMusic: playMusic,
    stopMusic: stopMusic,
    setRate: setRate,
    setMuted: setMuted,
    report: report,
    isMuted: function () { return muted; },
    toggleMute: function () {
      setMuted(!muted);
      muteBtn.textContent = muted ? "SOUND OFF" : "SOUND ON";
      muteBtn.classList.toggle("off", muted);
      if (!muted) play("click");
    }
  };
}

muteBtn.addEventListener("click", () => sound.toggleMute());

/* ---------------------------------------------------------
   4. 视口
   --------------------------------------------------------- */
let W = 0, H = 0, DPR = 1;
let grassPatches = [];   // 草地色块
let grassBlades = [];    // 草簇

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  buildGrass();
  if (game && game.running) clampInsideArena(game.snake);
}

function buildGrass() {
  grassPatches = [];
  const patchCount = Math.round((W * H) / 30000);
  for (let i = 0; i < patchCount; i++) {
    grassPatches.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 26 + Math.random() * 96,
      light: Math.random() < 0.5
    });
  }

  grassBlades = [];
  const bladeCount = Math.round((W * H) / 14000);
  for (let i = 0; i < bladeCount; i++) {
    grassBlades.push({
      x: Math.random() * W,
      y: Math.random() * H,
      h: 6 + Math.random() * 8,
      w: 2 + Math.random() * 2
    });
  }
}

/* ---------------------------------------------------------
   5. 游戏状态
   --------------------------------------------------------- */
let game = null;

function createGame() {
  const snake = {
    x: W * 0.5,
    y: H * 0.5,
    angle: 0,
    speed: CFG.baseSpeed,
    turnVel: 0,       // 当前转向角速度 rad/s（左负右正，会加速和回落）
    trail: [],
    length: CFG.bodySegments
  };

  const g = {
    running: true,
    over: false,
    reason: "",
    t: 0,
    snake: snake,
    bottles: 0,
    drunk: 0,
    drunkStage: 0,
    food: null,
    particles: [],
    popups: [],
    shake: 0,
    flash: 0,
    // 随机相位，让每一局的“醉态”都不一样
    phase: [Math.random() * 10, Math.random() * 10, Math.random() * 10, Math.random() * 10],
    kick: 0,          // 突然的转向抽搐
    kickTimer: 1.5,
    lurch: 0,         // 突然的速度踉跄
    lurchTimer: 2.0
  };

  // 初始轨迹：先在身后铺一条直线，避免开局身体缩成一点
  for (let i = snake.length * CFG.bodySpacing + 40; i >= 0; i -= 4) {
    snake.trail.push({ x: snake.x - i, y: snake.y });
  }

  game = g;
  g.food = spawnFood(g);
}

function spawnFood(g) {
  const margin = 70;
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = margin + Math.random() * Math.max(1, W - margin * 2);
    const y = margin + Math.random() * Math.max(1, H - margin * 2);
    if (Math.hypot(x - g.snake.x, y - g.snake.y) < 170) continue;

    let tooClose = false;
    for (let i = 0; i < g.snake.trail.length; i += 6) {
      const p = g.snake.trail[i];
      if (Math.hypot(x - p.x, y - p.y) < 60) { tooClose = true; break; }
    }
    if (tooClose) continue;

    return { x: x, y: y, rot: (Math.random() - 0.5) * 0.7, bob: Math.random() * 10 };
  }
  return { x: W * 0.5, y: H * 0.28, rot: 0, bob: 0 };
}

/* ---------------------------------------------------------
   6. 输入
   --------------------------------------------------------- */
const keys = { left: false, right: false };
let pointerSteer = 0;   // 触屏：-1 左 / +1 右

window.addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "a") { keys.left = true; e.preventDefault(); }
  if (k === "arrowright" || k === "d") { keys.right = true; e.preventDefault(); }
  if (k === "m") { sound.toggleMute(); e.preventDefault(); }
  if (k === " " || k === "enter") {
    e.preventDefault();
    if (!game || !game.running) start();
  }
});

window.addEventListener("keyup", e => {
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "a") keys.left = false;
  if (k === "arrowright" || k === "d") keys.right = false;
});

// 触屏：按住屏幕左 / 右半边转向
function pointerUpdate(e) {
  if (!e.touches || e.touches.length === 0) { pointerSteer = 0; return; }
  const rect = canvas.getBoundingClientRect();
  const x = e.touches[0].clientX - rect.left;
  pointerSteer = x < W * 0.5 ? -1 : 1;
}
canvas.addEventListener("touchstart", e => { e.preventDefault(); pointerUpdate(e); });
canvas.addEventListener("touchmove", e => { e.preventDefault(); pointerUpdate(e); });
canvas.addEventListener("touchend", e => { e.preventDefault(); pointerUpdate(e); });

window.addEventListener("blur", () => { keys.left = keys.right = false; pointerSteer = 0; });

/* ---------------------------------------------------------
   7. 每帧更新
   --------------------------------------------------------- */
function update(dt) {
  const g = game;
  const s = g.snake;
  g.t += dt;

  const drunk = g.drunk;

  /* --- 转向：长按一边越转越快（带转向加速度）--- */
  const target = (keys.left ? -1 : 0) + (keys.right ? 1 : 0) + pointerSteer;
  const want = Math.max(-1, Math.min(1, target));

  const authority = 1 - CFG.turnDrunkPenalty * drunk;   // 醉了操控力下降
  const targetTurn = want * MAX_TURN_RATE * authority;

  // 按住：按 turnAccel 往上加速；松手：按 turnDecel 回落
  const turnStep = (want === 0
    ? CFG.turnDecel
    : CFG.turnAccel * (1 - CFG.accelDrunkPenalty * drunk)) * dt;
  const turnDiff = targetTurn - s.turnVel;
  s.turnVel += Math.abs(turnDiff) <= turnStep ? turnDiff : Math.sign(turnDiff) * turnStep;

  s.angle += s.turnVel * dt;

  // 持续的随机漂移
  const drift = drunk * (1.05 * Math.sin(g.t * 0.9 + g.phase[0])
                       + 0.62 * Math.sin(g.t * 2.4 + g.phase[1]));

  // 偶发的“打嗝式”猛拐
  g.kickTimer -= dt;
  if (g.kickTimer <= 0) {
    g.kickTimer = 2.6 - 1.9 * drunk + Math.random() * 1.2;
    g.kick += (Math.random() * 2 - 1) * 2.6 * drunk;
  }
  g.kick *= Math.exp(-dt * 3.2);

  s.angle += (drift + g.kick) * dt;

  /* --- 速度：清醒匀速，醉了发抖 --- */
  g.lurchTimer -= dt;
  if (g.lurchTimer <= 0) {
    g.lurchTimer = 1.8 - 1.1 * drunk + Math.random() * 1.4;
    g.lurch += (Math.random() * 2 - 1) * 0.55 * drunk;
  }
  g.lurch *= Math.exp(-dt * 1.8);

  const wob = drunk * (0.55 * Math.sin(g.t * 1.7 + g.phase[2])
                    + 0.45 * Math.sin(g.t * 4.3 + g.phase[3]));
  const targetSpeed = Math.max(40, CFG.baseSpeed * (1 + 0.68 * wob + g.lurch));

  // 速度不是瞬间变的：提速用 accel，降速用 decel
  const speedDiff = targetSpeed - s.speed;
  const speedStep = (speedDiff >= 0 ? CFG.accel : CFG.decel) * dt;
  s.speed += Math.abs(speedDiff) <= speedStep ? speedDiff : Math.sign(speedDiff) * speedStep;

  /* --- 前进 --- */
  s.x += Math.cos(s.angle) * s.speed * dt;
  s.y += Math.sin(s.angle) * s.speed * dt;

  const last = s.trail[s.trail.length - 1];
  if (!last || Math.hypot(s.x - last.x, s.y - last.y) > 3) {
    s.trail.push({ x: s.x, y: s.y });
  }
  trimTrail(s);

  /* --- 吃到酒瓶 --- */
  const f = g.food;
  if (f && Math.hypot(s.x - f.x, s.y - f.y) < CFG.headRadius + CFG.bottleRadius) {
    g.bottles++;
    g.drunk = Math.min(CFG.maxDrunk, CFG.drunkOf(g.bottles));
    s.length += CFG.growPerBottle;
    g.shake = Math.min(10, 4 + g.bottles * 0.5);
    g.flash = 0.5;
    burst(f.x, f.y, "#c8f07a", 16);
    addPopup(f.x, f.y - 28, "+1", 26, "#ffd23f");
    sound.play("eat");
    g.food = spawnFood(g);
  }

  /* --- 碰撞 --- */
  const body = sampleBody(s);
  if (hitWall(s)) die("YOU CRASHED INTO THE FENCE");
  else if (hitSelf(s, body)) die("YOU TIED YOURSELF IN A KNOT");

  /* --- 粒子 / 飘字 / 抖动衰减 --- */
  g.shake *= Math.exp(-dt * 6);
  g.flash = Math.max(0, g.flash - dt * 2.2);

  for (let i = g.particles.length - 1; i >= 0; i--) {
    const p = g.particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.exp(-dt * 2.5);
    p.vy *= Math.exp(-dt * 2.5);
    if (p.life <= 0) g.particles.splice(i, 1);
  }

  for (let i = g.popups.length - 1; i >= 0; i--) {
    const p = g.popups[i];
    p.life -= dt;
    p.y -= 42 * dt;
    if (p.life <= 0) g.popups.splice(i, 1);
  }

  updateHud();
}

function trimTrail(s) {
  // 轨迹最长只留够身体用的部分
  const maxLen = s.length * CFG.bodySpacing + 70;
  let acc = 0;
  for (let i = s.trail.length - 1; i > 0; i--) {
    acc += Math.hypot(s.trail[i].x - s.trail[i - 1].x, s.trail[i].y - s.trail[i - 1].y);
    if (acc > maxLen) {
      s.trail.splice(0, Math.max(0, i - 1));
      break;
    }
  }

  // 身体突然变长时轨迹可能不够长，顺着方向往尾部补一段，
  // 否则采样点会全部堆在同一个位置（尾巴挤成一团）
  const need = s.length * CFG.bodySpacing + 20;
  let total = 0;
  for (let i = s.trail.length - 1; i > 0; i--) {
    total += Math.hypot(s.trail[i].x - s.trail[i - 1].x, s.trail[i].y - s.trail[i - 1].y);
  }
  if (total >= need || s.trail.length < 2) return;

  const a = s.trail[0], b = s.trail[1];
  const dx = a.x - b.x, dy = a.y - b.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return;

  const deficit = need - total;
  s.trail.unshift({ x: a.x + (dx / d) * deficit, y: a.y + (dy / d) * deficit });
}

function clampInsideArena(s) {
  s.x = Math.max(CFG.edge + CFG.headRadius, Math.min(W - CFG.edge - CFG.headRadius, s.x));
  s.y = Math.max(CFG.edge + CFG.headRadius, Math.min(H - CFG.edge - CFG.headRadius, s.y));
}

// 沿轨迹按距离取点（从蛇头往回数）
function sampleTrailDist(trail, dist) {
  let acc = 0;
  for (let i = trail.length - 1; i > 0; i--) {
    const a = trail[i], b = trail[i - 1];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d === 0) continue;
    if (acc + d >= dist) {
      const r = (dist - acc) / d;
      return { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r };
    }
    acc += d;
  }
  const first = trail[0];
  return { x: first.x, y: first.y };
}

// 把身体采样成一串带半径的点：第 0 个是头，越往后越细
function sampleBody(s) {
  const pts = [];
  for (let i = 0; i < s.length; i++) {
    const p = sampleTrailDist(s.trail, i * CFG.bodySpacing);
    const t = s.length > 1 ? i / (s.length - 1) : 0;
    pts.push({ x: p.x, y: p.y, r: CFG.headRadius * (1 - 0.42 * Math.pow(t, 1.15)) });
  }
  return pts;
}

function hitWall(s) {
  const r = CFG.headRadius * 0.85;
  return s.x < CFG.edge + r || s.x > W - CFG.edge - r ||
         s.y < CFG.edge + r || s.y > H - CFG.edge - r;
}

function hitSelf(s, body) {
  // 跳过紧挨着头的几节，不然一开局就算自杀
  const skip = Math.max(12, Math.round(120 / CFG.bodySpacing));
  for (let i = skip; i < body.length; i++) {
    const p = body[i];
    if (Math.hypot(s.x - p.x, s.y - p.y) < (CFG.headRadius + p.r) * 0.72) return true;
  }
  return false;
}

function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 160;
    game.particles.push({
      x: x, y: y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.4 + Math.random() * 0.5,
      max: 0.9,
      r: 1.5 + Math.random() * 2.5,
      color: color
    });
  }
}

function addPopup(x, y, text, size, color) {
  game.popups.push({ x: x, y: y, text: text, size: size, color: color, life: 0.95, max: 0.95 });
}

function die(reason) {
  game.running = false;
  game.over = true;
  game.reason = reason;
  burst(game.snake.x, game.snake.y, "#ffd23f", 26);
  sound.play("crash");
  sound.stopMusic();
  updateHud();
  showGameOver();
}

/* ---------------------------------------------------------
   8. 绘制
   --------------------------------------------------------- */
const INK = "#16121c";   // 统一描边色

function draw() {
  const g = game;
  const sway = g.drunk;

  // 醉酒：整个画面轻轻摇晃
  const rot = (Math.sin(g.t * 0.8 + g.phase[0]) * 0.016 + Math.sin(g.t * 2.1) * 0.006) * sway;
  const zoom = 1 + Math.sin(g.t * 0.6) * 0.012 * sway;
  const shakeX = (Math.random() - 0.5) * g.shake;
  const shakeY = (Math.random() - 0.5) * g.shake;

  ctx.save();
  ctx.translate(W / 2 + shakeX, H / 2 + shakeY);
  ctx.rotate(rot);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);

  drawGrass();
  drawFence();
  drawFood(g);

  const body = sampleBody(g.snake);   // 每帧只采样一次，重影复用

  // 重影：越醉越明显
  if (sway > 0.12) {
    const ox = Math.sin(g.t * 3.1) * 7 * sway;
    const oy = Math.cos(g.t * 2.4) * 7 * sway;

    ctx.save();
    ctx.globalAlpha = 0.16 * sway;
    ctx.translate(ox, oy);
    drawSnake(g, true, body);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.10 * sway;
    ctx.translate(-ox * 1.4, -oy * 1.4);
    drawSnake(g, true, body);
    ctx.restore();
  }

  drawSnake(g, false, body);
  drawParticles(g);
  ctx.restore();

  drawPopups(g);
  drawDrunkOverlay(sway);
}

function drawGrass() {
  // 平涂底色
  ctx.fillStyle = "#5fbe46";
  ctx.fillRect(0, 0, W, H);

  // 浅色条带（平涂，不用渐变）
  ctx.fillStyle = "rgba(255,255,255,0.055)";
  for (let y = 0; y < H; y += 72) ctx.fillRect(0, y, W, 36);

  // 深 / 浅色块，硬边
  for (const p of grassPatches) {
    ctx.fillStyle = p.light ? "rgba(255,255,255,0.045)" : "rgba(20,80,25,0.075)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 草簇：小三角
  ctx.fillStyle = "rgba(28,96,32,0.5)";
  for (const b of grassBlades) {
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.w, b.y - b.h);
    ctx.lineTo(b.x + b.w, b.y - b.h);
    ctx.closePath();
    ctx.fill();
  }
}

function drawFence() {
  const e = CFG.edge;
  ctx.fillStyle = "#2f6b2a";
  ctx.fillRect(0, 0, W, e);
  ctx.fillRect(0, H - e, W, e);
  ctx.fillRect(0, 0, e, H);
  ctx.fillRect(W - e, 0, e, H);

  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.strokeRect(e - 2, e - 2, W - e * 2 + 4, H - e * 2 + 4);
}

function drawFood(g) {
  const f = g.food;
  if (!f) return;
  const bob = Math.sin(g.t * 2.2 + f.bob) * 3;
  drawBottle(f.x, f.y + bob, f.rot, 1.4);
}

// 酒瓶：全部用 canvas 路径画的矢量图形（没有用任何图片素材）
function drawBottle(x, y, rot, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 地上的一团影子（平涂椭圆）
  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.beginPath();
  ctx.ellipse(0, 14, 13, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 2.6;
  ctx.strokeStyle = INK;

  // 瓶身 + 瓶颈：一笔画完，只描一次边
  ctx.beginPath();
  ctx.moveTo(-3.4, -20);
  ctx.lineTo(3.4, -20);
  ctx.lineTo(3.4, -16);
  ctx.lineTo(3.0, -15);
  ctx.lineTo(3.0, -10);
  ctx.quadraticCurveTo(7.6, -8, 7.6, -2);
  ctx.lineTo(7.6, 11);
  ctx.quadraticCurveTo(7.6, 14, 4, 14);
  ctx.lineTo(-4, 14);
  ctx.quadraticCurveTo(-7.6, 14, -7.6, 11);
  ctx.lineTo(-7.6, -2);
  ctx.quadraticCurveTo(-7.6, -8, -3.0, -10);
  ctx.lineTo(-3.0, -15);
  ctx.lineTo(-3.4, -16);
  ctx.closePath();
  ctx.fillStyle = "#2f9e3f";
  ctx.fill();
  ctx.stroke();

  // 玻璃高光（平涂色块）
  ctx.fillStyle = "#6ee06a";
  ctx.beginPath();
  ctx.moveTo(-5.4, 6);
  ctx.lineTo(-4.2, -6);
  ctx.lineTo(-2.2, 6);
  ctx.closePath();
  ctx.fill();

  // 酒标
  ctx.fillStyle = "#fff8e7";
  ctx.fillRect(-6.2, -1, 12.4, 9);
  ctx.strokeRect(-6.2, -1, 12.4, 9);
  ctx.fillStyle = "#ff3d7f";
  ctx.fillRect(-4.2, 2, 8.4, 2.4);

  // 木塞
  ctx.fillStyle = "#d9a05b";
  ctx.fillRect(-3.6, -24, 7.2, 5);
  ctx.strokeRect(-3.6, -24, 7.2, 5);

  ctx.restore();
}

// 身体用「粗黑折线 + 平涂折线」两遍画，重叠处不会露出内部线条
function drawSnake(g, ghost, body) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (ghost) {
    // 重影只画一层半透明色
    ctx.strokeStyle = "rgba(190,255,170,.85)";
    for (let i = body.length - 1; i > 0; i--) {
      strokeSegment(body[i], body[i - 1], 0);
    }
  } else {
    // 影子
    ctx.fillStyle = "rgba(0,0,0,.16)";
    for (let i = 0; i < body.length; i += 2) {
      ctx.beginPath();
      ctx.arc(body[i].x + 3, body[i].y + 4, body[i].r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 第一遍：黑色描边（比身体粗一圈）
    ctx.strokeStyle = INK;
    for (let i = body.length - 1; i > 0; i--) {
      strokeSegment(body[i], body[i - 1], 7);
    }

    // 第二遍：身体底色
    ctx.strokeStyle = "#8ee04f";
    for (let i = body.length - 1; i > 0; i--) {
      strokeSegment(body[i], body[i - 1], 0);
    }

    // 第三遍：背上的斑点
    ctx.fillStyle = "#b7f07a";
    for (let i = 5; i < body.length - 1; i += 5) {
      ctx.beginPath();
      ctx.arc(body[i].x, body[i].y, body[i].r * 0.46, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawSnakeHead(g, ghost);
  ctx.restore();
}

function strokeSegment(a, b, pad) {
  ctx.lineWidth = ((a.r + b.r) / 2) * 2 + pad;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawSnakeHead(g, ghost) {
  const s = g.snake;
  const hr = CFG.headRadius;

  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle);

  const rx = hr * 1.34;
  const ry = hr * 1.08;

  if (!ghost) {
    // 黑边底座：比头再大一圈，形成粗描边
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(2, 1, rx + 3.5, ry + 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 头
  ctx.fillStyle = ghost ? "rgba(190,255,170,.8)" : "#9ae85a";
  ctx.beginPath();
  ctx.ellipse(2, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!ghost) {
    // 头顶浅色块
    ctx.fillStyle = "#b7f07a";
    ctx.beginPath();
    ctx.ellipse(0, -ry * 0.34, rx * 0.74, ry * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    // 眼睛
    for (const sy of [-1, 1]) {
      const ex = rx * 0.40;
      const ey = sy * ry * 0.50;

      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(ex, ey, hr * 0.40, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#fff8e7";
      ctx.beginPath();
      ctx.arc(ex + 1, ey, hr * 0.30, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(ex + 2.4, ey, hr * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }

    // 舌头：越醉吐得越勤越长
    const tl = 9 + Math.abs(Math.sin(g.t * (4 + g.drunk * 8))) * (9 + 15 * g.drunk);
    const tx = rx + 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tx, 0);
    ctx.lineTo(tx + tl, 0);
    ctx.moveTo(tx + tl, 0);
    ctx.lineTo(tx + tl + 5, -4);
    ctx.moveTo(tx + tl, 0);
    ctx.lineTo(tx + tl + 5, 4);

    ctx.strokeStyle = INK;
    ctx.lineWidth = 6.5;
    ctx.stroke();
    ctx.strokeStyle = "#ff3d7f";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.restore();
}

function drawParticles(g) {
  for (const p of g.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// 飘字（+1 / TIPSY 之类），漫画描边字
function drawPopups(g) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.lineJoin = "round";

  for (const p of g.popups) {
    ctx.globalAlpha = Math.min(1, p.life / 0.5);
    ctx.font = '900 ' + p.size + 'px "Arial Black", Impact, sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = INK;
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// 醉酒：画面四周压一圈平涂紫框，越醉越厚
function drawDrunkOverlay(sway) {
  if (sway > 0.02) {
    const t = 6 + 46 * sway;
    ctx.fillStyle = "rgba(58,26,92,.45)";
    ctx.fillRect(0, 0, W, t);
    ctx.fillRect(0, H - t, W, t);
    ctx.fillRect(0, 0, t, H);
    ctx.fillRect(W - t, 0, t, H);

    ctx.fillStyle = "rgba(58,26,92," + (0.12 * sway) + ")";
    ctx.fillRect(0, 0, W, H);
  }

  if (game.flash > 0) {
    ctx.fillStyle = "rgba(255,255,255," + (game.flash * 0.3) + ")";
    ctx.fillRect(0, 0, W, H);
  }
}

/* ---------------------------------------------------------
   9. HUD
   --------------------------------------------------------- */
function updateHud() {
  const g = game;
  if (!g) return;

  elBottles.textContent = g.bottles;
  elFill.style.width = Math.round(g.drunk * 100) + "%";
  elSpeed.textContent = "SPEED " + Math.round(g.snake.speed);
  sound.setRate(1 + AUDIO.musicRate * g.drunk);   // 越醉 BGM 越快

  let stage = 0;
  for (let i = 0; i < DRUNK_STAGES.length; i++) {
    if (g.drunk < DRUNK_STAGES[i].limit) { stage = i; break; }
  }

  elDrunkText.textContent = DRUNK_STAGES[stage].label;
  elFill.style.background = DRUNK_STAGES[stage].color;
  elDrunkText.style.color = DRUNK_STAGES[stage].color;

  // 跨过阶段时在画面中间喊一嗓子
  if (stage !== g.drunkStage) {
    g.drunkStage = stage;
    if (g.bottles > 0) {
      addPopup(W * 0.5, H * 0.32, DRUNK_STAGES[stage].label, 40, DRUNK_STAGES[stage].color);
      sound.play("stage");
    }
  }
}

/* ---------------------------------------------------------
   10. 流程
   --------------------------------------------------------- */
function showStart() {
  startPanel.hidden = false;
  overPanel.hidden = true;
  overlay.classList.add("show");
}

function showGameOver() {
  let stage = DRUNK_STAGES[DRUNK_STAGES.length - 1];
  for (const item of DRUNK_STAGES) {
    if (game.drunk < item.limit) { stage = item; break; }
  }

  elOverReason.textContent = game.reason;
  elOverCount.textContent = game.bottles;
  elOverLabel.textContent = stage.label;
  elOverLabel.style.color = stage.color;

  startPanel.hidden = true;
  overPanel.hidden = false;
  overlay.classList.add("show");
}

function start() {
  overlay.classList.remove("show");
  createGame();
  updateHud();
  sound.play("start");
  sound.playMusic(true);   // 每局从 BGM 开头放
}

document.getElementById("startBtn").addEventListener("click", start);
document.getElementById("overBtn").addEventListener("click", start);

/* ---------------------------------------------------------
   11. 主循环
   --------------------------------------------------------- */
let lastTime = performance.now();

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  if (game && game.running) update(dt);
  if (game) draw();

  requestAnimationFrame(loop);
}

window.addEventListener("resize", resize);
resize();

/* 开发调试开关：
   index.html?auto=1            跳过开始界面直接开局
   index.html?auto=1&bottles=9  开局前先灌 9 瓶，直接进醉酒状态 */
const DEBUG = new URLSearchParams(location.search);

if (DEBUG.has("auto")) {
  start();
  const pre = parseInt(DEBUG.get("bottles") || "0", 10);
  for (let i = 0; i < pre; i++) {
    game.food = { x: game.snake.x, y: game.snake.y, rot: 0, bob: 0 };
    update(1 / 60);
  }
  game.popups.length = 0;     // 预灌的飘字会叠在一起，清掉
  game.particles.length = 0;
} else {
  showStart();
}

requestAnimationFrame(loop);
