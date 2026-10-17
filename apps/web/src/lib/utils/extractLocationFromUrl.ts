export const extractLocationFromUrl = (fullUrl: string): string | null => {
  try {
    const url = new URL(fullUrl, 'http://localhost');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const location = url.pathname
      .replace(/^\/assets\//, '/')
      .replace(/^\/cdn-cgi\/image\/[^/]+\//, '/')
      .slice(1);
    return location ? `${location}${url.search}` : null;
  } catch {
    return null;
  }
};
