/* @flow */

import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools,
  inBrowser,
  isIE
} from '../util/index'

export const MAX_UPDATE_COUNT = 100

const queue: Array<Watcher> = [] // watcher队列（watcher缓存和watcher执行都依靠一个队列）
const activatedChildren: Array<Component> = []
let has: { [key: number]: ?true } = {} // 当前待执行的watcher
let circular: { [key: number]: number } = {}
let waiting = false // 标志冲刷队列的异步任务有没有注册
let flushing = false // 标志队列冲刷是否已经开始
let index = 0 // 冲刷watcher队列时的执行坐标

/**
 * Reset the scheduler's state.
 * 一个工具函数，重置调度器的状态，将各种状态重置为初始值
 */
function resetSchedulerState () {
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}

// Async edge case #6566 requires saving the timestamp when event listeners are
// attached. However, calling performance.now() has a perf overhead especially
// if the page has thousands of event listeners. Instead, we take a timestamp
// every time the scheduler flushes and use that for all event listeners
// attached during that flush.
export let currentFlushTimestamp = 0

// Async edge case fix requires storing an event listener's attach timestamp.
let getNow: () => number = Date.now

// Determine what event timestamp the browser is using. Annoyingly, the
// timestamp can either be hi-res (relative to page load) or low-res
// (relative to UNIX epoch), so in order to compare time we have to use the
// same timestamp type when saving the flush timestamp.
// All IE versions use low-res event timestamps, and have problematic clock
// implementations (#9632)
if (inBrowser && !isIE) {
  const performance = window.performance
  if (
    performance &&
    typeof performance.now === 'function' &&
    getNow() > document.createEvent('Event').timeStamp
  ) {
    // if the event timestamp, although evaluated AFTER the Date.now(), is
    // smaller than it, it means the event is using a hi-res timestamp,
    // and we need to use the hi-res version for event listener timestamps as
    // well.
    getNow = () => performance.now()
  }
}

/**
 * Flush both queues and run the watchers.
 * 执行watcher队列的完整逻辑
 */
function flushSchedulerQueue () {
  currentFlushTimestamp = getNow() // 记录当前冲刷队列开始的时间，供外部使用
  flushing = true // 修改标志位，表示watcher队列已开始执行
  let watcher, id

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child)
  // 2. A component's user watchers are run before its render watcher (because
  //    user watchers are created before the render watcher)
  // 3. If a component is destroyed during a parent component's watcher run,
  //    its watchers can be skipped.
  //
  // 对队列中的所有watcher进行排序
  // 按watcher的id从小到大进行排序，可以获得以下效果：
  // 1.父组件会比子组件先更新，因为父组件总是比子组件先被创建，watcher id更小
  // 2.单个组件的用户watcher一定会比渲染watcher先执行，因为用户watcher会比渲染watcher先创建
  // 3.如果一个组件在其父组件更新时被销毁，那么他的watcher会被跳过
  queue.sort((a, b) => a.id - b.id)

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
  // 开始遍历watcher队列并执行
  // 这里不缓存watcher队列的长度，因为执行过程中还可能有新的watcher加入队列
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index]
    if (watcher.before) { // watcher.before一般用于实现render watcher的beforeUpdate声明周期钩子
      watcher.before()
    }
    id = watcher.id
    has[id] = null
    watcher.run()
  }

  // keep copies of post queues before resetting state
  const activatedQueue = activatedChildren.slice() // 保存当前新的被唤醒的组件的队列的副本
  const updatedQueue = queue.slice() // 保存当前执行的watcher队列的副本

  resetSchedulerState() // 重置调度器状态

  // call component updated and activated hooks
  callActivatedHooks(activatedQueue) // 对于唤醒的组件，逐个调用唤醒的生命周期钩子
  callUpdatedHooks(updatedQueue) // 对于执行更新的组件，逐个调用更新的生命周期钩子

  // devtool hook
  /* istanbul ignore if */
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

function callUpdatedHooks (queue) {
  // 遍历所有执行的watcher，如果是组件的render watcher，
  // 并且该组件已被挂在、未被销毁
  // 那么调用该组件的updated生命周期钩子
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    if (vm._watcher === watcher && vm._isMounted && !vm._isDestroyed) {
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent (vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 * 
 * 将一个watcher加入watcher队列，重复的watcher不会被加入
 * 特殊情况，如果队列在执行的过程中，那么已经执行完毕的watcher
 * 是可能再次被加入watcher队列的
 */
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  if (has[id] == null) { // 已经加入队列的watcher不重复加入
    has[id] = true
    if (!flushing) {
      // 如果尚未开始执行队列中的watcher，那么简单入队即可
      queue.push(watcher)
    } else {
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.
      // 如果队列已经开始执行了，那么按watcherid插入队列的对应位置，等到执行
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
    if (!waiting) {
      // 如果这是队列清空后第一个加入队列的watcher，
      // 那么还需要主动注册一下在微任务中异步“冲刷”队列
      waiting = true

      nextTick(flushSchedulerQueue)
    }
  }
}
