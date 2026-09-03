/**
 * 字符串处理工具
 */

/** 将字符串中的单词边界(空格、中划线、下划线、驼峰)切分为小写词元数组 */
function wordSegments(input: string): string[] {
  return input
    .trim()
    .replace(/([a-z\d])([A-Z])/g, '$1 $2') // 驼峰拆分
    .replace(/[^a-zA-Z0-9]+/g, ' ') // 其余分隔符统一为空格
    .split(' ')
    .filter(Boolean)
}

/** 首字母大写(其余字符不变) */
export function capitalize(input: string): string {
  if (input.length === 0) return input
  return input[0].toUpperCase() + input.slice(1)
}

/** 转 camelCase:hello-world -> helloWorld */
export function camelCase(input: string): string {
  const segments = wordSegments(input)
  if (segments.length === 0) return ''
  const [first, ...rest] = segments.map((seg) => seg.toLowerCase())
  return first + rest.map((seg) => capitalize(seg)).join('')
}

/** 转 PascalCase:hello-world -> HelloWorld */
export function pascalCase(input: string): string {
  return capitalize(camelCase(input))
}

/** 转 kebab-case:helloWorld -> hello-world */
export function kebabCase(input: string): string {
  return wordSegments(input)
    .map((seg) => seg.toLowerCase())
    .join('-')
}

/** 转 snake_case:helloWorld -> hello_world */
export function snakeCase(input: string): string {
  return wordSegments(input)
    .map((seg) => seg.toLowerCase())
    .join('_')
}

/**
 * 按最大长度截断字符串,超出部分以省略号结尾。
 * @param length 期望的最大字符数
 * @param omission 截断后缀,默认 '...'
 */
export function truncate(input: string, length: number, omission = '...'): string {
  if (length <= 0) return omission
  if (input.length <= length) return input
  return input.slice(0, Math.max(0, length - omission.length)) + omission
}

/** 判断字符串是否以指定前缀开头 */
export function startsWith(input: string, prefix: string): boolean {
  return input.startsWith(prefix)
}

/** 判断字符串是否以指定后缀结尾 */
export function endsWith(input: string, suffix: string): boolean {
  return input.endsWith(suffix)
}
