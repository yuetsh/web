import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { all, get, run } from "../src/db"
import { app } from "../src/app"
import { config } from "../src/config"
import { createConversation, insertMessage } from "../src/services/prompt"
import { client, freshDb, makeUser } from "./helpers"

beforeEach(freshDb)

type Client = Awaited<ReturnType<typeof client>>

// 新建一个游戏并把一版代码存进对话，返回 display 和那条 AI 回复的 id
async function newGame(author: Client, ownerId: number, title = "接金币") {
  const res = await author("POST", "/api/game", { title })
  expect(res.status).toBe(200)
  const conv = createConversation(ownerId, res.json.task_id)
  insertMessage({ conversation_id: conv, role: "user", content: "做一个接金币的游戏" })
  const messageId = insertMessage({
    conversation_id: conv,
    role: "assistant",
    content: "**做了什么**：做了一个接金币的游戏。\n\n```html\n<script>new Phaser.Game({})</script>\n```",
    code_html: "",
    code_css: "",
    code_js: "new Phaser.Game({})",
  })
  return { display: res.json.display as number, taskId: res.json.task_id as number, messageId }
}

async function publish(author: Client, display: number, messageId: number, notes = "") {
  return author("POST", `/api/game/${display}/releases`, { message_id: messageId, notes, tags: ["catch"] })
}

