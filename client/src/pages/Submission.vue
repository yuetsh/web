<script lang="ts" setup>
import { onMounted, ref } from "vue"
import { Submission } from "../api"
import type { SubmissionAll } from "../utils/type"
import { buildPreviewDocument, PREVIEW_SANDBOX } from "../utils/previewDocument"

interface Props {
  id: string
}
const props = defineProps<Props>()

const content = ref("")

async function init() {
  const submission: SubmissionAll = await Submission.get(props.id)
  Submission.incrementView(props.id)
  content.value = buildPreviewDocument({
    html: submission.html,
    css: submission.css,
    js: submission.js,
  })
}

onMounted(init)
</script>
<template>
  <iframe v-if="content" class="iframe" :sandbox="PREVIEW_SANDBOX" :srcdoc="content"></iframe>
</template>
<style scoped>
.iframe {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
}
</style>
