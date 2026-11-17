// Publishes the current version to GitHub Releases, where installed apps pick it up.
//
//   1. npm version patch --no-git-tag-version   (or minor / major)
//   2. git commit -am "Release vX.Y.Z" && git push
//   3. npm run release
//
// electron-builder only builds here; the GitHub CLI (`gh`, already logged in) creates the
// release and uploads the files. If a previous run stopped half-way, running it again
// finishes the upload.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const version = pkg.version
const tag = `v${version}`
const { owner, repo } = pkg.build.publish[0]
const repoArg = `${owner}/${repo}`

// 1. Only publish code that is committed and pushed, so the release matches GitHub.
if (run('git', ['status', '--porcelain'])) fail('Còn thay đổi chưa commit. Commit (và push) trước khi phát hành.')
run('git', ['fetch', '--quiet'])
const head = run('git', ['rev-parse', 'HEAD'])
if (head !== run('git', ['rev-parse', '@{u}'])) fail('Nhánh hiện tại chưa khớp với GitHub. Chạy git push (hoặc git pull) trước.')

// 2. Each release needs a new version number. A release that exists but has no
//    latest.yml was interrupted, so we finish it instead of refusing.
let existingAssets = null
try {
  existingAssets = JSON.parse(run('gh', ['release', 'view', tag, '-R', repoArg, '--json', 'assets'])).assets.map((a) => a.name)
} catch {
  /* release does not exist yet */
}
if (existingAssets?.includes('latest.yml')) {
  fail(`Release ${tag} đã phát hành rồi. Tăng version trước: npm version patch --no-git-tag-version`)
}

// 3. Build the installer and latest.yml (the file installed apps read to find updates).
console.log(`\nĐóng gói ${tag} ...\n`)
for (const args of [['electron-vite', 'build'], ['electron-builder', '--win', '--publish', 'never']]) {
  const r = spawnSync('npx', args, { stdio: 'inherit', cwd: projectRoot, shell: true })
  if (r.status !== 0) fail(`Lệnh "${args.join(' ')}" thất bại.`)
}

const outDir = path.join(projectRoot, pkg.build.directories.output)
const latestYml = readFileSync(path.join(outDir, 'latest.yml'), 'utf8')
if (!latestYml.includes(`version: ${version}`)) fail(`latest.yml không phải của bản ${version}.`)

// latest.yml refers to the installer as "Study-Docs-Setup-x.y.z.exe" (spaces -> dashes),
// so the uploaded files must use exactly those names.
const installer = `${pkg.build.productName} Setup ${version}.exe`
const uploadName = (f) => f.replace(/ /g, '-')
const staging = path.join(outDir, `upload-${version}`)
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
const files = [installer, `${installer}.blockmap`, 'latest.yml'].map((f) => {
  const src = path.join(outDir, f)
  if (!existsSync(src)) fail(`Không tìm thấy ${src}`)
  const dest = path.join(staging, uploadName(f))
  copyFileSync(src, dest)
  return dest
})

// 4. Create the release (tagged at the pushed commit) or finish an interrupted one.
console.log(`\nTải lên GitHub ...\n`)
const ghArgs = existingAssets
  ? ['release', 'upload', tag, ...files, '--clobber', '-R', repoArg]
  : ['release', 'create', tag, ...files, '--target', head, '--title', tag, '--notes', `Study Docs ${tag}`, '-R', repoArg]
const r = spawnSync('gh', ghArgs, { stdio: 'inherit', cwd: projectRoot })
if (r.status !== 0) fail('Tải lên GitHub thất bại. Chạy lại "npm run release" để thử tiếp.')
rmSync(staging, { recursive: true, force: true })

console.log(`\n✓ Đã phát hành ${tag}: https://github.com/${repoArg}/releases/tag/${tag}`)
console.log('  Các máy đã cài app sẽ tự tải bản này ở lần mở app tiếp theo.\n')
