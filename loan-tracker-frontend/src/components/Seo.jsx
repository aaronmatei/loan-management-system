// Per-page SEO tags. Relies on React 19's built-in document metadata support:
// <title>/<meta>/<link> rendered here are hoisted into <head>. Render exactly
// ONE <Seo> per page (on the public/marketing routes) so each route gets its
// own title, description, canonical and Open Graph/Twitter text without
// duplicating the global tags in index.html.
const BASE = "https://lenderfest.loans";

export default function Seo({ title, description, path = "/" }) {
  const url = BASE + (path === "/" ? "/" : path.replace(/\/$/, ""));
  return (
    <>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:url" content={url} />
      <meta name="twitter:title" content={title} />
      {description && <meta name="twitter:description" content={description} />}
    </>
  );
}
