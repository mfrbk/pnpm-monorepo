/**
 * ==============================================================================
 * 3. 批量处理器 (Batch Processor)
 *
 * 按并发上限依次执行一批 MultiApiTask：每腾出一个槽位就从队列补一个任务。
 *
 * 注意：这里限制的是「任务」的并发数。单个 MultiApiTask 内部的所有子接口
 * 仍会一并并行发起，不受本队列约束。
 *
 * 只依赖与数据形状无关的 TaskHandle，无需感知 MultiApiTask 的泛型参数。
 * ==============================================================================
 */

import type { TaskHandle } from './types'

export class BatchProcessor {
  private maxConcurrency: number
  private queue: TaskHandle[] = []
  private runningTasks: Set<TaskHandle> = new Set()

  constructor(maxConcurrency: number = 5) {
    this.maxConcurrency = maxConcurrency
  }

  public addTasks(tasks: TaskHandle[]): void {
    this.queue.push(...tasks)
    this.processQueue()
  }

  private processQueue(): void {
    // 当有空闲槽位且队列不为空时，持续取出任务
    while (this.runningTasks.size < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift()
      if (!task) continue

      this.runningTasks.add(task)
      // 任务结束（含被取消）后释放槽位并继续补任务
      task.start().finally(() => {
        this.runningTasks.delete(task)
        this.processQueue()
      })
    }
  }

  /** 清空队列并取消所有正在运行的任务 */
  public clearAll(): void {
    // 取消队列中未执行的任务
    this.queue.forEach((task) => task.cancel())
    this.queue = []

    // 取消正在运行的任务
    this.runningTasks.forEach((task) => task.cancel())
    this.runningTasks.clear()
  }
}
