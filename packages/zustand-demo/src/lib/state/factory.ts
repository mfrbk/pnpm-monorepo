/**
 * lib/state 共享实现:createStore / createImmerStore 的差异收敛成一个 mode,
 * 中间件管线(persist + devtools)只写一份,并统一注入免费的 reset 动作。
 *
 * 对外请用 createStore / createImmerStore,不要直接 import 本文件。
 *
 * 中间件组合顺序(zustand 官方推荐,外→内):
 *   devtools( persist( [immer] (creator) ) )
 * 其中 immer 只在 mode = 'immer' 时包一层;mutator 元组的类型收窄全在本文件内,
 * 调用方只见裸 set / get。
 */
import { create } from 'zustand'
import type { StateCreator } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type {
  BoundStore,
  ImmerSetFn,
  ImmerStoreDef,
  PersistPart,
  ResetAction,
  StoreDef,
} from './types'

type Mode = 'plain' | 'immer'
type AnyDef<S, A extends object> = StoreDef<S, A> | ImmerStoreDef<S, A>

export function createStoreWith<S, A extends object>(
  def: StoreDef<S, A>,
  mode: 'plain',
): BoundStore<S & A & ResetAction>
export function createStoreWith<S, A extends object>(
  def: ImmerStoreDef<S, A>,
  mode: 'immer',
): BoundStore<S & A & ResetAction>
export function createStoreWith<S, A extends object>(
  def: AnyDef<S, A>,
  mode: Mode,
): BoundStore<S & A & ResetAction> {
  type Full = S & A
  type Result = Full & ResetAction
  const { name, initial } = def

  // reset 每次都给「全新的默认值」,避免跨 reset 共享同一份数组/对象引用。
  const nextDefault = (): S => JSON.parse(JSON.stringify(initial)) as S

  // mode 只影响 base creator 里 actions 拿到的 set 形态(裸 set vs draft 直改);
  // reset 对两种 mode 都传“对象 partial”—— zustand 内部 Object.assign 合并,
  // 动作函数会保留;泛型 S 无法直接赋给各 mutator 的 set 入参,故按入参类型收窄一次。
  let creator: StateCreator<Full, [], [], Full>
  if (mode === 'immer') {
    const immerCreator: StateCreator<Full, [['zustand/immer', never]], [], Full> = (set, get) => {
      const actions = (def as ImmerStoreDef<S, A>).actions({
        set: set as unknown as ImmerSetFn<Full>,
        get,
      })
      return {
        ...initial,
        ...actions,
        reset: () => set(nextDefault() as Parameters<typeof set>[0]),
      } as Result
    }
    creator = immer(immerCreator) as StateCreator<Full, [], [], Full>
  } else {
    creator = (set, get) => {
      const actions = (def as StoreDef<S, A>).actions({ set, get })
      return {
        ...initial,
        ...actions,
        reset: () => set(nextDefault() as Parameters<typeof set>[0]),
      } as Result
    }
  }

  const persistedDef = def.persist as PersistPart<Full> | undefined
  if (!persistedDef) {
    return create<Full>()(
      // devtools 在类型上要求其 creator 的 Mis 带 ['zustand/devtools', never];运行时不改变 creator 行为。
      devtools(creator as unknown as StateCreator<Full, [['zustand/devtools', never]], [], Full>, {
        name,
      }),
    ) as unknown as BoundStore<Result>
  }

  const { key, version, partialize } = persistedDef
  // persist 需要其 creator 的 Mis 带 ['zustand/persist', unknown],故在此做类型收窄。
  const persisted = persist(
    creator as unknown as StateCreator<Full, [['zustand/persist', unknown]], [], Full>,
    {
      name: key,
      version,
      storage: createJSONStorage(() => localStorage),
      partialize: (state: Full) => partialize(state),
    },
  )
  return create<Full>()(
    devtools(persisted as unknown as StateCreator<Full, [['zustand/devtools', never]], [], Full>, {
      name,
    }),
  ) as unknown as BoundStore<Result>
}
