#!/usr/bin/env node
/**
 * pnpm version 的替代实现:在 Changesets 落版本的同时,按提交类型分组生成 CHANGELOG。
 *
 * 为什么不用 Changesets 自带的 changelog 插件?
 * 其插件 API 仅暴露 getReleaseLine / getDependencyReleaseLine(逐条、由 CLI 线性拼接),
 * 无法把一次 release 重排成 💥 Breaking / 🚀 Features / 🐛 Bug Fixes / ⚡ Performance /
 * 📚 Docs & Refactor 五个固定模块。故 config.json 中 `changelog: false`,
 * 由本脚本在真实 `changeset version` 前后接管整份 CHANGELOG 的组装。
 *
 * 流程:
 *  1. 解析并缓存 .changeset/*.md(frontmatter 包名→bump 类型 + summary);
 *  2. 快照所有子包当前版本;
 *  3. 执行真实 `changeset version` 更新版本、消费 changeset;
 *  4. 对比版本快照得到本轮变更包;
 *  5. 为每个变更包按 summary 前缀分类聚合,prepend 到其 CHANGELOG.md。
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const changesetDir = join(repoRoot, '.changeset')
const packagesDir = join(repoRoot, 'packages')

const log = (message) => console.log(`[release] ${message}`)
const error = (message) => {
  console.error(`[release] ${message}`)
  process.exit(1)
}

// ---------- 1. 解析 changeset ----------

/** 解析单个 changeset 文件:返回 { releases: 包名→bump 类型, summary } 或 null */
function parseChangeset(raw) {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/)
  if (!match) return null
  const releases = {}
  for (const line of match[1].split('\n')) {
    const entry = line.trim().match(/^['"]?([^'":\s]+)['"]?\s*:\s*(major|minor|patch|none)\s*$/)
    if (entry) releases[entry[1]] = entry[2]
  }
  return { releases, summary: match[2].trim() }
}

function readChangesets() {
  if (!existsSync(changesetDir)) return []
  return readdirSync(changesetDir)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort()
    .map((file) => {
      const parsed = parseChangeset(readFileSync(join(changesetDir, file), 'utf8'))
      return parsed ? { file, ...parsed } : null
    })
    .filter(Boolean)
}

// ---------- 2. 版本快照 ----------

function readPackageMeta(dir) {
  const pkgPath = join(packagesDir, dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  const json = JSON.parse(readFileSync(pkgPath, 'utf8'))
  return { dir, name: json.name, version: json.version, pkg: json }
}

function snapshotVersions() {
  const map = new Map()
  for (const dir of readdirSync(packagesDir)) {
    const meta = readPackageMeta(dir)
    if (meta) map.set(meta.name, meta.version)
  }
  return map
}

// ---------- 3. 分类与渲染 ----------

const SECTION_ORDER = ['breaking', 'features', 'bugfixes', 'performance', 'docs']
const SECTION_HEADING = {
  breaking: '💥 Breaking Changes 破坏性更新',
  features: '🚀 Features 新功能',
  bugfixes: '🐛 Bug Fixes 问题修复',
  performance: '⚡ Performance 性能优化',
  docs: '📚 Docs & Refactor 文档与重构',
}
const DEPS_HEADING = '⬆️ 依赖更新 Dependencies'

const FEATURE_TYPES = new Set(['feat', 'feature', 'features'])
const FIX_TYPES = new Set(['fix', 'bug', 'bugfix', 'hotfix'])
const PERF_TYPES = new Set(['perf', 'performance', 'optimize', 'optimization'])
const DOCS_TYPES = new Set([
  'docs',
  'refactor',
  'chore',
  'test',
  'style',
  'build',
  'ci',
  'revert',
  'types',
  'deps',
])

/** 从 summary 首行提取提交类型(如 'feat: ...' / 'fix(utils): ...'),无前缀返回 null */
function extractType(summary) {
  const firstLine = summary.split(/\r?\n/)[0] ?? ''
  const match = firstLine.match(/^([a-zA-Z]+)(?:\([^)]*\))?!?:/)
  return match ? match[1].toLowerCase() : null
}

/** 根据提交类型 + 该包的 bump 级别判定 changelog 分组 */
function categorize(type, bump) {
  if (bump === 'major') return 'breaking'
  if (type === 'break' || type === 'breaking') return 'breaking'
  if (type && FEATURE_TYPES.has(type)) return 'features'
  if (type && FIX_TYPES.has(type)) return 'bugfixes'
  if (type && PERF_TYPES.has(type)) return 'performance'
  if (type && DOCS_TYPES.has(type)) return 'docs'
  // 无前缀或未知前缀:按 bump 级别兜底
  return bump === 'minor' ? 'features' : 'bugfixes'
}

