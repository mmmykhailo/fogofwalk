export function getStorageDescription(
  canSync: boolean,
  purgedCount: number | null
): string {
  if (purgedCount === null) {
    return "Delete tracks from server or export your data"
  }

  const suffix = purgedCount === 1 ? "" : "s"
  return `Removed ${purgedCount} track${suffix} from the server`
}

export function getExportButtonLabel(
  isExporting: boolean,
  exportSuccess: boolean
): string {
  if (isExporting) {
    return "Exporting…"
  }

  if (exportSuccess) {
    return "Downloaded!"
  }

  return "Export my data"
}
