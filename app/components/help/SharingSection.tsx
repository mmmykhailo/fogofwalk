export function SharingSection() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        Select a track and open the share button to build a portrait image sized
        for a story or a post. You choose:
      </p>
      <ul className="ml-4 list-disc space-y-1">
        <li>
          <strong className="text-foreground">Background</strong> — <em>Map</em>{" "}
          renders a snapshot of the route, <em>Photo</em> uses one of the photos
          matched to that activity (with arrows to pick which), and{" "}
          <em>Dark</em> is a plain backdrop
        </li>
        <li>
          <strong className="text-foreground">Blur</strong> — softens a map or
          photo background so the text stays readable
        </li>
        <li>
          <strong className="text-foreground">Stats</strong> — pick up to four
          of the available numbers to print on the card
        </li>
      </ul>
      <p>
        Then either <strong className="text-foreground">Copy PNG</strong>, to
        paste straight into a chat or post, or{" "}
        <strong className="text-foreground">Download PNG</strong> to save the
        file.
      </p>
      <p>
        If you have a lap selected, the card is built from that lap alone — its
        distance, its time, and only the photos taken during it.
      </p>
    </div>
  )
}
