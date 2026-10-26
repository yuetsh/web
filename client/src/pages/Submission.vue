<script lang="ts" setup>
import { onMounted, useTemplateRef } from "vue"
import { Submission } from "../api"
import type { SubmissionAll } from "../utils/type"
import { buildPreviewDocument } from "../utils/previewDocument"

interface Props {
  id: string
}
const props = defineProps<Props>()

const iframe = useTemplateRef<HTMLIFrameElement>("iframe")

async function init() {
  const submission: SubmissionAll = await Submission.get(props.id)
  Submission.incrementView(props.id)

  if (!iframe.value) return
  const doc = iframe.value.contentDocument
  if (doc) {
    doc.open()
    doc.write(
      buildPreviewDocument({
        html: submission.html,
        css: submission.css,
        js: submission.js,
      }),
    )
    doc.close()
  }
}

onMounted(init)
</script>
<template>
  <iframe class="iframe" ref="iframe"></iframe>
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
