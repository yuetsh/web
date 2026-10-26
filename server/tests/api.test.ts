import { beforeEach, describe, expect, test } from "bun:test"
import { get, all } from "../src/db"
import { app } from "../src/app"
import { config } from "../src/config"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PASSWORD, client, freshDb, makeSubmission, makeTask, makeUser, uuid } from "./helpers"

beforeEach(freshDb)

describe("权限", () => {
  test("未登录 401，角色不够 403", async () => {
    makeUser("stu")
    makeUser("adm", "admin")
    expect((await (await client())("GET", "/api/submission/")).status).toBe(401)
    const stu = await client("stu")
    expect((await stu("GET", "/api/challenge/list")).status).toBe(403)
    expect((await stu("GET", "/api/submission/gradebook/?classname=a")).status).toBe(403)
    const adm = await client("adm")
    expect((await adm("GET", "/api/challenge/list")).status).toBe(200)
    expect((await adm("GET", "/api/submission/gradebook/?classname=a")).status).toBe(403)
  })

  test("未公开的教程只有超管能看，未公开的挑战管理员也能看", async () => {
    makeUser("stu")
    makeUser("adm", "admin")
    makeUser("boss", "super")
    makeTask("草稿教程", "tutorial", 1, false)
    makeTask("草稿挑战", "challenge", 2, false)
    makeTask("公开挑战", "challenge", 3, true)
    const [anon, stu, adm, boss] = await Promise.all([client(), client("stu"), client("adm"), client("boss")])
    for (const path of ["/api/tutorial/1", "/api/challenge/2", "/api/assets/challenge/2"]) {
      expect((await anon("GET", path)).status).toBe(404)
      expect((await stu("GET", path)).status).toBe(404)
    }
    expect((await stu("GET", "/api/challenge/3")).status).toBe(200)
    expect((await adm("GET", "/api/tutorial/1")).status).toBe(404)
    expect((await adm("GET", "/api/challenge/2")).status).toBe(200)
    expect((await adm("GET", "/api/assets/challenge/2")).status).toBe(200)
    expect((await boss("GET", "/api/tutorial/1")).status).toBe(200)
  })

  test("没有公开注册接口", async () => {
    const res = await (await client())("POST", "/api/account/register", {
      username: "x",
      email: "x@x.com",
      password: "123456",
    })
    expect(res.status).toBe(404)
  })

  test("同一用户名连续登录失败 10 次后暂停登录", async () => {
    makeUser("brute")
    const anon = await client()
    for (let i = 0; i < 10; i++) {
      expect((await anon("POST", "/api/account/login", { username: "brute", password: "wrong" })).status).toBe(401)
    }
    // 密码对了也要等窗口过去
    const res = await anon("POST", "/api/account/login", { username: "brute", password: PASSWORD })
    expect(res.status).toBe(429)
  })

  test("封号后 access token 和 refresh token 都失效", async () => {
    const id = makeUser("stu")
    makeUser("boss", "super")
    const stu = await client("stu")
    expect((await stu("GET", "/api/account/profile")).json.username).toBe("stu")
    await (await client("boss"))("PUT", `/api/account/active/${id}`)
    expect((await stu("GET", "/api/account/profile")).status).toBe(401)
    const anon = await client()
    const res = await anon("POST", "/api/account/refresh", { refresh_token: stu.tokens.refresh_token })
    expect(res.status).toBe(401)
  })
})

