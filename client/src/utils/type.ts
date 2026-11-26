import type { TASK_TYPE } from "./const"

export interface PromptMessage {
  id: number
  role: string
  source?: string
  content: string
  code_html: string | null
  code_css: string | null
  code_js: string | null
  prompt_level?: number | null
  created: string
}

export interface PromptHistoryItem {
  user_message_id: number
  assistant_message_id: number
  submission_id: string | null
  source: string
  prompt: string
  prompt_level: number | null
  code_html: string | null
  code_css: string | null
  code_js: string | null
  created: string
}

export enum Role {
  Super = "super",
  Admin = "admin",
  Normal = "normal",
}

export function getRole(role: Role) {
  return {
    [Role.Super]: "超级管理员",
    [Role.Admin]: "管理员",
    [Role.Normal]: "普通用户",
  }[role]
}

// 只用 present（课上展示）；以前的四色标记数据里还可能有
export type FlagType = "present" | "red" | "blue" | "green" | "yellow" | null

export interface TaskAsset {
  name: string
  url: string
}

export interface TutorialSlim {
  display: number
  title: string
  is_public: boolean
}

export interface TutorialReturn extends TutorialSlim {
  content: string
  example_html: string | null
  example_css: string | null
  example_js: string | null
}

export interface TutorialIn {
  display: number
  title: string
  content: string
  example_html?: string | null
  example_css?: string | null
  example_js?: string | null
}

export interface ChallengeSlim {
  display: number
  title: string
  score: number
  pass_score: number | null
  submitted: boolean
  is_public: boolean
  author_name: string | null
}

export interface ChallengeReturn extends ChallengeSlim {
  content: string
  example_html: string | null
  example_css: string | null
  example_js: string | null
}

export interface ChallengeIn {
  display: number
  title: string
  content: string
  score: number
  is_public: boolean
  example_html?: string | null
  example_css?: string | null
  example_js?: string | null
}

export interface CreationSlim {
  display: number
  title: string
  content: string
  created: string
  modified: string
  has_code: boolean
}

export interface CreationDetail extends CreationSlim {
  task_id: number
  html: string
  css: string
  js: string
  owner_name: string
}

export interface CreationIn {
  title: string
  content: string
}

export interface User {
  id: number
  username: string
  date_joined: Date
  last_login: Date
  role: Role
  classname: string
  is_active: boolean
  // 批量创建时生成的初始密码；超管和改过密码的为空
  raw_password?: string | null
}

export interface SubmissionOut {
  id: string
  userid: number
  username: string
  task_id: number
  task_display: number
  task_type: TASK_TYPE
  task_title: string
  score: number
  my_score: number
  flag?: FlagType
  zone?: "featured" | "low" | "pending" | null
  submit_count: number
  view_count: number
  created: Date
  modified: Date
}

export interface SubmissionAll {
  id: string
  userid: number
  username: string
  task_id: number
  task_display: number
  task_type: TASK_TYPE
  task_title: string
  score: number
  my_score: number
  flag?: FlagType
  html: ""
  css: ""
  js: ""
  submit_count: number
  view_count: number
  created: Date
  modified: Date
  // 交的时候写的反思，只有老师和作者本人拿得到
  reflection?: string | null
}

export interface UserTag {
  username: string
  classname: string
}

export interface SubmissionCountBucket {
  count_1: number
  count_2: number
  count_3: number
  count_4_plus: number
}

export interface TopScoredItem {
  username: string
  classname: string
  score: number
  submission_id: string
}

export interface TaskStatsOut {
  submitted_count: number
  unsubmitted_count: number
  average_score: number | null
  unrated_count: number
  unsubmitted_users: UserTag[]
  unrated_users: UserTag[]
  submission_count_distribution: SubmissionCountBucket
  present_count: number
  classes: string[]
  top_scored: TopScoredItem[]
  prompts: PromptChainStats
}

// 课堂总结里每人最新一版的提示词链概况
export interface PromptChainStats {
  with_chain: number
  one_round: number
  external: number
  used_guidance: number
  avg_rounds: number
  // L1–L6 各有几次提问
  levels: number[]
}

export type GradebookTaskType = "tutorial" | "challenge"
export type GradebookGrade = "A" | "B" | "C" | "D" | "E"

export interface GradebookQuery {
  classname: string
  task_type?: GradebookTaskType | ""
  username?: string
  include_all_tasks?: boolean
}

export interface GradebookTask {
  id: number
  display: number
  title: string
  task_type: GradebookTaskType
  submitted_count: number
  coverage: number
  included: boolean
}

export interface GradebookCell {
  score: number
  submitted: boolean
  submission_id: string | null
}

export interface GradebookRow {
  user_id: number
  username: string
  classname: string
  rank: number
  grade: GradebookGrade
  assessment_grade: GradebookGrade
  assessment_score: number
  top3_score: number
  scores: Record<number, GradebookCell>
  tutorial_total: number
  challenge_total: number
  total_score: number
  average_score: number | null
  submitted_task_count: number
  missing_task_count: number
}

export interface GradebookOut {
  classname: string
  classes: string[]
  task_count: number
  included_task_count: number
  student_count: number
  coverage_threshold_count: number
  tasks: GradebookTask[]
  rows: GradebookRow[]
}

