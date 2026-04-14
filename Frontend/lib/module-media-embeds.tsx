import React from "react";

export type ModuleMediaType = "image" | "video" | "audio";

export interface ModuleMediaEmbed {
  type: ModuleMediaType;
  src: string;
  title: string;
  description?: string;
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
  const src = sanitizeMediaUrl(input.src);
  if (!src) return "";

  const title = input.title?.trim() || `${prettyMediaName(input.type)} embed`;
  const description = input.description?.trim() || "";

  const eType = escapeAttribute(input.type);
  const eSrc = escapeAttribute(src);
  const eTitle = escapeAttribute(title);
  const eDescription = escapeAttribute(description);

  return [
    `<figure class="module-media-embed" contenteditable="false" data-media-type="${eType}" data-media-src="${eSrc}" data-media-title="${eTitle}" data-media-description="${eDescription}">`,
    `  <div class="module-media-placeholder" style="padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;margin:12px 0;">`,
    `    <strong style="display:block;color:#1e293b;">${eTitle}</strong>`,
    `    <span style="display:block;color:#64748b;font-size:12px;">${prettyMediaName(input.type)} embed</span>`,
    description ? `    <span style="display:block;color:#475569;font-size:12px;margin-top:4px;">${escapeAttribute(description)}</span>` : "",
    "  </div>",
    `  <figcaption>${eTitle}</figcaption>`,
    "</figure>",
    "<p><br/></p>",
  ]
    .filter(Boolean)
    .join("\n");
}

function MediaEmbedBlock({ media }: { media: ModuleMediaEmbed }) {
  const title = media.title || `${prettyMediaName(media.type)} embed`;

  return (
    <figure className="my-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {media.type === "image" && (
        <img
          src={media.src}
          alt={title}
          className="w-full h-auto max-h-[460px] object-contain rounded-md bg-slate-50"
          loading="lazy"
        />
      )}

      {media.type === "video" && (
        <video controls preload="metadata" className="w-full rounded-md bg-slate-950">
          <source src={media.src} />
          Your browser does not support embedded video playback.
        </video>
      )}

      {media.type === "audio" && (
        <audio controls preload="metadata" className="w-full">
          <source src={media.src} />
          Your browser does not support embedded audio playback.
        </audio>
      )}

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