describe("JWT 登录", () => {
  test("登录返回两个 token，refresh token 能换新的 access token", async () => {
    makeUser("stu")
    const stu = await client("stu")
    expect(stu.tokens.access_token.split(".")).toHaveLength(3)
    expect(get(`SELECT token_hash FROM auth_refresh_token`).token_hash).not.toBe(stu.tokens.refresh_token)

    const anon = await client()
    const res = await anon("POST", "/api/account/refresh", { refresh_token: stu.tokens.refresh_token })
    expect(res.status).toBe(200)
    stu.tokens.access_token = res.json.access_token
    expect((await stu("GET", "/api/account/profile")).json.username).toBe("stu")
  })

  test("无效或过期的 access token 返回 401，不带 token 当作未登录", async () => {
    makeUser("stu")
    const stu = await client("stu")
    const { sign } = await import("hono/jwt")
    const { config } = await import("../src/config")
    const userId = get(`SELECT id FROM account_user WHERE username = 'stu'`).id
    stu.tokens.access_token = await sign({ sub: userId, exp: Math.floor(Date.now() / 1000) - 1 }, config.jwtSecret)
    expect((await stu("GET", "/api/account/profile")).status).toBe(401)
    stu.tokens.access_token = "garbage"
    expect((await stu("GET", "/api/account/profile")).status).toBe(401)
    expect((await (await client())("GET", "/api/account/profile")).json.username).toBe("")
  })

  test("退出和改密码都会作废 refresh token", async () => {
    const id = makeUser("stu")
    makeUser("boss", "super")
    const anon = await client()
    const a = await client("stu")
    expect((await a("POST", "/api/account/logout", { refresh_token: a.tokens.refresh_token })).status).toBe(200)
    expect((await anon("POST", "/api/account/refresh", { refresh_token: a.tokens.refresh_token })).status).toBe(401)

    const b = await client("stu")
    await (await client("boss"))("PUT", `/api/account/${id}`, { password: "newpass1" })
    expect((await anon("POST", "/api/account/refresh", { refresh_token: b.tokens.refresh_token })).status).toBe(401)
  })
})

describe("账号管理", () => {
  test("新建和修改用户", async () => {
    makeUser("boss", "super")
    const boss = await client("boss")
    const created = await boss("POST", "/api/account/create", { username: "new1", password: "abcdef", role: "admin" })
    expect(created.status).toBe(200)
    expect((await boss("POST", "/api/account/create", { username: "new1", password: "abcdef" })).status).toBe(400)
    expect((await boss("POST", "/api/account/create", { username: "new2", password: "abc" })).status).toBe(422)

    const id = created.json.id
    expect((await boss("PUT", `/api/account/${id}`, { role: "normal", classname: "10A", password: "zzzzzz" })).status).toBe(200)
    const row = get(`SELECT role, classname, raw_password FROM account_user WHERE id = $id`, { id })
    expect(row).toEqual({ role: "normal", classname: "10A", raw_password: "zzzzzz" })
    // 新密码能登录
    const { app } = await import("../src/app")
    const login = await app.request("/api/account/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "new1", password: "zzzzzz" }),
    })
    expect(login.status).toBe(200)
  })

  test("批量新建", async () => {
    makeUser("boss", "super")
    const boss = await client("boss")
    expect((await boss("POST", "/api/account/batch", { classname: "11C", names: ["张三", "李四"] })).status).toBe(200)
    expect((await boss("POST", "/api/account/batch", { classname: "11C", names: ["张三"] })).status).toBe(400)
    const names = await boss("GET", "/api/account/names?classname=11C")
    expect(names.json).toEqual([
      { name: "张三", username: "web11C张三" },
      { name: "李四", username: "web11C李四" },
    ])
    const list = await boss("GET", "/api/account/list?username=web11&page=1")
    expect(list.json.count).toBe(2)
    expect(list.json.items[0].raw_password).toMatch(/^[2-9]{6}$/)
  })
})

describe("评分", () => {
  test("角色加权 + 贝叶斯平滑 + 分区", async () => {
    const author = makeUser("author")
    makeUser("boss", "super")
    makeUser("adm", "admin")
    for (let i = 0; i < 3; i++) makeUser(`s${i}`)
    const task = makeTask("T")
    const sub = makeSubmission(author, task)

    await (await client("boss"))("PUT", `/api/submission/${uuid(sub)}/score`, { score: 5 })
    await (await client("adm"))("PUT", `/api/submission/${uuid(sub)}/score`, { score: 3 })
    let row = get(`SELECT raw_score, score, zone FROM submission_submission WHERE id = $id`, { id: sub })
    // raw = (5*0.5 + 3*0.3) / 0.8；没有别的提交，先验就是自己
    expect(row.raw_score).toBeCloseTo(4.25)
    expect(row.score).toBeCloseTo(4.25)
    expect(row.zone).toBe("pending")

    for (let i = 0; i < 3; i++) {
      await (await client(`s${i}`))("PUT", `/api/submission/${uuid(sub)}/score`, { score: 5 })
    }
    row = get(`SELECT score, zone FROM submission_submission WHERE id = $id`, { id: sub })
    expect(row.zone).toBe("featured")

    const again = await (await client("s0"))("PUT", `/api/submission/${uuid(sub)}/score`, { score: 1 })
    expect(again.json.message).toBe("你已经给这个提交打过分了")
    expect((await (await client("s0"))("PUT", `/api/submission/${uuid(sub)}/score`, { score: 0 })).status).toBe(400)
    expect((await (await client("s1"))("PUT", `/api/submission/${uuid(sub)}/score`, { score: 6 })).status).toBe(422)
    const self = await (await client("author"))("PUT", `/api/submission/${uuid(sub)}/score`, { score: 5 })
    expect(self.status).toBe(400)
    expect(all(`SELECT 1 FROM submission_rating WHERE user_id = $id`, { id: author })).toEqual([])
  })
})

