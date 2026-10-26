import { describe, expect, test } from "bun:test"
import { pyRound, pySum } from "../src/services/pyround"
import { extractCode, parseGuidanceResponse } from "../src/services/llm"
import { checkPassword, makePassword } from "../src/auth"
import { formatMicros, iso, uuidHex, uuidOut } from "../src/db"
import { toCsv } from "../src/services/gradebook"

describe("pyRound", () => {
  test("银行家舍入，与 Python round() 一致", () => {
    expect(pyRound(2.5)).toBe(2)
    expect(pyRound(3.5)).toBe(4)
    expect(pyRound(0.125, 2)).toBe(0.12)
    expect(pyRound(0.375, 2)).toBe(0.38)
    // 2.675 的二进制值略小于 2.675
    expect(pyRound(2.675, 2)).toBe(2.67)
    expect(pyRound(1 / 3, 2)).toBe(0.33)
    expect(pyRound(95.5)).toBe(96)
  })
})

describe("pySum", () => {
  test("补偿求和，与 Python 3.12+ 的 sum() 一致", () => {
    expect(pySum([0.1, 0.2, 0.3])).toBe(0.6)
    expect(pySum([1e100, 1, -1e100])).toBe(1)
    expect(pySum([])).toBe(0)
  })
})

describe("extractCode", () => {
  test("单个 html 代码块拆出 style 和 script", () => {
    const text = "说明\n```html\n<style>\na{}\n</style>\n<a>x</a>\n<script>\nf()\n</script>\n```"
    expect(extractCode(text)).toEqual({ html: "<a>x</a>", css: "a{}", js: "f()" })
  })
  test("分开的代码块（旧格式）", () => {
    const text = "```html\n<p/>\n```\n```css\np{}\n```\n```javascript\nx()\n```"
    expect(extractCode(text)).toEqual({ html: "<p/>", css: "p{}", js: "x()" })
  })
  test("没有代码块", () => {
    expect(extractCode("hello")).toEqual({ html: null, css: null, js: null })
  })
})

test("parseGuidanceResponse", () => {
  expect(parseGuidanceResponse("[READY]\n\n好")).toEqual(["好", true])
  expect(parseGuidanceResponse("再想想")).toEqual(["再想想", false])
})

test("兼容 Django 的 pbkdf2 密码哈希", async () => {
  // 由 Django 的 PBKDF2PasswordHasher 生成的 "secret" 的哈希
  const django = "pbkdf2_sha256$1000$abcdefghijklmnopqrstuv$1nE4fvOmiD+ZePp39y6TYTXfkn5HEwJDyz8e6UkQE1w="
  expect(await checkPassword("secret", django)).toBe(true)
  expect(await checkPassword("Secret", django)).toBe(false)
  expect(await checkPassword("secret", await makePassword("secret"))).toBe(true)
  expect(await checkPassword("wrong", await makePassword("secret"))).toBe(false)
  expect(await checkPassword("secret", "bcrypt$xxx")).toBe(false)
})

test("时间与 UUID 格式", () => {
  expect(formatMicros(Date.UTC(2026, 0, 2, 3, 4, 5) * 1000 + 678901)).toBe("2026-01-02 03:04:05.678901")
  expect(iso("2026-01-02 03:04:05.678901")).toBe("2026-01-02T03:04:05.678Z")
  const hex = "0123456789abcdef0123456789abcdef"
  expect(uuidOut(hex)).toBe("01234567-89ab-cdef-0123-456789abcdef")
  expect(uuidHex("01234567-89AB-cdef-0123-456789abcdef")).toBe(hex)
  expect(uuidHex("nope")).toBeNull()
})

test("CSV 转义", () => {
  expect(toCsv([["a", 'b"c', "d,e"], [1, 2.5, ""]])).toBe('a,"b""c","d,e"\r\n1,2.5,\r\n')
})
