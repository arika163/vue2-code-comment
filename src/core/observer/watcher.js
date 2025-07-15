/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  invokeWithErrorHandling,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 * 
 * watcher是一个订阅者，可以订阅很多依赖，并会在依赖发生变化时
 * 以某种约定的形式触发回调
 */
export default class Watcher {
  vm: Component; // 仅render watcher有该属性，表示当前watcher是那个vue实例的render watcher
  cb: Function; // 回调函数，执行回调的时候会被调用
  id: number; // 一个自增的watcher id，其自增特性其他逻辑会用到
  deep: boolean; // 是否递归监听对象所有内部属性的变化
  user: boolean; // 标记这是否是一个user watcher（区别于render watcher）
  lazy: boolean; // 用于支持计算属性的需要，lazy可以使watcher不要立即求值
  sync: boolean; // 以同步方式立即执行watcher
  dirty: boolean;  // 与lazy成对使用，标记当前watcher的依赖已经变化了，需要重新求值（如果dirty没变，那么可以继续使用缓存的值）
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function; // 创建watcher的时候传入的expOrFn，最后被会统一为一个getter方法
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    // 如果这是一个render watcher，那么需要把自己挂到对应的vue实例上面去
    if (isRenderWatcher) {
      vm._watcher = this
    }
    vm._watchers.push(this)
    // options
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.lazy = !!options.lazy
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // for lazy watchers
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    this.value = this.lazy
      ? undefined
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   * 执行getter，获取当前订阅对象的值，同时进行一轮依赖收集
   */
  get () {
    // 将当前watcher设置为全局唯一的订阅者
    // 这样后续访问到各种属性的时候，
    // 其Dep都会被当前watcher订阅
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      value = this.getter.call(vm, vm)  // 执行一次取值，完成依赖收集
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      // 如果这个watcher被设置了deep，那么数据的每个属性变化
      // 都应该被当前watcher订阅，因此，
      // 递归将对象的所有属性都访问一下，以彻底进行依赖收集
      if (this.deep) {
        traverse(value)
      }
      // 依赖收集完成，把当前watcher设置从全局唯一订阅者的位置赶下来
      popTarget()
      // 对存储在临时数组里的新收集的依赖进行处理
      // 随后更新当前watcher的依赖队列为正确值
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   * 把被订阅的依赖收集起来
   * 主要是往newDepIds和newDeps里塞
   * 同时，如果是之前没有依赖的新依赖
   * 将自己塞到新依赖的订阅队列里面
   */
  addDep (dep: Dep) {
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   * 完成一轮依赖收集之后，根据newDeps统一清理旧的deps
   */
  cleanupDeps () {
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      // 凡是以前依赖的，现在不依赖了
      // 把自己从依赖的订阅队列里移除
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    // 一通操作让depIds、deps变为当前的依赖列表
    // 并且把几个临时依赖列表清空
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   * 
   * 用于接收依赖变化通知的接口
   * 定义了一个watcher在被通知的时候该怎么做
   * 
   * 对于一个Watcher来说
   * 如果是lazy watcher，那么做脏标记，暂不执行
   * 如果是同步的watcher，那么直接执行掉
   * 其他情况下，将watcher加入队列，等待异步调度
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      this.dirty = true
    } else if (this.sync) {
      this.run()
    } else {
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   * 
   * 用于任务调度的接口
   * 定义watcher回调真正执行时，该怎么做
   */
  run () {
    if (this.active) {
      const value = this.get()
      // 如果watcher的值发生变化
      // 或者watcher观察的是一个对象值
      // 又或者这是一个deep watcher
      // 那么这个watcher就需要被执行
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        if (this.user) {
          const info = `callback for watcher "${this.expression}"`
          invokeWithErrorHandling(this.cb, this.vm, [value, oldValue], this.vm, info)
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   * 
   * 对watcher进行求值
   * 供计算属性（lazy watcher）使用
   */
  evaluate () {
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   * 让全局唯一订阅者，订阅当前watcher的所有依赖
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   * 对所有订阅的依赖取消订阅，并将当前的watcher置为不激活状态
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
