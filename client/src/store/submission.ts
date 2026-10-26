import { ref } from "vue"
import type { SubmissionAll } from "../utils/type"
import { TASK_TYPE } from "../utils/const"

export const submission = ref<SubmissionAll>({
  id: "",
  userid: 0,
  username: "",
  task_id: 0,
  task_display: 0, // 这是序号
  task_title: "",
  task_type: TASK_TYPE.Tutorial,
  score: 0.0,
  my_score: 0,
  html: "",
  css: "",
  js: "",
  created: new Date(),
  modified: new Date(),
})
