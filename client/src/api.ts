import axios from "axios"
import { router } from "./router"
import type {
  TutorialIn,
  ChallengeIn,
  FlagType,
  SubmissionOut,
  PromptMessage,
  PromptHistoryItem,
  TaskStatsOut,
  TaskAsset,
  AwardSection,
  AwardManageIn,
  AwardManageOut,
  AwardItemIn,
  AwardItemUpdateIn,
  AwardItemManageOut,
  GradebookOut,
  GradebookQuery,
  ShowcaseSubmissionLookupOut,
  ShowcaseDetail,
  PromptRound,
  RandomRatingItem,
  CreationSlim,
  CreationDetail,
  CreationIn,
} from "./utils/type"
import { BASE_URL, STORAGE_KEY } from "./utils/const"

const http = axios.create({
  baseURL: BASE_URL,
  xsrfCookieName: "xsrfCookieName",
  xsrfHeaderName: "X-CSRFTOKEN",
  withCredentials: true,
})

http.interceptors.response.use(
  (res) => {
    return res
  },
  (err) => {
    if (err.response) {
      switch (err.response.status) {
        case 401: // 未授权
          localStorage.removeItem(STORAGE_KEY.LOGIN)
          router.push("/")
          break
        case 403: // 禁止访问
          alert("权限不够，禁止访问")
          router.push("/")
          break
        default:
          console.error("出现错误：", err.response.status, err.response.data)
      }
    } else {
      console.error("出现错误：", err.message)
    }
    return Promise.reject(err)
  },
)

export const Account = {
  async login(username: string, password: string) {
    const res = await http.post("/account/login", { username, password })
    return res.data
  },

  async logout() {
    const res = await http.post("/account/logout")
    return res.data
  },

  async getMyProfile() {
    const res = await http.get("/account/profile")
    return res.data
  },

  async list(query: { username: string; page: number }) {
    const res = await http.get("/account/list", {
      params: query,
    })
    return res.data
  },

  async toggleActive(id: number) {
    const res = await http.put(`/account/active/${id}`)
    return res.data
  },

  async batchCreate(payload: { classname: string; names: string[] }) {
    const res = await http.post("/account/batch", payload)
    return res.data
  },

  async listClasses(): Promise<string[]> {
    const res = await http.get("/account/classes")
    return res.data
  },

  async listNamesByClass(
    classname: string,
  ): Promise<{ name: string; username: string }[]> {
    const res = await http.get("/account/names", { params: { classname } })
    return res.data
  },
}

export const Tutorial = {
  async list() {
    const res = await http.get("/tutorial/list")
    return res.data
  },

  async createOrUpdate(payload: TutorialIn) {
    const res = await http.post("/tutorial/", payload)
    return res.data
  },

  async togglePublic(display: number) {
    const res = await http.put(`/tutorial/public/${display}`)
    return res.data
  },

  async remove(display: number) {
    await http.delete(`/tutorial/${display}`)
  },

  async get(display: number) {
    const res = await http.get(`/tutorial/${display}`)
    return res.data
  },

  async listDisplay() {
    const res = await http.get("/tutorial/display")
    return res.data
  },
}

export const Challenge = {
  async list() {
    const res = await http.get("/challenge/list")
    return res.data
  },

  async createOrUpdate(payload: ChallengeIn) {
    const res = await http.post("/challenge/", payload)
    return res.data
  },

  async togglePublic(display: number) {
    const res = await http.put(`/challenge/public/${display}`)
    return res.data
  },

  async remove(display: number) {
    await http.delete(`/challenge/${display}`)
  },

  async get(display: number) {
    const res = await http.get(`/challenge/${display}`)
    return res.data
  },

  async listDisplay() {
    const res = await http.get("/challenge/display")
    return res.data
  },
}

export const Creation = {
  async listMine(): Promise<CreationSlim[]> {
    const res = await http.get("/creation/mine")
    return res.data
  },

  async create(payload: CreationIn): Promise<CreationDetail> {
    const res = await http.post("/creation/", payload)
    return res.data
  },

  async get(display: number): Promise<CreationDetail> {
    const res = await http.get(`/creation/${display}`)
    return res.data
  },

  async update(display: number, payload: CreationIn): Promise<CreationDetail> {
    const res = await http.put(`/creation/${display}`, payload)
    return res.data
  },

  async saveCode(
    display: number,
    code: { html: string; css: string; js: string },
  ): Promise<CreationDetail> {
    const res = await http.put(`/creation/${display}/code`, code)
    return res.data
  },

  async remove(display: number) {
    const res = await http.delete(`/creation/${display}`)
    return res.data
  },
}