/** 渲染单条 changelog 列表项(去除类型前缀,续行缩进) */
function renderBullet(summary) {
  const lines = summary.split(/\r?\n/).map((line) => line.trimEnd())
  const first = lines[0] ?? ''
  const prefix = first.match(/^[a-zA-Z]+(?:\([^)]*\))?!?:\s?/)
  const head = prefix ? first.slice(prefix[0].length) : first
  const out = [`- ${head}`]
  for (const line of lines.slice(1)) {
    if (line.trim() !== '') out.push(`  ${line}`)
  }
  return out.join('\n')
}

/**
 * 依赖发布范围展示:仓库内依赖以 workspace:^ 协议声明(利于本地软链),
 * 发布时由 pnpm 替换为真实版本(经实测 workspace:^ → ^0.1.0)。
 * changelog 依赖块展示发布后的有效范围。
 */
function displayRange(range, newVersion) {
  if (!range.startsWith('workspace:')) return range
  const stripped = range.slice('workspace:'.length)
  if (stripped === '' || stripped === '*') return newVersion
  const op = stripped.match(/^(\^|~|>=|<=|>|<)/)?.[1] ?? ''
  if (op && stripped === op) return `${op}${newVersion}`
  return stripped === '^' || stripped === '~' ? `${stripped}${newVersion}` : stripped
}

/** 取出包内联依赖(在依赖段中使用)。返回对象含每个可能被联动升级的依赖及其新范围。 */
function internalDependencies(pkg) {
  const merged = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) }
  return Object.fromEntries(Object.entries(merged))
}

// ---------- 4. 主流程 ----------

function main() {
  const changesets = readChangesets()
  if (changesets.length === 0) {
    log('未发现待发布的 changeset,跳过(changelog 未更新)')
    return
  }

  const before = snapshotVersions()
  log(`发现 ${changesets.length} 个 changeset,执行 changeset version...`)
  execSync('pnpm exec changeset version', { cwd: repoRoot, stdio: 'inherit' })

  const after = snapshotVersions()
  const changedNames = [...after.keys()].filter((name) => after.get(name) !== before.get(name))
  if (changedNames.length === 0) {
    log('changeset version 未产生版本变更,跳过 changelog 生成')
    return
  }

  log(`本轮版本变更包:${changedNames.join(', ')}`)
  const today = new Date().toISOString().slice(0, 10)
  let wroteAny = false

  for (const name of changedNames) {
    const meta = readPackageMeta(dirOf(name))
    if (!meta) continue
    const newVersion = meta.version

    // 按分类收集本包变更条目
    const bySection = new Map()
    for (const cs of changesets) {
      const bump = cs.releases[name]
      if (!bump || bump === 'none') continue
      const section = categorize(extractType(cs.summary), bump)
      if (!bySection.has(section)) bySection.set(section, [])
      bySection.get(section).push(renderBullet(cs.summary))
    }

    const blocks = []
    for (const section of SECTION_ORDER) {
      const bullets = bySection.get(section)
      if (bullets && bullets.length > 0) {
        blocks.push(`### ${SECTION_HEADING[section]}\n\n${bullets.join('\n')}`)
      }
    }

    // 因内部依赖升级被联动(本包没有自己的 changeset)时,输出依赖更新说明
    const changedSet = new Set(changedNames)
    const depBullets = []
    for (const [depName, range] of Object.entries(internalDependencies(meta.pkg))) {
      if (changedSet.has(depName)) {
        depBullets.push(`- ${depName}@${displayRange(range, after.get(depName))}`)
      }
    }
    if (depBullets.length > 0) blocks.push(`### ${DEPS_HEADING}\n\n${depBullets.join('\n')}`)

    if (blocks.length === 0) continue

    const entry = `## ${newVersion} - ${today}\n\n${blocks.join('\n\n')}`
    const changelogPath = join(packagesDir, meta.dir, 'CHANGELOG.md')
    const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : ''
    // 保留标题等首部,新版本条目插到首个旧版本标题之前
    const firstVersionIdx = existing.indexOf('\n## ')
    const head =
      firstVersionIdx === -1 ? existing.trim() : existing.slice(0, firstVersionIdx).trim()
    const older = firstVersionIdx === -1 ? '' : existing.slice(firstVersionIdx).trim()
    const header = head !== '' ? head : `# ${name}`
    const content = `${header}\n\n${entry}\n\n${older}${older ? '\n' : ''}`
    writeFileSync(changelogPath, content.trimEnd() + '\n', 'utf8')
    wroteAny = true
    log(`✅ ${name} ${before.get(name)} → ${newVersion},已更新 CHANGELOG.md`)
  }

  if (!wroteAny) log('无任何包产生可写入的分组 changelog')
}

function dirOf(packageName) {
  for (const dir of readdirSync(packagesDir)) {
    const meta = readPackageMeta(dir)
    if (meta && meta.name === packageName) return dir
  }
  error(`找不到子包目录:${packageName}`)
}

main()