describe("随机评分", () => {
  test("不给自己的、已评过的；没有可评的返回 null", async () => {
    const me = makeUser("me")
    const other = makeUser("other")
    const task = makeTask("T")
    makeSubmission(me, task)
    const subs = Array.from({ length: 5 }, () => makeSubmission(other, task))
    const c = await client("me")
    const seen = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const res = await c("GET", "/api/submission/random-for-rating")
      expect(subs.map(uuid)).toContain(res.json.submission_id)
      expect(seen.has(res.json.submission_id)).toBe(false)
      seen.add(res.json.submission_id)
      await c("PUT", `/api/submission/${res.json.submission_id}/score`, { score: 4 })
    }
    expect((await c("GET", "/api/submission/random-for-rating")).json).toBeNull()
  })
})

describe("提交与删除", () => {
  test("手写提示词提交会生成对话，删除提交连带删除提示词", async () => {
    makeUser("stu")
    const task = makeTask("T")
    const stu = await client("stu")
    const res = await stu("POST", "/api/submission/", { task_id: task, html: "<p>", prompt: "做个页面" })
    expect(res.status).toBe(200)
    const msgs = all(`SELECT role, source, submission_id FROM prompt_message ORDER BY id`)
    expect(msgs.map((m) => [m.role, m.source])).toEqual([
      ["user", "manual"],
      ["assistant", "manual"],
    ])
    const chain = await stu("GET", `/api/submission/${res.json.id}/prompt-chain`)
    expect(chain.json[0].question).toBe("做个页面")

    expect((await stu("DELETE", `/api/submission/${res.json.id}`)).status).toBe(200)
    expect(all(`SELECT * FROM prompt_message`)).toEqual([])
  })

  test("保存手改 / 外部 AI 版本，交这一版时关联到它", async () => {
    makeUser("stu")
    const task = makeTask("T")
    const stu = await client("stu")
    const edit = await stu("POST", "/api/prompt/versions", { task_id: task, html: "<p>1", css: "", js: "" })
    expect(edit.json.source).toBe("edit")
    const ext = await stu("POST", "/api/prompt/versions", {
      task_id: task,
      html: "<p>2",
      css: "",
      js: "",
      prompt: "用外部 AI 做的",
    })
    expect(ext.json.source).toBe("manual")
    const history = await stu("GET", `/api/prompt/history/${task}`)
    expect(history.json.map((h: any) => [h.source, h.prompt])).toEqual([
      ["edit", "（手动修改了代码）"],
      ["manual", "用外部 AI 做的"],
    ])

    const sub = await stu("POST", "/api/submission/", { task_id: task, html: "<p>1", message_id: edit.json.message_id })
    const linked = get(`SELECT submission_id FROM prompt_message WHERE id = $id`, { id: edit.json.message_id })
    expect(linked.submission_id).toBe(sub.json.id.replaceAll("-", ""))
    // 同一个版本再交一次，更新原来的提交，不新建
    await stu("POST", "/api/submission/", { task_id: task, html: "<p>1!", message_id: edit.json.message_id })
    expect(all(`SELECT html FROM submission_submission`)).toEqual([{ html: "<p>1!" }])
  })

  test("删除一轮对话：连带提问和关联提交；被评过分的不能删", async () => {
    makeUser("stu")
    makeUser("other")
    const task = makeTask("T")
    const stu = await client("stu")
    const first = await stu("POST", "/api/submission/", { task_id: task, html: "<p>1", prompt: "第一版" })
    const second = await stu("POST", "/api/submission/", { task_id: task, html: "<p>2", prompt: "第二版" })
    const asstOf = (sub: string) =>
      get(`SELECT id FROM prompt_message WHERE submission_id = $id`, { id: sub.replaceAll("-", "") })!.id

    await (await client("other"))("PUT", `/api/submission/${second.json.id}/score`, { score: 4 })
    expect((await stu("DELETE", `/api/prompt/messages/${asstOf(second.json.id)}/pair`)).status).toBe(400)

    const res = await stu("DELETE", `/api/prompt/messages/${asstOf(first.json.id)}/pair`)
    expect(res.json).toEqual({ deleted: true, submission_deleted: true })
    expect(all(`SELECT content FROM prompt_message WHERE role = 'user'`)).toEqual([{ content: "第二版" }])
    expect(all(`SELECT COUNT(*) AS n FROM submission_submission`)).toEqual([{ n: 1 }])
  })

  test("被评分的提交只有超管能删", async () => {
    const author = makeUser("author")
    makeUser("other")
    makeUser("boss", "super")
    const sub = makeSubmission(author, makeTask("T"))
    await (await client("other"))("PUT", `/api/submission/${uuid(sub)}/score`, { score: 4 })
    expect((await (await client("author"))("DELETE", `/api/submission/${uuid(sub)}`)).status).toBe(400)
    expect((await (await client("boss"))("DELETE", `/api/submission/${uuid(sub)}`)).status).toBe(200)
    expect(all(`SELECT * FROM submission_rating`)).toEqual([])
  })

  test("删除挑战级联删除提交和对话", async () => {
    const stu = makeUser("stu")
    makeUser("adm", "admin")
    const task = makeTask("T", "challenge", 3)
    makeSubmission(stu, task)
    await (await client("stu"))("POST", "/api/submission/", { task_id: task, html: "", prompt: "x" })
    expect((await (await client("adm"))("DELETE", "/api/challenge/3")).status).toBe(200)
    for (const t of ["task_task", "task_challenge", "submission_submission", "prompt_conversation", "prompt_message"]) {
      expect(all(`SELECT * FROM ${t}`)).toEqual([])
    }
  })

  test("分组列表只保留每人每题最新一条，并统计提交次数", async () => {
    const a = makeUser("alice")
    const task = makeTask("T")
    makeSubmission(a, task, 1, "2026-01-01 00:00:00.000000")
    const latest = makeSubmission(a, task, 2, "2026-01-02 00:00:00.000000")
    const list = await (await client("alice"))("GET", "/api/submission?page=1")
    expect(list.json.count).toBe(1)
    expect(list.json.items[0].id).toBe(uuid(latest))
    expect(list.json.items[0].submit_count).toBe(2)
    const all2 = await (await client("alice"))("GET", "/api/submission/?page=1&grouped=false")
    expect(all2.json.count).toBe(2)
  })
})

