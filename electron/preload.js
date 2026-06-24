// Preload runs in renderer context with access to Node APIs if needed.
// Keep it minimal — only expose what the frontend actually needs.
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('gael', {
  version: process.env.npm_package_version ?? '1.0.0',
})
