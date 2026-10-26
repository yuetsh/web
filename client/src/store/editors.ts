import { useStorage } from "@vueuse/core"
import { STORAGE_KEY } from "../utils/const"

const defaultHTML = ``
const defaultCSS = ``

export const html = useStorage(STORAGE_KEY.HTML, defaultHTML)
export const css = useStorage(STORAGE_KEY.CSS, defaultCSS)
export const js = useStorage(STORAGE_KEY.JS, "")

export const tab = useStorage(STORAGE_KEY.TAB, "html")
export const size = useStorage(STORAGE_KEY.FONTSIZE, 24)

export function reset(lang: "html" | "css" | "js") {
  if (lang === "html") {
    html.value = defaultHTML
  } else if (lang === "css") {
    css.value = defaultCSS
  } else {
    js.value = ""
  }
}