describe("成绩册", () => {
  async function superClient() {
    makeUser("boss", "super")
    return client("boss")
  }

  test("必须选择班级", async () => {
    const boss = await superClient()
    const res = await boss("GET", "/api/submission/gradebook/")
    expect(res.status).toBe(400)
    expect(res.json.detail).toBe("请选择班级")
  })

  test("覆盖率、总分与平均分", async () => {
    const boss = await superClient()
    const [alice, bob] = ["alice", "bob", "carol", "dave"].map((n) => makeUser(n, "normal", "10A"))
    const tutorial = makeTask("Intro", "tutorial", 1, false)
    const challenge = makeTask("Challenge One", "challenge", 1)
    const optional = makeTask("Optional", "challenge", 2)
    makeSubmission(alice!, tutorial, 4)
    makeSubmission(bob!, tutorial, 5)
    makeSubmission(alice!, challenge, 3)
    makeSubmission(bob!, challenge, 4)
    makeSubmission(alice!, optional, 5)

    const data = (await boss("GET", "/api/submission/gradebook/?classname=10A")).json
    expect(data.student_count).toBe(4)
    expect(data.coverage_threshold_count).toBe(2)
    expect(data.included_task_count).toBe(2)
    const row = data.rows.find((r: any) => r.username === "alice")
    expect([row.tutorial_total, row.challenge_total, row.total_score, row.average_score]).toEqual([4, 3, 7, 3.5])
    const carol = data.rows.find((r: any) => r.username === "carol")
    expect([carol.total_score, carol.submitted_task_count, carol.missing_task_count]).toEqual([0, 0, 2])

    const withAll = (await boss("GET", "/api/submission/gradebook/?classname=10A&include_all_tasks=true")).json
    const alice2 = withAll.rows.find((r: any) => r.username === "alice")
    expect(alice2.scores[String(optional)]).toMatchObject({ submitted: true, score: 5 })
    expect(alice2.total_score).toBe(7)
  })

  test("同分取最新的提交", async () => {
    const boss = await superClient()
    const alice = makeUser("alice", "normal", "10A")
    const task = makeTask("T")
    makeSubmission(alice, task, 4.5, "2026-01-01 00:00:00.000000")
    const newer = makeSubmission(alice, task, 4.5, "2026-01-02 00:00:00.000000")
    makeSubmission(alice, task, 3, "2026-01-03 00:00:00.000000")
    const data = (await boss("GET", "/api/submission/gradebook/?classname=10A")).json
    expect(data.rows[0].scores[String(task)].submission_id).toBe(uuid(newer))
  })

  test("等级按向上取整的名次划分", async () => {
    const boss = await superClient()
    const task = makeTask("Boundary", "challenge", 7)
    for (let i = 1; i <= 20; i++) {
      makeSubmission(makeUser(`s${String(i).padStart(2, "0")}`, "normal", "10B"), task, 21 - i)
    }
    const data = (await boss("GET", "/api/submission/gradebook/?classname=10B")).json
    const grade = Object.fromEntries(data.rows.map((r: any) => [r.username, r.grade]))
    expect([grade.s01, grade.s06, grade.s07, grade.s14, grade.s15, grade.s18, grade.s19, grade.s20]).toEqual([
      "A", "A", "B", "B", "C", "C", "D", "E",
    ])
    const score = Object.fromEntries(data.rows.map((r: any) => [r.username, r.assessment_score]))
    expect(score.s01).toBe(99)
    expect(score.s20).toBe(60)
  })

  test("导出 CSV", async () => {
    const boss = await superClient()
    const alice = makeUser("alice", "normal", "10A")
    const bob = makeUser("bob", "normal", "10A")
    const tutorial = makeTask("Intro", "tutorial", 1)
    makeSubmission(alice, tutorial, 4)
    makeSubmission(bob, tutorial, 2)
    makeSubmission(alice, makeTask("C", "challenge", 1), 5)
    const res = await boss("GET", "/api/submission/gradebook/export/?classname=10A&task_type=tutorial")
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(res.headers.get("content-disposition")).toContain("attachment;")
    const rows = res.text.replace(/^﻿/, "").trim().split("\r\n").map((l) => l.split(","))
    expect(rows[0]).toEqual([
      "排名", "平时等级", "考核等级", "考核分数", "用户名", "班级", "教程1-Intro",
      "教程合计", "挑战合计", "总分", "平均分", "已提交任务数", "未提交任务数",
    ])
    expect([rows[1]![4], rows[1]![6], rows[1]![9]]).toEqual(["alice", "4", "4"])
  })
})

