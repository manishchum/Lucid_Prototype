import React from "react";

export type ModuleMediaType = "image" | "video" | "audio";

export interface ModuleMediaEmbed {
  type: ModuleMediaType;
  src: string;
  title: string;
  description?: string;
  embedId?: string;
}

type MediaSourceKind = "direct" | "youtube" | "google-drive" | "link";

interface ResolvedMediaSource {
  kind: MediaSourceKind;
  url: string;
  embedUrl?: string;
}

type HtmlBlock =
  | { type: "html"; html: string }
  | { type: "media"; media: ModuleMediaEmbed };

const EMBED_BLOCK_REGEX = /<figure\b[^>]*\bclass=("|')[^"']*\bmodule-media-embed\b[^"']*\1[^>]*>[\s\S]*?<\/figure>/gi;

function getAttrValue(tag: string, attrName: string): string {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`${escaped}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = tag.match(matcher);
  if (!match) return "";
  return (match[2] || match[3] || "").trim();
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, "").trim();
}

function decodeHtmlEntities(value: string): string {
  if (typeof window === "undefined") return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function sanitizeMediaUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url, "https://example.local");
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return url;
    }
    return "";
  } catch {
    return "";
  }
}

function hasExtension(url: string, extensions: RegExp): boolean {
  return extensions.test(url.split(/[?#]/)[0]);
}

function getYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "youtu.be") {
      const videoId = parsed.pathname.split("/").filter(Boolean)[0];
      return videoId || null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const searchId = parsed.searchParams.get("v");
      if (searchId) return searchId;

      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts[0] === "embed" || pathParts[0] === "shorts") {
        return pathParts[1] || null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function getGoogleDriveFileId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();

    if (host !== "drive.google.com") return null;

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const fileIndex = pathParts.indexOf("file");
    const dIndex = pathParts.indexOf("d");

    if (fileIndex >= 0 && pathParts[fileIndex + 1] === "d") {
      return pathParts[fileIndex + 2] || null;
    }

    if (dIndex >= 0) {
      return pathParts[dIndex + 1] || null;
    }

    return parsed.searchParams.get("id") || null;
  } catch {
    return null;
  }
}

function resolveMediaSource(url: string, type: ModuleMediaType): ResolvedMediaSource {
  const safeUrl = sanitizeMediaUrl(url);
  if (!safeUrl) {
    return { kind: "link", url: "" };
  }

  const directPatterns: Record<ModuleMediaType, RegExp> = {
    image: /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i,
    video: /\.(mp4|mov|webm|m4v|avi)(?:[?#].*)?$/i,
    audio: /\.(mp3|wav|m4a|aac|ogg|flac)(?:[?#].*)?$/i,
  };

  if (hasExtension(safeUrl, directPatterns[type])) {
    return { kind: "direct", url: safeUrl };
  }

  if (type === "video") {
    const youtubeId = getYouTubeVideoId(safeUrl);
    if (youtubeId) {
      return {
        kind: "youtube",
        url: safeUrl,
        embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
      };
    }

    const driveId = getGoogleDriveFileId(safeUrl);
    if (driveId) {
      return {
        kind: "google-drive",
        url: safeUrl,
        embedUrl: `https://drive.google.com/file/d/${driveId}/preview`,
      };
    }
  }

  if (type === "audio") {
    const driveId = getGoogleDriveFileId(safeUrl);
    if (driveId) {
      return {
        kind: "google-drive",
        url: safeUrl,
        embedUrl: `https://drive.google.com/file/d/${driveId}/preview`,
      };
    }
  }

  return { kind: "link", url: safeUrl };
}

function renderPreviewMarkup(source: ResolvedMediaSource, title: string, type: ModuleMediaType): string {
  const escapedTitle = escapeAttribute(title);
  const escapedUrl = escapeAttribute(source.url);

  if (source.kind === "direct") {
    if (type === "image") {
      return `<img src="${escapedUrl}" alt="${escapedTitle}" style="width:100%;max-height:460px;object-fit:contain;border-radius:8px;background:#f8fafc;" />`;
    }

    if (type === "video") {
      return `<video controls preload="metadata" style="width:100%;border-radius:8px;background:#020617;"><source src="${escapedUrl}" /></video>`;
    }

    return `<audio controls preload="metadata" style="width:100%;"><source src="${escapedUrl}" /></audio>`;
  }

  if (source.kind === "youtube" || source.kind === "google-drive") {
    const embedUrl = escapeAttribute(source.embedUrl || source.url);
    return [
      `<div style="position:relative;width:100%;padding-top:56.25%;border-radius:8px;overflow:hidden;background:#020617;">`,
      `  <iframe src="${embedUrl}" title="${escapedTitle}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0;"></iframe>`,
      `</div>`,
    ].join("");
  }

  return [
    `<a href="${escapedUrl}" target="_blank" rel="noreferrer noopener" style="display:inline-flex;align-items:center;gap:8px;padding:12px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#ffffff;color:#0f172a;text-decoration:none;font-weight:600;">`,
    `  <span>${escapedTitle}</span>`,
    `  <span style="font-size:12px;color:#64748b;">Open link</span>`,
    `</a>`,
  ].join("");
}