describe("游戏：新建和发布", () => {
  test("新建是草稿，发布后进大厅，版本号递增，评分按版本重新算", async () => {
    const aliceId = makeUser("alice")
    makeUser("bob")
    const alice = await client("alice")
    const bob = await client("bob")
    const { display, messageId } = await newGame(alice, aliceId)

    // 草稿：别人看不到，大厅里没有
    expect((await bob("GET", `/api/game/${display}`)).status).toBe(404)
    expect((await bob("GET", "/api/game/hall")).json.count).toBe(0)

    const r1 = await publish(alice, display, messageId, "第一版")
    expect(r1.json).toEqual({ version: 1, status: "listed" })
    const page = await bob("GET", `/api/game/${display}`)
    expect(page.status).toBe(200)
    expect(page.json.code.js).toBe("new Phaser.Game({})")
    expect(page.json.tags).toEqual(["catch"])
    expect(page.json.author).toBe("alice")
    expect((await bob("GET", "/api/game/hall")).json.count).toBe(1)

    // 打分要先玩过
    expect((await bob("PUT", `/api/game/${display}/rating`, { stars: 5 })).status).toBe(400)
    expect((await bob("POST", `/api/game/${display}/play`)).json).toEqual({ counted: true, play_count: 1 })
    expect((await bob("POST", `/api/game/${display}/play`)).json.counted).toBe(false)
    const rated = await bob("PUT", `/api/game/${display}/rating`, { stars: 4, comment: "跳得太低" })
    expect(rated.status).toBe(200)
    // 不到 3 个人打分，玩家看不到分数，作者看得到
    expect(rated.json.rating).toBeNull()
    expect((await bob("GET", `/api/game/${display}`)).json.rating).toBeNull()
    expect((await alice("GET", `/api/game/${display}`)).json.rating).toBe(4)

    // 改分覆盖原来的
    await bob("PUT", `/api/game/${display}/rating`, { stars: 2 })
    expect(get(`SELECT rating_sum, rating_count FROM games`)).toEqual({ rating_sum: 2, rating_count: 1 })

    // 发布第二版：版本 +1，最新版的分数从零算
    const r2 = await alice("POST", `/api/game/${display}/releases`, { notes: "加了第二关", tags: ["catch", "dodge"] })
    expect(r2.status).toBe(400) // 工作台里还没有代码
    await alice("PUT", `/api/game/${display}/code`, { js: "new Phaser.Game({ v: 2 })" })
    const r3 = await alice("POST", `/api/game/${display}/releases`, { notes: "加了第二关", tags: ["catch", "dodge"] })
    expect(r3.json).toEqual({ version: 2, status: "listed" })
    const after = await bob("GET", `/api/game/${display}`)
    expect(after.json.code.js).toBe("new Phaser.Game({ v: 2 })")
    expect(after.json.rating_count).toBe(0)
    expect(after.json.releases.map((r: any) => [r.version, r.notes, r.rating_count])).toEqual([
      [2, "加了第二关", 0],
      [1, "第一版", 1],
    ])
    expect(after.json.my_rating).toBeNull()
    // 玩家只能拿最新版的代码，作者能看旧版
    expect((await bob("GET", `/api/game/${display}/releases/1`)).status).toBe(403)
    expect((await bob("GET", `/api/game/${display}/releases/2`)).status).toBe(200)
    expect((await alice("GET", `/api/game/${display}/releases/1`)).json.js).toBe("new Phaser.Game({})")
  })

  test("只能发布自己对话里的版本，标签要从固定的里选", async () => {
    const aliceId = makeUser("alice")
    const bobId = makeUser("bob")
    const alice = await client("alice")
    const bob = await client("bob")
    const a = await newGame(alice, aliceId)
    const b = await newGame(bob, bobId)
    expect((await publish(alice, a.display, b.messageId)).status).toBe(404)
    expect((await publish(bob, a.display, a.messageId)).status).toBe(403)
    expect(
      (await alice("POST", `/api/game/${a.display}/releases`, { message_id: a.messageId, tags: ["射击"] })).status,
    ).toBe(422)
    expect(
      (await alice("POST", `/api/game/${a.display}/releases`, { message_id: a.messageId, tags: [] })).status,
    ).toBe(422)
  })

  test("作者不能给自己打分，自己玩不算游玩人数", async () => {
    const aliceId = makeUser("alice")
    const alice = await client("alice")
    const { display, messageId } = await newGame(alice, aliceId)
    await publish(alice, display, messageId)
    expect((await alice("POST", `/api/game/${display}/play`)).json.counted).toBe(false)
    expect((await alice("PUT", `/api/game/${display}/rating`, { stars: 5 })).status).toBe(400)
  })

  test("满 3 人打分大厅才显示分数，好评榜也一样", async () => {
    const aliceId = makeUser("alice")
    const alice = await client("alice")
    const { display, messageId } = await newGame(alice, aliceId)
    await publish(alice, display, messageId)
    for (const [name, stars] of [["p1", 5], ["p2", 4], ["p3", 4]] as const) {
      makeUser(name)
      const p = await client(name)
      await p("POST", `/api/game/${display}/play`)
      await p("PUT", `/api/game/${display}/rating`, { stars })
      const top = await p("GET", "/api/game/hall?section=top")
      expect(top.json.count).toBe(name === "p3" ? 1 : 0)
    }
    const hall = await alice("GET", "/api/game/hall")
    expect(hall.json.items[0].rating).toBe(4.3)
    expect(hall.json.items[0].play_count).toBe(3)
  })

  test("作者可以删游戏，版本、评分、举报一起删掉", async () => {
    const aliceId = makeUser("alice")
    makeUser("bob")
    const alice = await client("alice")
    const bob = await client("bob")
    const { display, messageId } = await newGame(alice, aliceId)
    await publish(alice, display, messageId)
    await bob("POST", `/api/game/${display}/play`)
    await bob("PUT", `/api/game/${display}/rating`, { stars: 3, comment: "还行" })
    await bob("POST", `/api/game/${display}/report`, { reason: "测试" })
    expect((await bob("DELETE", `/api/game/${display}`)).status).toBe(403)
    expect((await alice("DELETE", `/api/game/${display}`)).status).toBe(200)
    for (const t of ["tasks", "games", "game_releases", "game_release_code", "game_ratings", "game_plays", "game_reports", "game_tags", "conversations", "messages"]) {
      expect(get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n).toBe(0)
    }
  })
})

