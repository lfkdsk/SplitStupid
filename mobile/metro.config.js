// Monorepo-aware Metro config. SplitStupid keeps the shared logic in
// ../core as a workspace that ships TypeScript source (no build step), so
// Metro has to (1) watch the repo root to pick up @splitstupid/core, and
// (2) resolve modules from both this app's and the root's node_modules.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

// Watch the whole monorepo so edits to @splitstupid/core hot-reload here.
config.watchFolders = [workspaceRoot]

// Resolve from the app first, then fall back to the hoisted root modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// npm workspaces hoist most deps to the root; don't let Metro follow a
// symlink back into a nested copy.
config.resolver.disableHierarchicalLookup = true

module.exports = config