function renderPreviewNode(source: ResolvedMediaSource, title: string, type: ModuleMediaType) {
  if (source.kind === "direct") {
    if (type === "image") {
      return <img src={source.url} alt={title} className="w-full h-auto max-h-[460px] object-contain rounded-md bg-slate-50" loading="lazy" />;
    }

    if (type === "video") {
      return (
        <video controls preload="metadata" className="w-full rounded-md bg-slate-950">
          <source src={source.url} />
          Your browser does not support embedded video playback.
        </video>
      );
    }

    return (
      <audio controls preload="metadata" className="w-full">
        <source src={source.url} />
        Your browser does not support embedded audio playback.
      </audio>
    );
  }

  if (source.kind === "youtube" || source.kind === "google-drive") {
    return (
      <div className="w-full rounded-md overflow-hidden bg-slate-950" style={{ aspectRatio: "16 / 9" }}>
        <iframe
          src={source.embedUrl || source.url}
          title={title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </div>
    );
  }

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:border-slate-300 hover:bg-slate-50"
    >
      <span>{title}</span>
      <span className="text-xs font-medium text-slate-500">Open link</span>
    </a>
  );
}

function parseEmbedBlock(blockHtml: string): ModuleMediaEmbed | null {
  const openingTagMatch = blockHtml.match(/^<figure\b([^>]*)>/i);
  if (!openingTagMatch) return null;

  const attrs = openingTagMatch[1] || "";
  const type = (getAttrValue(attrs, "data-media-type") || "").toLowerCase() as ModuleMediaType;
  const src = decodeHtmlEntities(getAttrValue(attrs, "data-media-src"));
  const title = decodeHtmlEntities(getAttrValue(attrs, "data-media-title"));
  const description = decodeHtmlEntities(getAttrValue(attrs, "data-media-description"));

  if (type !== "image" && type !== "video" && type !== "audio") {
    return null;
  }

  const safeSrc = sanitizeMediaUrl(src);
  if (!safeSrc) return null;

  const fallbackCaptionMatch = blockHtml.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
  const fallbackTitle = fallbackCaptionMatch ? stripTags(fallbackCaptionMatch[1]) : "";

  return {
    type,
    src: safeSrc,
    title: title || fallbackTitle || `${type.toUpperCase()} embed`,
    description: description || undefined,
  };
}

export function splitContentWithMediaEmbeds(html: string): HtmlBlock[] {
  const normalized = html || "";
  const blocks: HtmlBlock[] = [];

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = EMBED_BLOCK_REGEX.exec(normalized)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (start > cursor) {
      blocks.push({ type: "html", html: normalized.slice(cursor, start) });
    }

    const parsed = parseEmbedBlock(match[0]);
    if (parsed) {
      blocks.push({ type: "media", media: parsed });
    } else {
      blocks.push({ type: "html", html: match[0] });
    }

    cursor = end;
  }

  if (cursor < normalized.length) {
    blocks.push({ type: "html", html: normalized.slice(cursor) });
  }

  if (blocks.length === 0) {
    blocks.push({ type: "html", html: normalized });
  }

  return blocks;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function prettyMediaName(type: ModuleMediaType): string {
  if (type === "image") return "Image";
  if (type === "video") return "Video";
  return "Audio";
}

export function buildMediaEmbedMarkup(input: ModuleMediaEmbed): string {
  const source = resolveMediaSource(input.src, input.type);
  if (!source.url) return "";

  const title = input.title?.trim() || `${prettyMediaName(input.type)} embed`;
  const description = input.description?.trim() || "";

  const eType = escapeAttribute(input.type);
  const eSrc = escapeAttribute(source.url);
  const eTitle = escapeAttribute(title);
  const eDescription = escapeAttribute(description);
  const eEmbedId = input.embedId ? escapeAttribute(input.embedId) : "";
  const mediaPreview = renderPreviewMarkup(source, title, input.type);
  const mediaLabel =
    source.kind === "youtube"
      ? "YouTube embed"
      : source.kind === "google-drive"
        ? "Google Drive embed"
        : source.kind === "link"
          ? "Link preview"
          : `${prettyMediaName(input.type)} embed`;

  return [
    `<figure class="module-media-embed" contenteditable="false" data-media-type="${eType}" data-media-src="${eSrc}" data-media-title="${eTitle}" data-media-description="${eDescription}"${eEmbedId ? ` data-media-id="${eEmbedId}"` : ""}>`,
    `  <div class="module-media-placeholder" style="padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;margin:12px 0;">`,
    `    <div style="margin-bottom:10px;">${mediaPreview}</div>`,
    `    <strong class="module-media-title" style="display:block;color:#1e293b;">${eTitle}</strong>`,
    `    <span style="display:block;color:#64748b;font-size:12px;">${mediaLabel}</span>`,
    description ? `    <span class="module-media-description" style="display:block;color:#475569;font-size:12px;margin-top:4px;">${escapeAttribute(description)}</span>` : "",
    "  </div>",
    `  <figcaption class="module-media-caption">${eTitle}</figcaption>`,
    "</figure>",
    "<p><br/></p>",
  ]
    .filter(Boolean)
    .join("\n");
}

function MediaEmbedBlock({ media }: { media: ModuleMediaEmbed }) {
  const title = media.title || `${prettyMediaName(media.type)} embed`;
  const source = resolveMediaSource(media.src, media.type);

  return (
    <figure className="my-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {renderPreviewNode(source, title, media.type)}

      <figcaption className="mt-2 text-sm text-slate-700">
        <div className="font-semibold">{title}</div>
        {media.description ? <div className="text-slate-500">{media.description}</div> : null}
      </figcaption>
    </figure>
  );
}

export function MediaAwareHtml({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const blocks = splitContentWithMediaEmbeds(html);

  return (
    <div className={className}>
      {blocks.map((block, idx) => {
        if (block.type === "html") {
          if (!block.html.trim()) return null;
          return <div key={`html-${idx}`} dangerouslySetInnerHTML={{ __html: block.html }} />;
        }

        return <MediaEmbedBlock key={`media-${idx}`} media={block.media} />;
      })}
    </div>
  );
}



