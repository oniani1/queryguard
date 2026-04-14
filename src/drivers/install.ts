export interface InstallOptions {
  pg?: unknown
  mysql2?: unknown
}

let installPromise: Promise<void> | undefined
let pgUninstall: (() => void) | undefined
let mysql2Uninstall: (() => void) | undefined

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

  try {
    const mysql2Hook = await import('./mysql2.js')
    mysql2Hook.installMysql2Hook(
      options?.mysql2 as Parameters<typeof mysql2Hook.installMysql2Hook>[0],
    )
    mysql2Uninstall = mysql2Hook.uninstallMysql2Hook
  } catch {
    // mysql2 not available
  }
}

export function uninstall(): void {
  pgUninstall?.()
  pgUninstall = undefined
  mysql2Uninstall?.()
  mysql2Uninstall = undefined
  installPromise = undefined
}