describe("作品展", () => {
  test("下架或停用后前台看不到", async () => {
    const author = makeUser("author")
    makeUser("adm", "admin")
    const sub = makeSubmission(author, makeTask("T"), 4.5)
    const adm = await client("adm")
    const award = (await adm("POST", "/api/submission/showcase/manage/awards", { name: "最佳" })).json
    expect(award.item_count).toBe(0)
    const item = (await adm("POST", `/api/submission/showcase/manage/awards/${award.id}/items`, { submission_id: uuid(sub) })).json
    expect((await adm("POST", `/api/submission/showcase/manage/awards/${award.id}/items`, { submission_id: uuid(sub) })).json.detail).toBe("该作品已在奖项中")

    const author1 = await client("author")
    expect((await author1("GET", "/api/submission/showcase/")).json).toHaveLength(1)
    expect((await author1("GET", `/api/submission/showcase/${uuid(sub)}/`)).json.awards).toEqual(["最佳"])

    await adm("PUT", `/api/submission/showcase/manage/awards/${award.id}`, { name: "最佳", is_active: false })
    expect((await author1("GET", "/api/submission/showcase/")).json).toEqual([])
    expect((await author1("GET", `/api/submission/showcase/${uuid(sub)}/`)).status).toBe(404)

    await adm("DELETE", `/api/submission/showcase/manage/items/${item.id}`)
    expect((await adm("GET", "/api/submission/showcase/manage/awards")).json[0].item_count).toBe(0)
  })

  test("新提交让旧条目变为有更新，刷新后切到最新", async () => {
    makeUser("author")
    makeUser("adm", "admin")
    const task = makeTask("T")
    const author = await client("author")
    const first = (await author("POST", "/api/submission/", { task_id: task, html: "1" })).json.id
    const adm = await client("adm")
    const award = (await adm("POST", "/api/submission/showcase/manage/awards", { name: "A" })).json
    const item = (await adm("POST", `/api/submission/showcase/manage/awards/${award.id}/items`, { submission_id: first })).json
    const second = (await author("POST", "/api/submission/", { task_id: task, html: "2" })).json.id
    let items = (await adm("GET", `/api/submission/showcase/manage/awards/${award.id}/items`)).json
    expect(items[0].is_stale).toBe(true)
    const refreshed = (await adm("PUT", `/api/submission/showcase/manage/items/${item.id}/refresh`)).json
    expect(refreshed.submission_id).toBe(second)
    expect(refreshed.is_stale).toBe(false)
  })
})

