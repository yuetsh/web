// 游戏预览的辅助代码：在 Phaser、ZzFX、assets.js 之后，学生代码之前加载（见 src/utils/previewDocument.ts）。
// 1. 报错传给外层页面，学生点一下就能发给 AI 修
// 2. 内置素材：assets.js 里的素材按名字取用时才造成贴图（名字即贴图 key），多帧的有同名动画；
//    AI 自己画了同名贴图时用它自己的。贴图名写错时提示

// 3. “点击开始”：点了才启动游戏，预览拿到键盘焦点、声音也能播
// 4. 封面：开始后 3 秒截一张图传给外层页面；外层也可以随时要一张
// 5. 兼容 AI 常写的 Phaser 3 写法：group.children.iterate / each、textures.generate、setTintFill、Math.PI2
// 和外层页面的消息都带 source: "wp-game"（发出）/ "wp-parent"（收到）。
// 机房是 Chrome 105，只用那时就有的写法
;(function () {
  "use strict"

  var ASSETS = window.__WP_GAME_ASSETS
  var COVER_WIDTH = 400
  var COVER_DELAY_MS = 3000

  function post(msg) {
    msg.source = "wp-game"
    try {
      window.parent.postMessage(msg, "*")
    } catch (e) {}
  }

  // ── 1. 报错 ──

  // type 是 error（出错了）或 warning（Phaser 的警告、找不到素材）。
  // 同样的消息只报一次，总共最多 10 条：每帧都报的错不能刷屏
  var reported = {}
  var reportedCount = 0
  function report(type, message, line, col) {
    message = String(message)
    var key = type + "\n" + message
    if (reported[key] || reportedCount >= 10) return
    reported[key] = true
    reportedCount++
    post({ type: type, message: message, line: line || null, col: col || null })
  }
  function reportError(message, line, col) {
    report("error", message, line, col)
  }
  window.addEventListener("error", function (e) {
    reportError(e.error && e.error.message ? e.error.message : e.message, e.lineno, e.colno)
  })
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason
    reportError(r && r.message ? r.message : r)
  })
  // Phaser 的很多问题只打在控制台（如 Missing animation: xxx），学生看不到控制台
  ;["error", "warn"].forEach(function (level) {
    var original = console[level]
    console[level] = function () {
      try {
        report(level === "error" ? "error" : "warning", Array.prototype.map.call(arguments, String).join(" "))
      } catch (e) {}
      return original.apply(console, arguments)
    }
  })

  if (typeof Phaser === "undefined") {
    reportError("Phaser 没有加载成功")
    return
  }

  // ── 5. 兼容 Phaser 3 写法 ──

  // Phaser 4 的 group.children 是原生 Set，没有 Phaser 3 的 iterate / each / contains / getArray
  function defineOnce(obj, name, fn) {
    if (!(name in obj)) Object.defineProperty(obj, name, { value: fn, configurable: true, writable: true })
  }
  function iterate(callback, scope) {
    var extra = Array.prototype.slice.call(arguments, 2)
    var items = Array.from(this)
    for (var i = 0; i < items.length; i++) {
      if (callback.apply(scope, [items[i], i].concat(extra)) === false) break
    }
    return this
  }
  defineOnce(Set.prototype, "iterate", iterate)
  defineOnce(Set.prototype, "each", iterate)
  defineOnce(Set.prototype, "contains", function (v) {
    return this.has(v)
  })
  defineOnce(Set.prototype, "getArray", function () {
    return Array.from(this)
  })

  if (Phaser.Math && Phaser.Math.PI2 === undefined) Phaser.Math.PI2 = Math.PI * 2

  // setTintFill 在 Phaser 4 换成了 setTint + setTintMode(FILL)。Phaser 4 留了一个同名的空壳，
  // 只在控制台报错、返回 undefined（链式调用会崩），所以这里直接覆盖
  if (Phaser.TintModes) {
    Object.keys(Phaser.GameObjects).forEach(function (k) {
      var proto = Phaser.GameObjects[k] && Phaser.GameObjects[k].prototype
      if (proto && typeof proto.setTint === "function" && typeof proto.setTintMode === "function") {
        Object.defineProperty(proto, "setTintFill", {
          value: function () {
            this.setTint.apply(this, arguments)
            return this.setTintMode(Phaser.TintModes.FILL)
          },
          configurable: true,
          writable: true,
        })
      }
    })
  }

  // 像素画：Phaser 3 的 this.textures.generate(key, { data, pixelWidth, palette })，Phaser 4 删掉了。
  // data 每行一个字符串，每个字符一种颜色；调色板里没有的字符（如 . 和空格）是透明的
  var ARNE16 = {
    0: "#000000", 1: "#9D9D9D", 2: "#FFFFFF", 3: "#BE2633", 4: "#E06F8B", 5: "#493C2B", 6: "#A46422", 7: "#EB8931",
    8: "#F7E26B", 9: "#2F484E", A: "#44891A", B: "#A3CE27", C: "#1B2632", D: "#005784", E: "#31A2F2", F: "#B2DCEF",
  }
  var TextureManager = Phaser.Textures.TextureManager.prototype
  var AnimationManager = Phaser.Animations.AnimationManager.prototype

  // 内置素材用到时才创建：代码按名字取贴图（get）时，名字是内置素材又还没有，才把它造出来；
  // exists 不算用到。AI 常自己画同名的贴图（wall、player、coin…），还常写“exists 就不再画”，
  // 提前加好会把它的贴图顶掉。贴图名写错时 Phaser 不报错，只显示一个“缺图”方块，这里替它说一声
  var originalGet = TextureManager.get
  TextureManager.get = function (key) {
    if (typeof key === "string" && key && !this.list[key]) {
      if (!createBuiltin(this.game, key)) report("warning", "找不到素材「" + key + "」，看看名字有没有写错")
    }
    return originalGet.apply(this, arguments)
  }
  // 多帧的内置素材有同名动画：直接 play('enemy-bat') 时贴图可能还没造，先造出来
  var originalAnimGet = AnimationManager.get
  AnimationManager.get = function (key) {
    if (typeof key === "string" && !this.anims.has(key) && this.game) createBuiltin(this.game, key)
    return originalAnimGet.apply(this, arguments)
  }

  defineOnce(TextureManager, "generate", function (key, config) {
    config = config || {}
    var data = config.data || []
    var pw = config.pixelWidth || 1
    var ph = config.pixelHeight || pw
    var palette = config.palette || ARNE16
    var cols = data.reduce(function (n, row) {
      return Math.max(n, row.length)
    }, 0)
    var canvas = document.createElement("canvas")
    canvas.width = Math.max(1, cols * pw)
    canvas.height = Math.max(1, data.length * ph)
    var ctx = canvas.getContext("2d")
    data.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        var color = palette[row[x]]
        if (color === undefined || color === null) continue
        ctx.fillStyle = typeof color === "number" ? "#" + color.toString(16).padStart(6, "0") : color
        ctx.fillRect(x * pw, y * ph, pw, ph)
      }
    })
    if (this.exists(key)) this.remove(key)
    return this.addCanvas(key, canvas)
  })

  // ── 2. 内置素材 ──

  var sheetImages = {}
  var assetsReady = ASSETS
    ? Promise.all(
        Object.keys(ASSETS.sheets).map(function (name) {
          return new Promise(function (resolve, reject) {
            var img = new Image()
            img.onload = function () {
              sheetImages[name] = img
              resolve()
            }
            img.onerror = function () {
              reject(new Error("素材图集加载失败：" + name))
            }
            img.src = ASSETS.sheets[name].data
          })
        }),
      )
    : Promise.resolve()

  function drawCell(ctx, sheet, frame, x, y, scale) {
    var s = ASSETS.sheets[sheet]
    ctx.drawImage(
      sheetImages[sheet],
      (frame % s.cols) * s.size,
      Math.floor(frame / s.cols) * s.size,
      s.size,
      s.size,
      x,
      y,
      s.size * scale,
      s.size * scale,
    )
  }

  var builtins = {}
  if (ASSETS) {
    ASSETS.sprites.forEach(function (sp) {
      builtins[sp.name] = { sprite: sp }
    })
    ASSETS.backgrounds.forEach(function (bg) {
      builtins[bg.name] = { background: bg }
    })
  }

  // 造一个内置素材（名字即贴图 key；多帧的帧名 0、1、2…，并建同名动画）。不是内置素材或已经有了返回 false
  function createBuiltin(game, key) {
    var b = builtins.hasOwnProperty(key) ? builtins[key] : null
    if (!b || !game || !game.textures || game.textures.list[key]) return false
    // 图集还没加载完（游戏要等它加载完才启动，正常不会走到这里）
    if (!sheetImages[(b.sprite || b.background).sheet]) return false
    var textures = game.textures
    var canvas = document.createElement("canvas")
    var ctx
    if (b.background) {
      // 整张 800×600 背景：上面铺天空格子，倒数第二行剪影，最后一行填充，放大 4 倍
      var bg = b.background
      canvas.width = 800
      canvas.height = 600
      ctx = canvas.getContext("2d")
      ctx.imageSmoothingEnabled = false
      var t = ASSETS.sheets[bg.sheet].size * 4
      var row = function (frame, y) {
        for (var x = 0; x < 800; x += t) drawCell(ctx, bg.sheet, frame, x, y, 4)
      }
      for (var y = 0; y < 600 - 2 * t; y += t) row(bg.top, y)
      row(bg.middle, 600 - 2 * t)
      row(bg.bottom, 600 - t)
      textures.addCanvas(key, canvas)
      return true
    }
    var sp = b.sprite
    var size = ASSETS.sheets[sp.sheet].size
    canvas.width = size * sp.frames.length
    canvas.height = size
    ctx = canvas.getContext("2d")
    sp.frames.forEach(function (f, i) {
      drawCell(ctx, sp.sheet, f, i * size, 0, 1)
    })
    var tex = textures.addCanvas(key, canvas)
    if (!tex || sp.frames.length < 2) return true
    sp.frames.forEach(function (_, i) {
      tex.add(i, 0, i * size, 0, size, size)
    })
    if (game.anims && !game.anims.anims.has(key)) {
      game.anims.create({
        key: key,
        frames: sp.frames.map(function (_, i) {
          return { key: key, frame: i }
        }),
        frameRate: 6,
        repeat: -1,
      })
    }
    return true
  }

  // ── 3. 点击开始 ──

  var games = []
  var started = false
  var startWaiters = []
  var overlay = null

  function start() {
    if (started) return
    started = true
    if (overlay) overlay.remove()
    window.focus()
    try {
      // ZzFX 的 AudioContext 要在用户点击后才能出声
      if (typeof zzfxX !== "undefined" && zzfxX.state === "suspended") zzfxX.resume()
    } catch (e) {}
    post({ type: "started" })
    startWaiters.splice(0).forEach(function (fn) {
      fn()
    })
  }

  function showOverlay() {
    if (overlay || started) return
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", showOverlay)
      return
    }
    overlay = document.createElement("div")
    overlay.setAttribute(
      "style",
      "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;" +
        "justify-content:center;gap:12px;background:rgba(15,18,30,.88);color:#fff;cursor:pointer;" +
        "font:600 28px/1.4 system-ui,'PingFang SC','Microsoft YaHei',sans-serif;user-select:none",
    )
    overlay.innerHTML =
      '<div style="padding:14px 36px;border:3px solid #fff;border-radius:12px">▶ 点击开始</div>' +
      '<div style="font-size:14px;font-weight:400;opacity:.75">点一下才能用键盘操作、听到声音</div>'
    overlay.addEventListener("click", start)
    document.body.appendChild(overlay)
  }

  function whenStarted(fn) {
    if (started) fn()
    else startWaiters.push(fn)
  }

  // ── 4. 封面 ──

  function snapshot(game, type) {
    if (!game.renderer || !game.renderer.snapshot) return
    game.renderer.snapshot(function (img) {
      if (!img || !img.width) return
      var canvas = document.createElement("canvas")
      canvas.width = COVER_WIDTH
      canvas.height = Math.round((COVER_WIDTH * img.height) / img.width)
      var ctx = canvas.getContext("2d")
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      try {
        post({ type: type, dataUrl: canvas.toDataURL("image/png") })
      } catch (e) {
        reportError("截图失败：" + e.message)
      }
    })
  }

  window.addEventListener("message", function (e) {
    var d = e.data
    if (!d || d.source !== "wp-parent") return
    if (d.type === "snapshot" && games.length) snapshot(games[games.length - 1], "snapshot")
    if (d.type === "start") start()
  })

  // ── 接管 Phaser.Game ──

  var OriginalGame = Phaser.Game
  var originalBoot = OriginalGame.prototype.boot

  // 构造时 Phaser 已经用 DOMContentLoaded 排好了 boot；把 boot 推迟到素材加载完、学生点了开始
  OriginalGame.prototype.boot = function () {
    var game = this
    assetsReady
      .then(function () {
        whenStarted(function () {
          originalBoot.call(game)
          games.push(game)
          setTimeout(function () {
            snapshot(game, "cover")
          }, COVER_DELAY_MS)
        })
      })
      .catch(function (err) {
        reportError(err && err.message ? err.message : err)
      })
  }

  // 默认：像素风不模糊，画面按比例缩放到预览大小并居中。学生（AI）自己写了的以学生的为准
  function GameWithDefaults(config) {
    config = config || {}
    if (config.pixelArt === undefined && !(config.render && config.render.pixelArt !== undefined)) {
      config.pixelArt = true
    }
    if (!config.scale) {
      config.scale = { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }
    }
    showOverlay()
    return new OriginalGame(config)
  }
  GameWithDefaults.prototype = OriginalGame.prototype
  Object.keys(OriginalGame).forEach(function (k) {
    GameWithDefaults[k] = OriginalGame[k]
  })
  Phaser.Game = GameWithDefaults
})()
