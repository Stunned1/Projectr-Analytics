import { permanentRedirect } from 'next/navigation'

/** Legacy/bookmarked URL; docs live at `/guide`. */
export default function DocumentationRedirect() {
  permanentRedirect('/guide')
}
