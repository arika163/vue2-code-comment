/* @flow */
/* globals MutationObserver */

import { noop } from 'shared/util'
import { handleError } from './error'
import { isIE, isIOS, isNative } from './env'

export let isUsingMicroTask = false

const callbacks = [] // 缓存一段时间内通过nextTick注册进来的所有待执行任务
let pending = false // 标志回调队列的下一轮执行是否已经注册

function flushCallbacks () {
  // TODO：这里浅拷贝一次的意义是什么？
  // 为什么不一边冲刷，一边往队列里加入新的内容？
  // 是不希望一个微任务太长吗？
  pending = false
  const copies = callbacks.slice(0) // 浅拷贝一份当前待执行的任务 
  callbacks.length = 0 // 然后将当前待执行的任务队列置空 
  for (let i = 0; i < copies.length; i++) {
    copies[i]() // 逐个执行当前队列中的回调
  }
}

// Here we have async deferring wrappers using microtasks.
// In 2.5 we used (macro) tasks (in combination with microtasks).
// However, it has subtle problems when state is changed right before repaint
// (e.g. #6813, out-in transitions).
// Also, using (macro) tasks in event handler would cause some weird behaviors
// that cannot be circumvented (e.g. #7109, #7153, #7546, #7834, #8109).
// So we now use microtasks everywhere, again.
// A major drawback of this tradeoff is that there are some scenarios
// where microtasks have too high a priority and fire in between supposedly
// sequential events (e.g. #4521, #6690, which have workarounds)
// or even between bubbling of the same event (#6566).
let timerFunc

// The nextTick behavior leverages the microtask queue, which can be accessed
// via either native Promise.then or MutationObserver.
// MutationObserver has wider support, however it is seriously bugged in
// UIWebView in iOS >= 9.3.3 when triggered in touch event handlers. It
// completely stops working after triggering a few times... so, if native
// Promise is available, we will use it:
/* istanbul ignore next, $flow-disable-line */
if (typeof Promise !== 'undefined' && isNative(Promise)) {
  // 如果当前环境原生支持Promise，那就使用Promise来实现异步
  const p = Promise.resolve()
  timerFunc = () => {
    p.then(flushCallbacks)
    // In problematic UIWebViews, Promise.then doesn't completely break, but
    // it can get stuck in a weird state where callbacks are pushed into the
    // microtask queue but the queue isn't being flushed, until the browser
    // needs to do some other work, e.g. handle a timer. Therefore we can
    // "force" the microtask queue to be flushed by adding an empty timer.
    // 针对存在缺陷的环境，入队一个宏任务，使后续的微任务可以得到执行
    if (isIOS) setTimeout(noop)
  }
  isUsingMicroTask = true
} else if (!isIE && typeof MutationObserver !== 'undefined' && (
  isNative(MutationObserver) ||
  // PhantomJS and iOS 7.x
  MutationObserver.toString() === '[object MutationObserverConstructor]'
)) {
  // Use MutationObserver where native Promise is not available,
  // e.g. PhantomJS, iOS7, Android 4.4
  // (#6466 MutationObserver is unreliable in IE11)
  // 原生Promise无法使用的场景，使用MutationObserver来创建微任务
  let counter = 1
  const observer = new MutationObserver(flushCallbacks)
  const textNode = document.createTextNode(String(counter))
  observer.observe(textNode, {
    characterData: true
  })
  timerFunc = () => {
    counter = (counter + 1) % 2 // 通过奇数和偶数的切换，触发MutationObserver的回调
    textNode.data = String(counter)
  }
  isUsingMicroTask = true
} else if (typeof setImmediate !== 'undefined' && isNative(setImmediate)) {
  // Fallback to setImmediate.
  // Technically it leverages the (macro) task queue,
  // but it is still a better choice than setTimeout.
  // 上面的都不支持，退行为利用setImmediate来实现
  // 虽然都是宏任务，但setImmediate一般会比setTimeout更早执行
  timerFunc = () => {
    setImmediate(flushCallbacks)
  }
} else {
  // Fallback to setTimeout.
  // 上面的都不支持，退行为利用setTimeout来实现
  timerFunc = () => {
    setTimeout(flushCallbacks, 0)
  }
}

export function nextTick (cb?: Function, ctx?: Object) {
  let _resolve
  callbacks.push(() => { // 包装成一个函数，加入待执行的回调队列
    if (cb) {
      try {
        cb.call(ctx) // 执行异步回调
      } catch (e) {
        handleError(e, ctx, 'nextTick')
      }
    } else if (_resolve) {
      // 无参调用的场合，返回一个promise，在这个回调执行后
      // Promise会进入fullfilled状态
      _resolve(ctx)
    }
  })
  if (!pending) {
    // 如果当前没有待执行的下一轮异步“冲刷”，那么通过timerFunc来注册一个
    pending = true
    timerFunc()
  }
  // $flow-disable-line
  // returns a Promise if no callback is provided and Promise is supported in the execution environment. 
  // 无参调用的场合，返回一个promise
  if (!cb && typeof Promise !== 'undefined') {
    return new Promise(resolve => {
      _resolve = resolve
    })
  }
}