describe("游戏：留言", () => {
  test("留言显示名字不显示星级，老师看得到星级；有用可以点和取消，不能点自己的", async () => {
    const aliceId = makeUser("alice")
    makeUser("bob")
    makeUser("carol")
    makeUser("teacher", "admin")
    const [alice, bob, carol, teacher] = await Promise.all([client("alice"), client("bob"), client("carol"), client("teacher")])
    const { display, messageId } = await newGame(alice, aliceId)
    await publish(alice, display, messageId)
    await bob("POST", `/api/game/${display}/play`)
    await bob("PUT", `/api/game/${display}/rating`, { stars: 2, comment: "太难了" })
    await carol("POST", `/api/game/${display}/play`)
    await carol("PUT", `/api/game/${display}/rating`, { stars: 5 })

    const seenByAuthor = await alice("GET", `/api/game/${display}/ratings`)
    expect(seenByAuthor.json.count).toBe(1)
    expect(seenByAuthor.json.items[0]).toMatchObject({ username: "bob", comment: "太难了", helpful_count: 0 })
    expect(seenByAuthor.json.items[0].stars).toBeUndefined()
    const seenByTeacher = await teacher("GET", `/api/game/${display}/ratings`)
    expect(seenByTeacher.json.count).toBe(2)
    expect(seenByTeacher.json.items.map((r: any) => [r.username, r.stars]).sort()).toEqual([["bob", 2], ["carol", 5]])

    const id = seenByAuthor.json.items[0].id
    expect((await bob("POST", `/api/game/ratings/${id}/helpful`)).status).toBe(400)
    expect((await carol("POST", `/api/game/ratings/${id}/helpful`)).json).toEqual({ helped: true, helpful_count: 1 })
    expect((await carol("POST", `/api/game/ratings/${id}/helpful`)).json).toEqual({ helped: false, helpful_count: 0 })
    await carol("POST", `/api/game/ratings/${id}/helpful`)

    // 老师删留言：文字清掉，星级还在，记进操作记录
    expect((await bob("DELETE", `/api/game/ratings/${id}/comment`)).status).toBe(403)
    expect((await teacher("DELETE", `/api/game/ratings/${id}/comment`)).status).toBe(200)
    expect((await alice("GET", `/api/game/${display}/ratings`)).json.count).toBe(0)
    expect(get(`SELECT stars, comment, helpful_count FROM game_ratings WHERE id = $id`, { id })).toEqual({
      stars: 2,
      comment: null,
      helpful_count: 0,
    })
    expect(get<{ n: number }>(`SELECT COUNT(*) AS n FROM game_rating_helpful`)!.n).toBe(0)
    const logs = await teacher("GET", "/api/game/admin/log")
    expect(logs.json.items[0]).toMatchObject({ action: "delete_comment", actor: "teacher", reason: "太难了" })
  })
})

