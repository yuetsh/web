<template>
  <main class="showcase">
    <n-flex justify="space-between" align="flex-end" style="margin-bottom: 32px;">
      <div>
        <n-h2 style="margin: 0 0 4px;">创意工坊</n-h2>
        <n-text depth="3">优秀作品展示</n-text>
      </div>
    </n-flex>

    <n-spin :show="loading">
      <n-empty
        v-if="!loading && awards.length === 0"
        description="暂无展示作品"
        style="margin-top: 72px;"
      />

      <section
        v-for="section in awards"
        :key="section.id"
        style="margin-bottom: 48px;"
      >
        <n-flex vertical :size="4" style="margin-bottom: 16px;">
          <n-h3 style="margin: 0;">{{ section.name }}</n-h3>
          <n-text v-if="section.description" depth="3" style="font-size: 13px;">
            {{ section.description }}
          </n-text>
        </n-flex>

        <div class="card-grid">
          <n-card
            v-for="item in section.items"
            :key="item.submission_id"
            class="work-card"
            content-style="padding: 0;"
            hoverable
            @click="openDetail(item)"
          >
            <div class="card-preview">
              <iframe
                :srcdoc="buildSrcdoc(item)"
                sandbox="allow-scripts"
                scrolling="no"
                class="preview-iframe"
              />
              <div class="preview-overlay" />
            </div>
            <div class="card-info">
              <n-flex justify="space-between" align="center" :wrap="false">
                <n-ellipsis style="font-size: 13px; font-weight: 600; min-width: 0; flex: 1;">
                  {{ item.username }}
                </n-ellipsis>
                <n-flex align="center" :wrap="false" :size="8" style="flex-shrink: 0;">
                  <n-flex align="center" :size="3">
                    <Icon icon="lucide:star" :width="13" />
                    <n-text style="font-size: 12px; color: #666;">
                      {{ item.score.toFixed(1) }}
                    </n-text>
                  </n-flex>
                  <n-flex align="center" :size="3">
                    <Icon icon="lucide:eye" :width="13" />
                    <n-text style="font-size: 12px; color: #666;">
                      {{ item.view_count }}
                    </n-text>
                  </n-flex>
                </n-flex>
              </n-flex>
              <n-ellipsis
                style="display: block; margin-top: 4px; font-size: 12px; line-height: 1.4; color: #888;"
              >
                {{ item.task_title }}
              </n-ellipsis>
            </div>
          </n-card>
        </div>
      </section>
    </n-spin>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { Icon } from "@iconify/vue"
import { Showcase } from "../api"
import type { AwardSection, ShowcaseItem } from "../utils/type"

const router = useRouter()
const loading = ref(true)
const awards = ref<AwardSection[]>([])

function buildSrcdoc(item: ShowcaseItem): string {
  const css = item.css ? `<style>${item.css}</style>` : ""
  const js = item.js ? `<script>${item.js}<\/script>` : ""
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="/normalize.min.css" />${css}</head><body>${item.html ?? ""}${js}</body></html>`
}

function openDetail(item: ShowcaseItem) {
  const { href } = router.resolve({
    name: "submission",
    params: { id: item.submission_id },
  })
  window.open(href, "_blank")
}

async function init() {
  try {
    awards.value = await Showcase.list()
  } finally {
    loading.value = false
  }
}

onMounted(init)
</script>

<style scoped>
.showcase {
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px 20px 48px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.work-card {
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.work-card:hover {
  transform: translateY(-2px);
}

.card-preview {
  position: relative;
  height: 160px;
  overflow: hidden;
  background: #f7f8fa;
}

.preview-iframe {
  width: 200%;
  height: 200%;
  border: none;
  transform: scale(0.5);
  transform-origin: top left;
  pointer-events: none;
}

.preview-overlay {
  position: absolute;
  inset: 0;
}

.card-info {
  min-height: 72px;
  padding: 10px 12px;
  border-top: 1px solid #f0f0f0;
}
</style>