describe("自由创作", () => {
  test("只有作者本人和超管能访问", async () => {
    makeUser("me")
    makeUser("you")
    makeUser("boss", "super")
    const me = await client("me")
    const c = (await me("POST", "/api/creation/", { title: "  作品  ", content: "d" })).json
    expect(c.title).toBe("作品")
    expect(c.display).toBe(1)
    expect((await me("POST", "/api/creation/", { title: " " })).status).toBe(400)
    expect((await (await client("you"))("GET", `/api/creation/${c.display}`)).status).toBe(403)
    expect((await (await client("boss"))("GET", `/api/creation/${c.display}`)).status).toBe(200)
    const saved = (await me("PUT", `/api/creation/${c.display}/code`, { html: "<p>" })).json
    expect(saved.html).toBe("<p>")
    expect((await me("GET", "/api/creation/mine")).json[0].has_code).toBe(true)
    expect((await me("POST", "/api/submission/", { task_id: c.task_id })).json.detail).toBe("自由创作不需要提交")
  })
})

describe("任务素材", () => {
  test("同名上传原地覆盖，文件名不合法 422", async () => {
    const media = await mkdtemp(join(tmpdir(), "media-"))
    const saved = config.mediaRoot
    config.mediaRoot = media
    try {
      makeUser("adm", "admin")
      makeTask("挑战", "challenge", 3)
      const adm = await client("adm")
      const upload = (name: string, body: string) => {
        const form = new FormData()
        form.append("name", name)
        form.append("file", new File([body], "x"))
        return app.request("/api/assets/challenge/3", {
          method: "POST",
          headers: { authorization: `Bearer ${adm.tokens.access_token}` },
          body: form,
        })
      }
      expect((await upload("a.css", "v1")).status).toBe(200)
      const res = await upload("a.css", "v2")
      expect(((await res.json()) as any).url).toBe("/media/tasks/challenge/3/a.css")
      const dir = join(media, "tasks/challenge/3")
      expect(await readdir(dir)).toEqual(["a.css"])
      expect(await readFile(join(dir, "a.css"), "utf8")).toBe("v2")
      for (const bad of ["a b.png", "../x.png", "a/b.png", "x#.png"]) {
        expect((await upload(bad, "x")).status).toBe(422)
      }
      expect((await adm("DELETE", "/api/assets/challenge/3/a.css")).status).toBe(200)
      expect(await readdir(dir)).toEqual([])
    } finally {
      config.mediaRoot = saved
      await rm(media, { recursive: true, force: true })
    }
  })
})
