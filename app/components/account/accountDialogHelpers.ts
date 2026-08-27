export function getStorageDescription(
  canSync: boolean,
  purgedCount: number | null
): string {
  if (purgedCount === null) {
    if (canSync) {
      return "Delete activities from server or export your data"
    }
    return "See which of your data we have"
  }

  const suffix = purgedCount === 1 ? "" : "s"
  return `Removed ${purgedCount} activity${suffix} from the server`
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
