module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // ox (viem's dependency, pulled in at a newer version via permissionless)
  // uses `export * as X from 'module'` namespace re-export syntax, which
  // @react-native/babel-preset doesn't transform on its own — Metro's
  // release-bundle step fails with "Export namespace should be first
  // transformed by @babel/plugin-transform-export-namespace-from"
  // otherwise. Already present in node_modules (a transitive dependency),
  // just never wired into this config until ox's newer syntax needed it.
  plugins: ['@babel/plugin-transform-export-namespace-from'],
};
