import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only this checkout's tests: not build output, and not copies of the repo that tools
    // put inside the project (e.g. git worktrees under .claude/).
    exclude: [...configDefaults.exclude, '.claude/**', 'out/**', 'release/**']
  }
})
