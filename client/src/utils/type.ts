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

export type FlagType = "red" | "blue" | "green" | "yellow" | null

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

export interface ScoreBucket {
  range_1_2: number
  range_2_3: number
  range_3_4: number
  range_4_5: number
  range_5: number
}

export interface FlagStats {
  red: number
  blue: number
  green: number
  yellow: number
}

export interface TopViewedItem {
  username: string
  classname: string
  view_count: number
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
  score_distribution: ScoreBucket
  flag_stats: FlagStats
  classes: string[]
  top_viewed: TopViewedItem[]
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

export interface ShowcaseSubmissionLookupOut {
  submission_id: string
  username: string
  task_title: string
  task_display: number
  score: number
  view_count: number
  has_prompt_chain: boolean
}

export interface AwardItemManageOut {
  id: number
  submission_id: string
  username: string
  task_title: string
  task_display: number
  score: number
  view_count: number
  sort_order: number
  awarded_at: string
  has_prompt_chain: boolean
  is_stale: boolean
}

export interface ShowcaseDetail {
  submission_id: string
  username: string
  task_title: string
  task_display: number
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

export interface RandomRatingItem {
  submission_id: string
  username: string
  task_title: string
  task_display: number
  task_type: TASK_TYPE
  html: string | null
  css: string | null
  js: string | null
}