export interface ShowcaseItem {
  submission_id: string
  username: string
  task_title: string
  task_display: number
  task_type: TASK_TYPE
  score: number
  view_count: number
  html: string | null
  css: string | null
  js: string | null
  has_prompt_chain: boolean
}

export interface AwardSection {
  id: number
  name: string
  description: string
  item_ordering: string
  items: ShowcaseItem[]
}

export type ItemOrdering = "manual" | "awarded_at" | "score" | "view_count"

export interface AwardManageIn {
  name: string
  description: string
  sort_order: number
  is_active: boolean
  item_ordering: ItemOrdering
}

export interface AwardManageOut extends AwardManageIn {
  id: number
  item_count: number
}

export interface AwardItemIn {
  submission_id: string
  sort_order: number
}

export interface AwardItemUpdateIn {
  sort_order: number
}

export interface AwardItemManageOut {
  id: number
  submission_id: string
  username: string
  task_title: string
  task_display: number
  task_type: TASK_TYPE
  score: number
  view_count: number
  sort_order: number
  awarded_at: string
  has_prompt_chain: boolean
  is_stale: boolean
  html: string | null
  css: string | null
  js: string | null
}

export interface ShowcaseDetail {
  submission_id: string
  username: string
  task_title: string
  task_display: number
  task_type: TASK_TYPE
  score: number
  view_count: number
  html: string | null
  css: string | null
  js: string | null
  awards: string[]
  has_prompt_chain: boolean
}

export interface PromptRound {
  question: string
  source: string
  prompt_level: number | null
  assistant_msg_id?: number | null
  html: string | null
  css: string | null
  js: string | null
}

// 打分前不带作者（打完分 updateScore 返回）
export interface RandomRatingItem {
  submission_id: string
  task_title: string
  task_display: number
  task_type: TASK_TYPE
  html: string | null
  css: string | null
  js: string | null
}

export interface ReviewOptions {
  classes: string[]
  tasks: {
    id: number
    task_type: "tutorial" | "challenge"
    display: number
    title: string
    is_public: boolean
  }[]
}

export interface ReviewProgress {
  student_count: number
  // task_id → 交了的人数
  submitted: Record<string, number>
}

export interface ReviewSubmission {
  id: string
  score: number
  my_score: number
  rating_count: number
  flag: FlagType
  view_count: number
  submit_count: number
  created: string
  html: string
  css: string
  js: string
}

export interface ReviewStudent {
  user_id: number
  username: string
  classname: string
  submission: ReviewSubmission | null
}

export interface PeerWork {
  id: string
  // 自己打分之前是 null
  username: string | null
  classname: string
  score: number | null
  my_score: number
  created: string
  html: string
  css: string
  js: string
}

export interface PeerWorks {
  // 自己还没交这道题
  locked: boolean
  items: PeerWork[]
}

// ── 游戏 ──

export type GameStatus = "draft" | "listed" | "taken_down"

export interface GameTag {
  key: string
  label: string
}

export interface GameCode {
  html: string | null
  css: string | null
  js: string | null
}

// 大厅卡片
export interface GameCard {
  display: number
  title: string
  author: string
  cover: string | null
  tags: string[]
  latest_version: number
  // 评分人数不到 3 个时是 null（作者和老师除外）
  rating: number | null
  rating_count: number
  play_count: number
  last_published: string | null
  featured: boolean
}

export interface MyGame extends GameCard {
  status: GameStatus
  takedown_reason: string | null
  appeal_at: string | null
  modified: string
}

export interface GameLeaderItem extends GameCard {
  rank: number
  new_players: number
}

export interface GameTakedown extends GameCard {
  takedown_reason: string | null
  appeal_at: string | null
}

export interface GameWorkspace {
  task_id: number
  display: number
  title: string
  content: string
  html: string
  css: string
  js: string
  status: GameStatus
  latest_version: number
  tags: string[]
  cover: string | null
  replay_public: boolean
  takedown_reason: string | null
  appeal_at: string | null
  created: string
  modified: string
  releases: { version: number; message_id: number | null }[]
}

export interface GameRelease {
  version: number
  notes: string
  created: string
  rating: number | null
  rating_count: number
}

export interface GameDetail extends GameCard {
  task_id: number
  content: string
  status: GameStatus
  is_owner: boolean
  replay_public: boolean
  takedown_reason: string | null
  appeal_at: string | null
  releases: GameRelease[]
  badges: { key: string; label: string }[]
  code: GameCode | null
  my_rating: { stars: number; comment: string | null } | null
  played: boolean
}

export interface GameRating {
  id: number
  username: string
  comment: string | null
  helpful_count: number
  helped: boolean
  mine: boolean
  created: string
  // 只有老师看得到每个人打的星
  stars?: number
}

export interface GameReplayRound {
  question: string
  source: string
  prompt_level: number | null
  assistant_msg_id: number | null
  html: string | null
  css: string | null
  js: string | null
  version: number | null
}

export interface GameReport {
  id: number
  reason: string
  reporter: string
  created: string
  resolved_at: string | null
  game: { display: number; title: string; status: GameStatus }
}

export interface GameLogItem {
  id: number
  action: string
  actor: string | null
  game: { display: number | null; title: string }
  reason: string
  created: string
}
