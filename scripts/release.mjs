// Publishes the current version to GitHub Releases, where installed apps pick it up.
//
//   1. npm version patch --no-git-tag-version   (or minor / major)
//   2. git commit -am "Release vX.Y.Z" && git push
//   3. npm run release
//
// The GitHub token comes from $GH_TOKEN, or from the GitHub CLI (`gh auth token`).
// It is only passed to electron-builder for this run and never written to a file.
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${pkg.version}`
const { owner, repo } = pkg.build.publish[0]

// 1. Only publish code that is committed and pushed, so the release matches GitHub.
if (run('git status --porcelain')) fail('Còn thay đổi chưa commit. Commit (và push) trước khi phát hành.')
run('git fetch --quiet')
if (run('git rev-parse HEAD') !== run('git rev-parse @{u}')) fail('Nhánh hiện tại chưa khớp với GitHub. Chạy git push (hoặc git pull) trước.')

// 2. Each release needs a new version number, otherwise installed apps see nothing new.
const existing = spawnSync('gh', ['release', 'view', tag, '-R', `${owner}/${repo}`], { stdio: 'ignore' })
if (existing.status === 0) fail(`Release ${tag} đã tồn tại. Tăng version trước: npm version patch --no-git-tag-version`)

// 3. Token for uploading.
let token = process.env.GH_TOKEN
if (!token) {
  try {
    token = run('gh auth token')
  } catch {
    fail('Không có GitHub token. Đăng nhập bằng "gh auth login" hoặc đặt biến GH_TOKEN.')
  }
}

console.log(`\nPhát hành ${tag} lên github.com/${owner}/${repo} ...\n`)
const env = { ...process.env, GH_TOKEN: token }
for (const args of [['electron-vite', 'build'], ['electron-builder', '--win', '--publish', 'always']]) {
  const r = spawnSync('npx', args, { stdio: 'inherit', env, shell: true })
  if (r.status !== 0) fail(`Lệnh "${args.join(' ')}" thất bại.`)
}

console.log(`\n✓ Đã phát hành ${tag}: https://github.com/${owner}/${repo}/releases/tag/${tag}`)
console.log('  Các máy đã cài app sẽ tự tải bản này ở lần mở app tiếp theo.\n')
