// 预览 iframe 没有 allow-same-origin，学生代码里访问 localStorage 会抛异常。
// 这里在学生代码之前注入一个替身：数据先放在 iframe 的内存里；
// 自己编辑器里的预览再通过 postMessage 交给主页面，存到本站 localStorage 的独立 key 下，
// 下次渲染时注入回去，所以刷新、改代码后数据还在。看别人的作品时只存在内存里。

const KEY_PREFIX = "preview-storage:"
// 本站的登录 token 也在 localStorage 里（配额约 5MB），预览数据不能把它挤满
const SCOPE_MAX_CHARS = 100_000
const TOTAL_MAX_CHARS = 500_000
const MESSAGE_TYPE = "preview-storage"

export interface PreviewStorage {
  scope: string
  data: Record<string, string>
}

// 在 iframe 里运行，必须自成一体（不能引用外面的变量）
const SHIM = `(function (config, maxChars, type) {
  function create(initial, persist) {
    var data = new Map(Object.entries(initial || {}))
    function post(msg) {
      if (!persist) return
      msg.type = type
      msg.scope = config.scope
      parent.postMessage(msg, "*")
    }
    function size() {
      var n = 0
      data.forEach(function (v, k) { n += k.length + v.length })
      return n
    }
    var api = {
      getItem: function (k) {
        k = String(k)
        return data.has(k) ? data.get(k) : null
      },
      setItem: function (k, v) {
        k = String(k)
        v = String(v)
        var old = data.has(k) ? k.length + data.get(k).length : 0
        if (size() - old + k.length + v.length > maxChars) {
          throw new DOMException("预览里的 localStorage 最多存 " + maxChars + " 个字符", "QuotaExceededError")
        }
        data.set(k, v)
        post({ op: "set", key: k, value: v })
      },
      removeItem: function (k) {
        k = String(k)
        if (data.delete(k)) post({ op: "remove", key: k })
      },
      clear: function () {
        data.clear()
        post({ op: "clear" })
      },
      key: function (i) {
        var keys = Array.from(data.keys())
        return i >= 0 && i < keys.length ? keys[i] : null
      },
    }
    var isApi = function (p) { return p === "length" || Object.prototype.hasOwnProperty.call(api, p) }
    // 支持 localStorage.foo = 1、localStorage["foo"]、Object.keys(localStorage) 这些写法
    return new Proxy({}, {
      get: function (_, p) {
        if (p === "length") return data.size
        if (isApi(p)) return api[p]
        if (typeof p === "string" && data.has(p)) return data.get(p)
        return undefined
      },
      set: function (_, p, v) {
        if (typeof p === "string" && !isApi(p)) api.setItem(p, v)
        return true
      },
      deleteProperty: function (_, p) {
        if (typeof p === "string") api.removeItem(p)
        return true
      },
      has: function (_, p) {
        return isApi(p) || (typeof p === "string" && data.has(p))
      },
      ownKeys: function () {
        return Array.from(data.keys())
      },
      getOwnPropertyDescriptor: function (_, p) {
        if (typeof p !== "string" || !data.has(p)) return undefined
        return { value: data.get(p), writable: true, enumerable: true, configurable: true }
      },
    })
  }
  function define(name, value) {
    try {
      Object.defineProperty(window, name, { value: value, configurable: true })
    } catch (e) {}
  }
  define("localStorage", create(config && config.data, !!config))
  define("sessionStorage", create(null, false))
})`

// storage 不传时只存在内存里
export function storageShim(storage?: PreviewStorage) {
  // 防止数据里的 </script> 提前结束脚本
  const config = JSON.stringify(storage ?? null).replace(/</g, "\\u003c")
  return `<script>${SHIM}(${config}, ${SCOPE_MAX_CHARS}, "${MESSAGE_TYPE}")<\/script>`
}

interface Saved {
  // 最后写入时间，总量超了先删最久没用的
  t: number
  d: Record<string, string>
}

function read(key: string): Saved | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null")
    return saved && typeof saved.d === "object" ? saved : null
  } catch {
    return null
  }
}

export function loadPreviewStorage(scope: string): PreviewStorage {
  return { scope, data: read(KEY_PREFIX + scope)?.d ?? {} }
}

function previewKeys() {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(KEY_PREFIX)) keys.push(k)
  }
  return keys
}

function evictOthers(keep: string, all: boolean) {
  const others = previewKeys()
    .filter((k) => k !== keep)
    .map((k) => ({ k, t: read(k)?.t ?? 0, n: localStorage.getItem(k)!.length }))
    .sort((a, b) => a.t - b.t)
  let total = others.reduce((n, o) => n + o.n, 0) + (localStorage.getItem(keep)?.length ?? 0)
  for (const o of others) {
    if (!all && total <= TOTAL_MAX_CHARS) break
    localStorage.removeItem(o.k)
    total -= o.n
  }
}

function save(scope: string, data: Record<string, string>) {
  const key = KEY_PREFIX + scope
  const value = JSON.stringify({ t: Date.now(), d: data } satisfies Saved)
  try {
    localStorage.setItem(key, value)
    evictOthers(key, false)
  } catch {
    // 配额满了：清掉别的预览数据再试一次，还不行就不存了
    try {
      evictOthers(key, true)
      localStorage.setItem(key, value)
    } catch {}
  }
}

function apply(scope: string, msg: any) {
  const data = { ...loadPreviewStorage(scope).data }
  if (msg.op === "set") {
    if (typeof msg.key !== "string" || typeof msg.value !== "string") return
    data[msg.key] = msg.value
  } else if (msg.op === "remove") {
    if (typeof msg.key !== "string") return
    delete data[msg.key]
  } else if (msg.op === "clear") {
    for (const k of Object.keys(data)) delete data[k]
  } else {
    return
  }
  const size = Object.entries(data).reduce((n, [k, v]) => n + k.length + v.length, 0)
  if (size > SCOPE_MAX_CHARS) return
  save(scope, data)
}

// 在 win 上接收 iframe 发来的写入。只认这个 iframe、这个 scope 的消息；返回取消监听的函数
export function listenPreviewStorage(
  win: Window,
  frame: () => HTMLIFrameElement | null | undefined,
  scope: () => string,
) {
  const handler = (e: MessageEvent) => {
    const s = scope()
    if (!s || !e.data || e.data.type !== MESSAGE_TYPE || e.data.scope !== s) return
    if (!frame() || e.source !== frame()!.contentWindow) return
    apply(s, e.data)
  }
  win.addEventListener("message", handler)
  return () => win.removeEventListener("message", handler)
}
