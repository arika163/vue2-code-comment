/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from '../util/index'

// 创建一个空对象并继承Array的原型，这样就继承了所有的Array方法
const arrayProto = Array.prototype
export const arrayMethods = Object.create(arrayProto)

// 定义数组原型上哪些方法需要拦截并调整
// 这些方法都会使数组内容发生变化
const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 * 对数组原型上需要调整的方法进行拦截，调整后的方法会触发依赖通知
 * 此外，如果通过调整后的方法插入对象，那么对新插入的对象进行响应式化
 */
methodsToPatch.forEach(function (method) {
  // cache original method
  const original = arrayProto[method]
  def(arrayMethods, method, function mutator (...args) {
    const result = original.apply(this, args)
    const ob = this.__ob__
    let inserted
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    // 对新插入的元素执行响应式化
    if (inserted) ob.observeArray(inserted)
    // notify change
    // 对所有依赖发起通知
    ob.dep.notify()
    return result
  })
})