describe("游戏：老师管理", () => {
  test("举报、下架、申请、恢复；下架期间发新版不会自动上架", async () => {
    const aliceId = makeUser("alice")
    makeUser("bob")
    makeUser("teacher", "admin")
    const [alice, bob, teacher] = await Promise.all([client("alice"), client("bob"), client("teacher")])
    const { display, messageId } = await newGame(alice, aliceId)
    await publish(alice, display, messageId)

    expect((await alice("POST", `/api/game/${display}/report`, { reason: "x" })).status).toBe(400)
    await bob("POST", `/api/game/${display}/report`, { reason: "有不好的话" })
    await bob("POST", `/api/game/${display}/report`, { reason: "里面有骂人的话" })
    expect((await teacher("GET", "/api/game/admin/summary")).json).toEqual({ pending_reports: 1, appeals: 0 })
    const reports = await teacher("GET", "/api/game/admin/reports")
    expect(reports.json.items[0]).toMatchObject({ reason: "里面有骂人的话", reporter: "bob" })

    expect((await bob("POST", `/api/game/${display}/takedown`, { reason: "x" })).status).toBe(403)
    expect((await teacher("POST", `/api/game/${display}/takedown`, { reason: "有不文明用语" })).status).toBe(200)
    // 下架后别人看不到，作者看得到原因；举报自动处理
    expect((await bob("GET", `/api/game/${display}`)).status).toBe(404)
    expect((await bob("GET", "/api/game/hall")).json.count).toBe(0)
    expect((await alice("GET", `/api/game/${display}`)).json.takedown_reason).toBe("有不文明用语")
    expect((await teacher("GET", "/api/game/admin/summary")).json.pending_reports).toBe(0)

    await alice("PUT", `/api/game/${display}/code`, { js: "new Phaser.Game({ fixed: true })" })
    expect((await alice("POST", `/api/game/${display}/releases`, { tags: ["catch"] })).json).toEqual({
      version: 2,
      status: "taken_down",
    })
    expect((await alice("POST", `/api/game/${display}/appeal`)).status).toBe(200)
    expect((await teacher("GET", "/api/game/admin/summary")).json.appeals).toBe(1)
    expect((await teacher("GET", "/api/game/admin/takedowns")).json[0].appeal_at).toBeTruthy()

    expect((await teacher("POST", `/api/game/${display}/restore`)).json).toEqual({ status: "listed" })
    expect((await bob("GET", `/api/game/${display}`)).json.code.js).toBe("new Phaser.Game({ fixed: true })")
    expect((await alice("POST", `/api/game/${display}/appeal`)).status).toBe(400)
    const actions = (await teacher("GET", "/api/game/admin/log")).json.items.map((l: any) => l.action)
    expect(actions).toEqual(["restore", "take_down"])
  })

  test("推荐和徽章", async () => {
    const aliceId = makeUser("alice")
    makeUser("teacher", "admin")
    const [alice, teacher] = await Promise.all([client("alice"), client("teacher")])
    const { display, messageId } = await newGame(alice, aliceId)
    // 草稿不能推荐
    expect((await teacher("PUT", `/api/game/${display}/featured`, { featured: true })).status).toBe(400)
    await publish(alice, display, messageId)
    expect((await alice("PUT", `/api/game/${display}/featured`, { featured: true })).status).toBe(403)
    await teacher("PUT", `/api/game/${display}/featured`, { featured: true })
    expect((await alice("GET", "/api/game/hall?section=featured")).json.count).toBe(1)

    expect((await teacher("POST", `/api/game/${display}/badges`, { badge: "creative" })).status).toBe(200)
    expect((await teacher("POST", `/api/game/${display}/badges`, { badge: "creative" })).status).toBe(400)
    expect((await teacher("POST", `/api/game/${display}/badges`, { badge: "popular" })).status).toBe(422)
    expect((await alice("GET", `/api/game/${display}`)).json.badges).toEqual([{ key: "creative", label: "最有创意" }])
  })
})

describe("游戏：大厅和榜单", () => {
  test("按标签筛选、最近更新排序、周榜按新增玩家", async () => {
    const aliceId = makeUser("alice")
    makeUser("bob")
    makeUser("carol")
    const [alice, bob, carol] = await Promise.all([client("alice"), client("bob"), client("carol")])
    const g1 = await newGame(alice, aliceId, "游戏一")
    const g2 = await newGame(alice, aliceId, "游戏二")
    await alice("POST", `/api/game/${g1.display}/releases`, { message_id: g1.messageId, tags: ["maze"] })
    await alice("POST", `/api/game/${g2.display}/releases`, { message_id: g2.messageId, tags: ["shoot"] })

    expect((await bob("GET", "/api/game/hall?tag=maze")).json.items.map((i: any) => i.title)).toEqual(["游戏一"])
    expect((await bob("GET", "/api/game/hall?section=updated")).json.items.map((i: any) => i.title)).toEqual([
      "游戏二",
      "游戏一",
    ])

    await bob("POST", `/api/game/${g1.display}/play`)
    await carol("POST", `/api/game/${g1.display}/play`)
    await carol("POST", `/api/game/${g2.display}/play`)
    // 一个月前玩过的不算进周榜
    run(`UPDATE game_plays SET first_played = '2000-01-01T00:00:00.000Z' WHERE task_id = $id`, { id: g2.taskId })
    const week = await bob("GET", "/api/game/leaderboard?period=week")
    expect(week.json.map((r: any) => [r.rank, r.title, r.new_players])).toEqual([[1, "游戏一", 2]])
    const hot = await bob("GET", "/api/game/hall?section=hot")
    expect(hot.json.items.map((i: any) => i.title)).toEqual(["游戏一", "游戏二"])
  })

  test("我的游戏列出草稿和下架的，带状态", async () => {
    const aliceId = makeUser("alice")
    makeUser("teacher", "admin")
    const [alice, teacher] = await Promise.all([client("alice"), client("teacher")])
    const g1 = await newGame(alice, aliceId, "草稿")
    const g2 = await newGame(alice, aliceId, "被下架")
    await publish(alice, g2.display, g2.messageId)
    await teacher("POST", `/api/game/${g2.display}/takedown`, { reason: "不合适" })
    const mine = await alice("GET", "/api/game/mine")
    expect(mine.json.map((g: any) => [g.title, g.status]).sort()).toEqual([
      ["草稿", "draft"],
      ["被下架", "taken_down"],
    ])
    expect(g1.display).toBeLessThan(g2.display)
  })
})