export const Submission = {
  async create(
    taskId: number,
    code: {
      html?: string
      css?: string
      js?: string
      prompt?: string
    },
    messageId?: number,
  ) {
    const { prompt, ...rest } = code
    const data = {
      task_id: taskId,
      ...rest,
      prompt: prompt || null,
      message_id: messageId ?? null,
    }
    const res = await http.post("/submission/", data)
    return res.data
  },

  async list(query: {
    page: number
    page_size?: number
    username?: string
    user_id?: number
    flag?: string | null
    zone?: string
    task_id?: number
    task_type?: string
    score_min?: number
    score_max_exclusive?: number
    score_lt_threshold?: number
    ordering?: string
    grouped?: boolean
  }) {
    const res = await http.get("/submission", {
      params: query,
    })
    return res.data
  },

  async listByUserTask(userId: number, taskId: number) {
    const res = await http.get("/submission/by-user-task", {
      params: { user_id: userId, task_id: taskId },
    })
    return res.data as SubmissionOut[]
  },

  async get(id: string) {
    const res = await http.get("/submission/" + id)
    return res.data
  },

  async getPromptChain(id: string): Promise<PromptRound[]> {
    const res = await http.get(`/submission/${id}/prompt-chain`)
    return res.data
  },

  async delete(id: string) {
    const res = await http.delete("/submission/" + id)
    return res.data
  },

  async incrementView(id: string) {
    await http.post(`/submission/${id}/view`)
  },

  async updateScore(id: string, score: number) {
    const res = await http.put(`/submission/${id}/score`, { score })
    return res.data
  },

  async randomForRating(excludeId?: string) {
    const res = await http.get("/submission/random-for-rating/", {
      params: excludeId ? { exclude_id: excludeId } : {},
    })
    return res.data as RandomRatingItem | null
  },

  async updateFlag(id: string, flag: FlagType) {
    const res = await http.put(`/submission/${id}/flag`, { flag })
    return res.data
  },

  async clearAllFlags() {
    const res = await http.delete(`/submission/flags`)
    return res.data as { cleared: number }
  },

  async getStats(taskId: number, classname?: string): Promise<TaskStatsOut> {
    const params: Record<string, string | number> = {}
    if (classname) params.classname = classname
    const res = await http.get(`/submission/stats/${taskId}`, { params })
    return res.data as TaskStatsOut
  },
}

function gradebookParams(query: GradebookQuery) {
  const params: Record<string, string | boolean> = {
    classname: query.classname,
  }
  if (query.task_type) params.task_type = query.task_type
  if (query.username) params.username = query.username
  if (query.include_all_tasks) params.include_all_tasks = true
  return params
}

function filenameFromDisposition(
  disposition: string | undefined,
  fallback: string,
) {
  const match = disposition?.match(/filename\*=UTF-8''([^;]+)/)
  return match ? decodeURIComponent(match[1]) : fallback
}

