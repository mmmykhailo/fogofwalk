interface ChangelogContentsProps {
  changelog: string
}

interface Release {
  version: string
  date: string
  sections: Array<{ title: string; changes: string[] }>
}

function parseChangelog(changelog: string): Release[] {
  const releases: Release[] = []
  let release: Release | undefined
  let section: Release["sections"][number] | undefined

  for (const line of changelog.split("\n")) {
    const releaseMatch = /^## \[([^\]]+)] - (.+)$/.exec(line)
    if (releaseMatch) {
      release = {
        version: releaseMatch[1],
        date: releaseMatch[2],
        sections: [],
      }
      releases.push(release)
      section = undefined
      continue
    }

    const sectionMatch = /^### (.+)$/.exec(line)
    if (sectionMatch && release) {
      section = { title: sectionMatch[1], changes: [] }
      release.sections.push(section)
      continue
    }

    if (line.startsWith("- ") && section) {
      section.changes.push(line.slice(2))
    }
  }

  return releases
}

export function ChangelogContents({ changelog }: ChangelogContentsProps) {
  return (
    <div className="space-y-10">
      {parseChangelog(changelog).map((release) => (
        <section key={release.version}>
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl font-semibold">Version {release.version}</h2>
            <time className="text-sm text-muted-foreground">
              {release.date}
            </time>
          </div>
          <div className="space-y-5">
            {release.sections.map((section) => (
              <div key={section.title}>
                <h3 className="mb-2 font-medium">{section.title}</h3>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {section.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
