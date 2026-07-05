const { contextBridge, ipcRenderer } = require('electron')

// Bridge the screenshot-import capabilities to the renderer. Only these
// whitelisted calls cross the isolation boundary.
contextBridge.exposeInMainWorld('hauler', {
  /** Absolute path of the folder OBS should drop screenshots into. */
  getCapturesDir: () => ipcRenderer.invoke('hauler:get-dir'),
  /** Open a folder picker to change the screenshot folder; resolves to the current path. */
  pickCapturesDir: () => ipcRenderer.invoke('hauler:pick-dir'),
  /** List capture images, newest first: [{ path, name, mtime }]. */
  listCaptures: () => ipcRenderer.invoke('hauler:list-captures'),
  /** Return a data: URL of a capture image, for on-device OCR. */
  readImage: (filePath) => ipcRenderer.invoke('hauler:read-image', filePath),
  /** Open a file dialog to pick a .glb/.gltf model; resolves to its path or null. */
  pickModel: () => ipcRenderer.invoke('hauler:pick-model'),
  /** Return a data: URL of a model file, for the GLTF loader. */
  readModel: (filePath) => ipcRenderer.invoke('hauler:read-model', filePath),
  /** Subscribe to new-capture events. Returns an unsubscribe function. */
  onNewCapture: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('hauler:new-capture', handler)
    return () => ipcRenderer.removeListener('hauler:new-capture', handler)
  },
})
