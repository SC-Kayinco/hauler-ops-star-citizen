export interface CaptureFile {
  path: string
  name: string
  mtime: number
}

/** Bridge exposed by electron/preload.cjs — only present in the desktop app. */
export interface HaulerBridge {
  getCapturesDir: () => Promise<string>
  listCaptures: () => Promise<CaptureFile[]>
  readImage: (filePath: string) => Promise<string | null>
  onNewCapture: (cb: (file: CaptureFile) => void) => () => void
  /** Open a native file dialog to choose a .glb/.gltf model; null if cancelled. */
  pickModel: () => Promise<string | null>
  /** Read a model file as a data: URL for the GLTF loader; null on failure. */
  readModel: (filePath: string) => Promise<string | null>
  /** Open a folder picker to change the screenshot folder; resolves to the current path. */
  pickCapturesDir: () => Promise<string>
}

declare global {
  interface Window {
    hauler?: HaulerBridge
  }
  /** Build-time app version, injected by Vite's `define` (see vite.config.ts). */
  const __APP_VERSION__: string
}
