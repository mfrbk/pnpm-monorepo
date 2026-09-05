/**
 * Editor Store —— createImmerStore(immer)示范。
 *
 * 比 createStore 多一层 immer:actions 里 set 收到的是 draft,可以直接改 blocks,
 * 不用展开复制;结合 immer 的 copy-on-write,还能安全地维护撤销栈:
 *
 * - 每个“会改变 blocks”的动作前,先把当前 blocks 快照压入 past;
 * - 快照要与本次 draft 隔离,所以压入的是 blocks.map(b => ({ ...b })),
 *   直接 push 原数组会把同一个 draft 压进去、随后跟着一起被改(常见坑);
 * - undo = 把 blocks 整体替换回上一个快照;redo 栈在新编辑时清空;
 * - reset 由工厂注入(回到 initial,连历史一起清掉);
 * - 不挂 persist:展示「不是每个 store 都要持久化」(auth / ui 已示范)。
 */
import { createImmerStore } from '../../lib/state'
import type { EditorBlock } from './editor.types'
import type { WritableDraft } from 'immer'

const MAX_HISTORY = 50

export interface EditorState {
  blocks: EditorBlock[]
  /** 可撤销的历史快照;新编辑入栈,超过 MAX_HISTORY 丢掉最旧的 */
  past: EditorBlock[][]
  /** 撤销后可重做的快照;新编辑会清空 */
  future: EditorBlock[][]
}

export interface EditorActions {
  /** 改某块文字;内容没变时不产生历史点 */
  updateText: (blockId: string, text: string) => void
  /** 在指定块后面插入一个新块;afterBlockId 为 null 时追加到末尾 */
  insertBlockAfter: (afterBlockId: string | null) => void
  deleteBlock: (blockId: string) => void
  undo: () => void
  redo: () => void
}

/** 演示用种子块(initial 里会再拷贝一份,不与模块常量共享引用) */
const SEED_BLOCKS: EditorBlock[] = [
  { id: 'b_intro', type: 'text', text: '双击块文字编辑;提交一次 = 一个历史点' },
  { id: 'b_undo', type: 'text', text: '用 undo / redo 回退;新编辑会清空 redo 栈' },
]

let seq = 0
const createBlock = (): EditorBlock => ({
  id: `b_${Date.now().toString(36)}_${++seq}`,
  type: 'text',
  text: '新块',
})

export const useEditorStore = createImmerStore<EditorState, EditorActions>({
  name: 'EditorStore',
  initial: {
    blocks: SEED_BLOCKS.map((b) => ({ ...b })),
    past: [],
    future: [],
  },
  actions: ({ set }) => {
    /** 变更前调用:把“当前 blocks”快照压栈,并清空 redo。draft 直改,无需展开复制。 */
    const commitHistory = (draft: WritableDraft<EditorState>) => {
      draft.past.push(draft.blocks.map((b) => ({ ...b })))
      if (draft.past.length > MAX_HISTORY) draft.past.shift()
      draft.future = []
    }

    return {
      updateText: (blockId, text) =>
        set((draft) => {
          const block = draft.blocks.find((b) => b.id === blockId)
          // 找不到或内容没变 → 不改任何东西,不产生历史点
          if (!block || block.text === text) return
          commitHistory(draft)
          block.text = text
        }),

      insertBlockAfter: (afterBlockId) =>
        set((draft) => {
          const index = afterBlockId
            ? draft.blocks.findIndex((b) => b.id === afterBlockId)
            : draft.blocks.length - 1
          const at = index >= 0 ? index + 1 : draft.blocks.length
          commitHistory(draft)
          draft.blocks.splice(at, 0, createBlock())
        }),

      deleteBlock: (blockId) =>
        set((draft) => {
          if (!draft.blocks.some((b) => b.id === blockId)) return
          commitHistory(draft)
          draft.blocks = draft.blocks.filter((b) => b.id !== blockId)
        }),

      undo: () =>
        set((draft) => {
          const previous = draft.past.pop()
          if (!previous) return
          draft.future.push(draft.blocks)
          draft.blocks = previous
        }),

      redo: () =>
        set((draft) => {
          const next = draft.future.pop()
          if (!next) return
          draft.past.push(draft.blocks)
          draft.blocks = next
        }),
    }
  },
})

// ---- Selectors:组件从这里订阅;blocks 的引用在“真的变了”时才更换,
// 纯 push/pop 历史不会触发订阅,无需 useShallow。 ----

export const useEditorBlocks = () => useEditorStore((state) => state.blocks)

export const useEditorCanUndo = () => useEditorStore((state) => state.past.length > 0)

export const useEditorCanRedo = () => useEditorStore((state) => state.future.length > 0)
