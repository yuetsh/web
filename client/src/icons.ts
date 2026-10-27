import { defineComponent, h, type Component } from "vue"
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpen,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Download,
  GraduationCap,
  Eye,
  Globe,
  Image,
  Info,
  Lightbulb,
  List,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Smartphone,
  Sparkles,
  Sun,
  SunMoon,
  SquarePen,
  Star,
  Swords,
  Tablet,
  Trash2,
  Users,
  X,
} from "lucide-vue-next"

// 全站只用 lucide 一套图标，并且打包进前端（以前走在线的 iconify 接口，机房断网时图标会全部消失）。
// 沿用 <Icon icon="集合:名字" /> 的写法；原来其他图标集里用到的几个映射到 lucide 的对应图标
const registry: Record<string, Component> = {
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  award: Award,
  "book-open": BookOpen,
  "bar-chart-2": ChartNoAxesColumn,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  globe: Globe,
  lock: Lock,
  "check-circle": CircleCheck,
  download: Download,
  eye: Eye,
  image: Image,
  info: Info,
  lightbulb: Lightbulb,
  list: List,
  "log-out": LogOut,
  play: Play,
  plus: Plus,
  "refresh-cw": RefreshCw,
  save: Save,
  search: Search,
  sparkles: Sparkles,
  edit: SquarePen,
  star: Star,
  swords: Swords,
  "trash-2": Trash2,
  users: Users,
  "graduation-cap": GraduationCap,
  x: X,
  sun: Sun,
  moon: Moon,
  "sun-moon": SunMoon,
  // 原 material-symbols / pepicons
  "close-rounded": X,
  "desktop-windows-outline": Monitor,
  "smartphone-outline": Smartphone,
  "tablet-outline": Tablet,
}

export const Icon = defineComponent({
  name: "Icon",
  props: {
    icon: { type: String, required: true },
    width: { type: [Number, String], default: 16 },
  },
  setup(props) {
    return () => {
      const name = props.icon.slice(props.icon.indexOf(":") + 1)
      const comp = registry[name]
      if (!comp) {
        if (import.meta.env.DEV) console.warn(`图标 ${props.icon} 没有登记在 icons.ts 里`)
        return null
      }
      return h(comp, { size: props.width, strokeWidth: 2, "aria-hidden": "true" })
    }
  },
})
