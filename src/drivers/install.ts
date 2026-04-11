export interface InstallOptions {
  pg?: unknown
}

let installPromise: Promise<void> | undefined
let pgUninstall: (() => void) | undefined

export async function install(options?: InstallOptions): Promise<void> {
  if (!installPromise) {
    installPromise = doInstall(options)
  }
  return installPromise
}

async function doInstall(options?: InstallOptions): Promise<void> {
  try {
    const pgHook = await import('./pg.js')
    pgHook.installPgHook(options?.pg as Parameters<typeof pgHook.installPgHook>[0])
    pgUninstall = pgHook.uninstallPgHook
  } catch {
    // pg not available
  }
}

export function uninstall(): void {
  pgUninstall?.()
  pgUninstall = undefined
  installPromise = undefined
}
