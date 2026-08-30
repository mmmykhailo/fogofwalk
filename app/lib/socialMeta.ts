const SITE_URL = (
  import.meta.env.VITE_SITE_URL || "https://fog-of-walk.mykhailo.net"
).replace(/\/+$/, "")

export const SOCIAL_IMAGE_URL = `${SITE_URL}/og-image.png`

function absoluteUrl(path: string): string {
  return new URL(path, `${SITE_URL}/`).toString()
}

interface SocialMetaOptions {
  title: string
  description: string
  path: string
  type?: "website" | "profile"
  profileHandle?: string
}

/** Metadata understood by Open Graph consumers, X, Slack, Discord, and iMessage. */
export function socialMeta({
  title,
  description,
  path,
  type = "website",
  profileHandle,
}: SocialMetaOptions) {
  const url = absoluteUrl(path)

  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: type },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:site_name", content: "Fog of Walk" },
    { property: "og:image", content: SOCIAL_IMAGE_URL },
    { property: "og:image:secure_url", content: SOCIAL_IMAGE_URL },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    {
      property: "og:image:alt",
      content: "Fog of Walk — Explore the unknown",
    },
    ...(profileHandle
      ? [{ property: "profile:username", content: profileHandle }]
      : []),
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: SOCIAL_IMAGE_URL },
    {
      name: "twitter:image:alt",
      content: "Fog of Walk — Explore the unknown",
    },
  ]
}
