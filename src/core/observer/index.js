/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 *
 * observer类的实例会被附加到每个被观察的对象之上
 * observer会将目标对象的属性转为特殊的getter和setter
 * 从而实现依赖订阅和依赖通知
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor (value: any) {
    this.value = value
    this.dep = new Dep() // 响应式对象的ob中也有一个dep，可以收集订阅者
    this.vmCount = 0
    def(value, '__ob__', this)
    if (Array.isArray(value)) { // 对数组和对象做不同的处理
      // 对于数组，如果当前环境支持原型链，就通过替换原型来拦截数组原生方法
      // 如果不支持原型链，就通过直接在数组上定义方法的方式拦截数组原生方法
      if (hasProto) {
        protoAugment(value, arrayMethods)
      } else {
        copyAugment(value, arrayMethods, arrayKeys)
      }
      // 遍历数组的所有元素，并对其中的对象元素进行响应式化
      this.observeArray(value)
    } else {
      // 对于对象，递归遍历所有属性
      // 对所有属性进行响应式化
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   *
   * 遍历一个对象的所有属性，通过defineReactive对该属性进行响应式化
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   * 对数组中的所有对象元素进行响应式化
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 * 将传入的对象作为目标的原型
 */
function protoAugment (target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 * 将传入的对象中的某些属性隐式拷贝到目标上
 */
/* istanbul ignore next */
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 * 对一个值进行响应式化，成功时返回新的observer
 * 如果已经响应式化过了，直接返回旧的
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  // 这个函数只处理对象和vnode，其他情况直接返回
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    // 已经响应式化过了，不用再响应式化了
    ob = value.__ob__
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    // 没有响应式化过，就响应式化一次
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 * 对对象上的单个属性进行响应式化
 * 响应式化后，该属性会对应一个Dep容器
 * 因此，该属性也就可以被订阅了
 * 
 * 一句话描述：
 * 在getter中收集依赖、在setter中触发依赖变化的通知
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  // 在方法闭包中创建一个Dep
  // 用于收集该属性的所有订阅者
  const dep = new Dep()

  // 不可配置的属性不能响应式化，返回
  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  // 有getter没setter，说明这是一个只读的访问器属性（Accessor Property）
  if ((!getter || setter) && arguments.length === 2) {
    // 如果不是只读的访问器属性，并且调用的时候没有传递值进来，
    // 那么，获取一下当前属性的值
    val = obj[key]
  }

  let childOb = !shallow && observe(val) // 如果值是对象，那么这个对象也需要被响应式化

  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      // 在getter中收集依赖

      // 如果这个属性本身是有getter的，把旧的getter先执行下
      const value = getter ? getter.call(obj) : val
      
      // 将全局唯一的订阅者收集到Dep中
      // 分多种场景
      // 1.如果当前属性是个普通属性，那么订阅者只收集到当前defineReactive闭包中的dep内
      // 2.如果当前属性是个响应式对象，那么订阅者还需要收集到响应式对象的ob的dep中
      // 3.如果当前属性是个数组，那么订阅者还需要收集到数组中所有响应对象元素的ob的dep中
      if (Dep.target) {
      // 将订阅者塞到当前闭包里的dep中
        dep.depend() 
        if (childOb) {
          // 将订阅者塞到响应式对象的ob的dep中
          childOb.dep.depend()
          if (Array.isArray(value)) {
            // 递归使数组中的每个响应式对象都被全局唯一的订阅者订阅
            // 这是一些特殊场景的暴力保底手段（因为数组索引是不做响应式化的）
            // 比如：我们在数组的一个对象元素上，通过$set添加一个属性
            // 这种场景下，如果不走这个依赖收集流程，订阅者就没办法收到通知
            // github上有尤大的说明：https://github.com/vuejs/vue/issues/6284#issuecomment-326686494
            dependArray(value) 
          }
        }
      }
      return value
    },
    set: function reactiveSetter (newVal) {
      // 如果这个属性本身是有getter的，把旧的getter先执行下,取一下最新的值
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      // 下面这行代码的自己和自己比较，是个非常精辟的设计
      // 主要用于判断旧值和新值都是NaN的情况
      // 如果旧值自己和自己不相等，且新值自己和自己不相等
      // 那么可以说明旧值和新值都是NaN，也就是没有发生变化
      if (newVal === value || (newVal !== newVal && value !== value)) { 
        return // 如果值没有发生变化，就不用接着执行了
      }
      // #7981: for accessor properties without setter
      // 没有setter只有getter的访问器属性，本质上只读的
      // 因此后面的逻辑就全都不用执行了
      if (getter && !setter) return
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      childOb = !shallow && observe(newVal) // 如果新值是一个对象，那么需要对其执行响应式化
      dep.notify() // 由于属性的值发生了变化，对所有订阅者发出通知
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 * 
 * 在对象上响应式地添加新属性
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    // 为数组添加一个新的元素，走数组自己的api
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  if (key in target && !(key in Object.prototype)) {
    // 对于已经存在的属性，不做特殊处理
    target[key] = val
    return val
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    // 运行时不要往vue实例及其$data上设置属性
    // 直接返回不作处理
    return val
  }
  // 对于没有响应式化的对象，也不做处理
  if (!ob) {
    target[key] = val
    return val
  }

  // 核心逻辑：
  // 对新增属性进行响应式化，并对对象的订阅者发起通知
  defineReactive(ob.value, key, val)
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 * 
 * 在对象上响应式地删除新属性
 */
export function del (target: Array<any> | Object, key: any) {
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    // 如果传进来是个数组，走数组自己的api
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    // 不要通过这个函数来删除vue实例和其$data上的属性，而是应该设置为null
    // 遇到这种情况直接return
    return
  }
  if (!hasOwn(target, key)) {
    // 删除不存在的属性，直接返回
    return
  }

  // 核心逻辑：
  // 删除属性并对当前对象的所有订阅者发出通知
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 * 
 * 使数组中的每个响应式对象都被全局唯一的订阅者订阅
 * 如果数组的元素是数组，那么递归调用自身
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    // 对于数组的每个元素，如果是响应式对象
    // 那么将全局唯一订阅者收集到该响应式对象的ob的dep中
    e && e.__ob__ && e.__ob__.dep.depend()
    // 此外，如果元素还是数组，那么递归调用自身
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
