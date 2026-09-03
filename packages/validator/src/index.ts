/**
 * @mfr/validator 统一入口
 *
 * 用法示例:
 *   validateField('abc@example.com', [{ name: 'required' }, { name: 'email' }])
 *   validateObject({ email: [{ name: 'required' }, { name: 'email' }] }, { email: '' })
 */

export * from './modules/types'
export * from './modules/rules'
export * from './modules/core'
