<template>
  <n-spin v-if="loading" size="small" style="padding: 12px" />
  <n-data-table
    v-else-if="items"
    :columns="subColumns"
    :data="items"
    size="small"
    striped
    :row-key="(r: SubmissionOut) => r.id"
    :row-props="rowProps"
    :row-class-name="rowClassName"
  />
</template>

<script setup lang="ts">
import { computed, h } from "vue"
import {
  NButton,
  NDataTable,
  NPopconfirm,
  NSpin,
  type DataTableColumn,
} from "naive-ui"
import type { SubmissionOut } from "../../utils/type"
import { TASK_TYPE } from "../../utils/const"
import { parseTime } from "../../utils/helper"
import { user, roleSuper } from "../../store/user"
import { submission } from "../../store/submission"

const props = defineProps<{
  row: SubmissionOut
  items: SubmissionOut[] | undefined
  loading: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  delete: [row: SubmissionOut, parentId: string]
  "show-chain": [submissionId: string, username: string]
}>()

const isChallenge = computed(() => props.row.task_type === TASK_TYPE.Challenge)

function rowProps(r: SubmissionOut) {
  return {
    style: { cursor: "pointer" },
    onClick: () => emit("select", r.id),
  }
}

function rowClassName(r: SubmissionOut) {
  return submission.value.id === r.id ? "row-active" : ""
}

const subColumns = computed((): DataTableColumn<SubmissionOut>[] => [
  {
    title: "时间",
    key: "created",
    width: 160,
    render: (r) => parseTime(r.created, "YYYY-MM-DD HH:mm:ss"),
  },
  {
    title: "得分",
    key: "score",
    width: 80,
    render: (r) => {
      const myScore = r.my_score > 0 ? String(r.my_score) : "-"
      const avgScore = r.score > 0 ? r.score.toFixed(2) : "-"
      return h(
        "div",
        { style: { display: "flex", gap: "6px", alignItems: "baseline" } },
        [
          h("span", avgScore),
          h("span", { style: { fontSize: "11px", color: "#999" } }, myScore),
        ],
      )
    },
  },
  {
    title: "操作",
    key: "actions",
    width: isChallenge.value ? 110 : 60,
    render: (r: SubmissionOut) =>
      h("div", { style: { display: "flex", gap: "8px" } }, [
        ...(isChallenge.value
          ? [
              h(
                NButton,
                {
                  text: true,
                  type: "primary",
                  onClick: (e: Event) => {
                    e.stopPropagation()
                    emit("show-chain", r.id, r.username)
                  },
                },
                () => "查看",
              ),
            ]
          : []),
        ...(r.username === user.username || roleSuper.value
          ? [
              h(
                NPopconfirm,
                { onPositiveClick: () => emit("delete", r, props.row.id) },
                {
                  trigger: () =>
                    h(
                      NButton,
                      {
                        text: true,
                        type: "error",
                        size: "small",
                        onClick: (e: Event) => e.stopPropagation(),
                      },
                      () => "删除",
                    ),
                  default: () => "确定删除这次提交？",
                },
              ),
            ]
          : []),
      ]),
  } as DataTableColumn<SubmissionOut>,
])
</script>