export const Gradebook = {
  async get(query: GradebookQuery): Promise<GradebookOut> {
    const res = await http.get("/submission/gradebook/", {
      params: gradebookParams(query),
    })
    return res.data
  },

  async downloadCsv(query: GradebookQuery) {
    const res = await http.get("/submission/gradebook/export/", {
      params: gradebookParams(query),
      responseType: "blob",
    })
    const blob = new Blob([res.data], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filenameFromDisposition(
      res.headers["content-disposition"],
      `gradebook-${query.classname}.csv`,
    )
    a.click()
    URL.revokeObjectURL(url)
  },
}

export const Prompt = {
  async listConversations(taskId?: number, userId?: number) {
    const params: Record<string, number> = {}
    if (taskId) params.task_id = taskId
    if (userId) params.user_id = userId
    return (await http.get("/prompt/conversations/", { params })).data
  },

  async listHistory(taskId: number): Promise<PromptHistoryItem[]> {
    const res = await http.get(`/prompt/history/${taskId}`)
    return res.data
  },

  async getMessages(conversationId: string): Promise<PromptMessage[]> {
    return (
      await http.get<PromptMessage[]>(
        `/prompt/conversations/${conversationId}/messages/`,
      )
    ).data
  },

  async getMessagesByUserTask(
    taskId: number,
    userId: number,
  ): Promise<PromptMessage[]> {
    const convs = await this.listConversations(taskId, userId)
    if (!convs.length) return []
    return this.getMessages(convs[0].id)
  },

  async deleteMessagePair(
    messageId: number,
  ): Promise<{ deleted: boolean; submission_deleted: boolean }> {
    const res = await http.delete(`/prompt/messages/${messageId}/pair`)
    return res.data
  },
}

export const Helper = {
  async upload(file: File) {
    const form = new window.FormData()
    form.append("image", file)
    const res = await http.post("/upload/", form, {
      headers: { "content-type": "multipart/form-data" },
    })
    return !!res.data.url ? res.data.url : ""
  },
}

export const Showcase = {
  async list(): Promise<AwardSection[]> {
    const res = await http.get("/submission/showcase/")
    return res.data
  },

  async listManageAwards(): Promise<AwardManageOut[]> {
    const res = await http.get("/submission/showcase/manage/awards")
    return res.data
  },

  async createAward(payload: AwardManageIn): Promise<AwardManageOut> {
    const res = await http.post("/submission/showcase/manage/awards", payload)
    return res.data
  },

  async updateAward(
    id: number,
    payload: AwardManageIn,
  ): Promise<AwardManageOut> {
    const res = await http.put(
      `/submission/showcase/manage/awards/${id}`,
      payload,
    )
    return res.data
  },

  async deleteAward(id: number) {
    const res = await http.delete(`/submission/showcase/manage/awards/${id}`)
    return res.data
  },

  async listAwardItems(id: number): Promise<AwardItemManageOut[]> {
    const res = await http.get(`/submission/showcase/manage/awards/${id}/items`)
    return res.data
  },

  async findSubmissionForAward(
    submissionId: string,
  ): Promise<ShowcaseSubmissionLookupOut> {
    const res = await http.get(
      `/submission/showcase/manage/submissions/${submissionId}`,
    )
    return res.data
  },

  async addAwardItem(
    id: number,
    payload: AwardItemIn,
  ): Promise<AwardItemManageOut> {
    const res = await http.post(
      `/submission/showcase/manage/awards/${id}/items`,
      payload,
    )
    return res.data
  },

  async updateAwardItem(
    itemId: number,
    payload: AwardItemUpdateIn,
  ): Promise<AwardItemManageOut> {
    const res = await http.put(
      `/submission/showcase/manage/items/${itemId}`,
      payload,
    )
    return res.data
  },

  async deleteAwardItem(itemId: number) {
    const res = await http.delete(`/submission/showcase/manage/items/${itemId}`)
    return res.data
  },

  async refreshAwardItem(itemId: number): Promise<AwardItemManageOut> {
    const res = await http.put(
      `/submission/showcase/manage/items/${itemId}/refresh`,
    )
    return res.data
  },

  async getDetail(submissionId: string): Promise<ShowcaseDetail> {
    const res = await http.get(`/submission/showcase/${submissionId}/`)
    return res.data
  },

  async getPromptChain(submissionId: string): Promise<PromptRound[]> {
    const res = await http.get(
      `/submission/showcase/${submissionId}/prompt-chain/`,
    )
    return res.data
  },
}

export const TaskAssets = {
  async listChallenge(display: number): Promise<TaskAsset[]> {
    return (await http.get<TaskAsset[]>(`/assets/challenge/${display}`)).data
  },
  async uploadChallenge(
    display: number,
    name: string,
    file: File,
  ): Promise<TaskAsset> {
    const form = new window.FormData()
    form.append("name", name)
    form.append("file", file)
    return (
      await http.post<TaskAsset>(`/assets/challenge/${display}`, form, {
        headers: { "content-type": "multipart/form-data" },
      })
    ).data
  },
  async deleteChallenge(display: number, name: string) {
    return (await http.delete(`/assets/challenge/${display}/${name}`)).data
  },
  async listTutorial(display: number): Promise<TaskAsset[]> {
    return (await http.get<TaskAsset[]>(`/assets/tutorial/${display}`)).data
  },
  async uploadTutorial(
    display: number,
    name: string,
    file: File,
  ): Promise<TaskAsset> {
    const form = new window.FormData()
    form.append("name", name)
    form.append("file", file)
    return (
      await http.post<TaskAsset>(`/assets/tutorial/${display}`, form, {
        headers: { "content-type": "multipart/form-data" },
      })
    ).data
  },
  async deleteTutorial(display: number, name: string) {
    return (await http.delete(`/assets/tutorial/${display}/${name}`)).data
  },
}