describe("游戏：对话、更新说明、成长回放、封面", () => {
  test("只有作者能和 AI 对话；更新说明从上次发布以来的“做了什么”起草", async () => {
    const aliceId = makeUser("alice")
    makeUser("bob")
    const [alice, bob] = await Promise.all([client("alice"), client("bob")])
    const { display, taskId, messageId } = await newGame(alice, aliceId)
    const version = { task_id: taskId, html: "", css: "", js: "x" }
    expect((await bob("POST", "/api/prompt/versions", version)).status).toBe(403)
    expect((await alice("POST", "/api/prompt/versions", version)).status).toBe(200)

    expect((await alice("POST", `/api/game/${display}/notes-draft`)).json.notes).toBe("做了一个接金币的游戏。")
    await publish(alice, display, messageId)
    // 发布以后没有新的 AI 回复
    expect((await alice("POST", `/api/game/${display}/notes-draft`)).json.notes).toBe("")
    expect((await bob("POST", `/api/game/${display}/notes-draft`)).status).toBe(403)
  })

  test("成长回放默认只有作者和老师能看，公开后别人也能看，标出发布的版本", async () => {
    const aliceId = makeUser("alice")
    makeUser("bob")
    makeUser("teacher", "admin")
    const [alice, bob, teacher] = await Promise.all([client("alice"), client("bob"), client("teacher")])
    const { display, messageId } = await newGame(alice, aliceId)
    await publish(alice, display, messageId)
    expect((await bob("GET", `/api/game/${display}/replay`)).status).toBe(403)
    const replay = await teacher("GET", `/api/game/${display}/replay`)
    expect(replay.json.rounds).toHaveLength(1)
    expect(replay.json.rounds[0]).toMatchObject({ question: "做一个接金币的游戏", version: 1 })
    await alice("PUT", `/api/game/${display}/replay`, { public: true })
    expect((await bob("GET", `/api/game/${display}/replay`)).status).toBe(200)
  })

  test("封面只收小图片，换封面删掉旧文件", async () => {
    const media = await mkdtemp(join(tmpdir(), "game-media-"))
    const saved = config.mediaRoot
    config.mediaRoot = media
    try {
      const aliceId = makeUser("alice")
      const alice = await client("alice")
      const { display, taskId } = await newGame(alice, aliceId)
      const upload = (file: File) => {
        const form = new FormData()
        form.append("image", file)
        return app.request(`/api/game/${display}/cover`, {
          method: "PUT",
          headers: { authorization: `Bearer ${alice.tokens.access_token}` },
          body: form,
        })
      }
      expect((await upload(new File(["x"], "a.gif", { type: "image/gif" }))).status).toBe(400)
      expect((await upload(new File([new Uint8Array(600 * 1024)], "a.png", { type: "image/png" }))).status).toBe(400)
      expect((await upload(new File(["png1"], "a.png", { type: "image/png" }))).status).toBe(200)
      const res = await upload(new File(["png2"], "b.png", { type: "image/png" }))
      const url = ((await res.json()) as any).cover as string
      expect(url).toStartWith(`/media/games/${taskId}/cover-`)
      expect(await readdir(join(media, `games/${taskId}`))).toHaveLength(1)
      expect(all(`SELECT cover FROM games`)).toEqual([{ cover: url.slice("/media/".length) }])
    } finally {
      config.mediaRoot = saved
      await rm(media, { recursive: true, force: true })
    }
  })
})
