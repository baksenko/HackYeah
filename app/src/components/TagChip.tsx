import { Link } from 'react-router-dom'

import type { Tag } from '../lib/tags'

/** A tag. As a link it opens the campaign search filtered by that tag. */
export function TagChip({ tag, link = false }: { tag: Tag; link?: boolean }) {
  const content = (
    <>
      <span aria-hidden>{tag.emoji}</span> {tag.label}
    </>
  )
  return link ? (
    <Link to={`/campaigns?tags=${tag.slug}`} className="tag tag-link">
      {content}
    </Link>
  ) : (
    <span className="tag">{content}</span>
  )
}
