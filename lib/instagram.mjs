import {
  canonicalInstagramUrl,
  fetchWithTimeout,
  instagramShortcode,
  normalizeCaption,
} from "./util.mjs";

const OEMBED_ENDPOINT = "https://www.instagram.com/api/v1/oembed/";

export async function fetchInstagramOEmbed(url, { cacheGet, setCache } = {}) {
  const canonical = canonicalInstagramUrl(url);
  if (!canonical) return { ok: false, reason: "invalid-url" };
  const shortcode = instagramShortcode(canonical);
  const cached = cacheGet?.("oembed", shortcode);
  if (cached) return cached;

  let result;
  try {
    const response = await fetchWithTimeout(
      `${OEMBED_ENDPOINT}?url=${encodeURIComponent(canonical)}`,
      {
        headers: {
          accept: "application/json, text/plain, */*",
          "x-ig-app-id": "936619743392459",
          referer: "https://www.instagram.com/",
        },
      },
      15_000,
    );
    if (!response.ok) {
      result = {
        ok: false,
        reason: response.status === 403 ? "private-or-restricted" : `http-${response.status}`,
      };
    } else {
      const data = await response.json();
      result = {
        ok: true,
        caption: normalizeCaption(data.title ?? ""),
        author: String(data.author_name ?? "").trim() || null,
        authorUrl: String(data.author_url ?? "").trim() || null,
        authorId: data.author_id ?? null,
        mediaId: data.media_id ?? null,
        thumbnailUrl: String(data.thumbnail_url ?? "").trim() || null,
        width: Number(data.thumbnail_width) || null,
        height: Number(data.thumbnail_height) || null,
      };
    }
  } catch (error) {
    result = { ok: false, reason: error.name === "AbortError" ? "timeout" : "network" };
  }

  setCache?.(
    "oembed",
    shortcode,
    result,
    result.ok ? 1000 * 60 * 60 * 24 * 7 : 1000 * 60 * 60 * 6,
  );
  return result;
}

export function isAllowedImageHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return (
    host.endsWith(".fbcdn.net") ||
    host.endsWith(".cdninstagram.com") ||
    host === "instagram.com" ||
    host === "www.instagram.com"
  );
}
