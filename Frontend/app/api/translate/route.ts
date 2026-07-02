import { NextResponse } from 'next/server';

type TranslationCacheEntry = {
  value: string;
  expiresAt: number;
};

const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const globalTranslationCache = globalThis as typeof globalThis & {
  __translationCache?: Map<string, TranslationCacheEntry>;
};

if (!globalTranslationCache.__translationCache) {
  globalTranslationCache.__translationCache = new Map<string, TranslationCacheEntry>();
}

const translationCache = globalTranslationCache.__translationCache;

const getCacheKey = (text: string, target: string, source: string) => `${source}:${target}:${text.trim()}`;

const getCachedTranslation = (text: string, target: string, source: string) => {
  const cacheKey = getCacheKey(text, target, source);
  const entry = translationCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    translationCache.delete(cacheKey);
    return null;
  }
  return entry.value;
};

const setCachedTranslation = (text: string, target: string, source: string, value: string) => {
  const cacheKey = getCacheKey(text, target, source);
  translationCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text = body?.text;
    const target = body?.target || 'hi';
    const source = body?.source || 'auto';

    if (!text) return NextResponse.json({ error: 'Missing text' }, { status: 400 });

    const cachedValue = getCachedTranslation(String(text), String(target), String(source));
    if (cachedValue) {
      return NextResponse.json({ translated: cachedValue, cached: true });
    }

    // Helper: split into sentence-ish chunks to avoid very long query URLs
    const MAX_CHUNK = 1500;
    const chunkText = (input: string) => {
      // Try to split by sentences first
      const sentences = input.match(/[^.!?]+[.!?]*/g);
      if (!sentences) {
        // fallback to whitespace split
        const parts: string[] = [];
        let start = 0;
        while (start < input.length) {
          parts.push(input.slice(start, Math.min(start + MAX_CHUNK, input.length)));
          start += MAX_CHUNK;
        }
        return parts;
      }

      const chunks: string[] = [];
      let current = '';
      for (const s of sentences) {
        if ((current + s).length > MAX_CHUNK) {
          if (current.length > 0) {
            chunks.push(current);
            current = s;
          } else {
            // single sentence longer than MAX_CHUNK -> hard split
            let pos = 0;
            while (pos < s.length) {
              chunks.push(s.slice(pos, pos + MAX_CHUNK));
              pos += MAX_CHUNK;
            }
            current = '';
          }
        } else {
          current += s;
        }
      }
      if (current.length > 0) chunks.push(current);
      return chunks;
    };

    const chunks = chunkText(String(text));
    const translatedParts: string[] = [];

    for (const chunk of chunks) {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
        source
      )}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(chunk)}`;

      const res = await fetch(url);
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return NextResponse.json({ error: 'Translate API error', detail: txt }, { status: 502 });
      }

      const parsed = await res.json();
      const piece = (parsed[0] || []).map((c: any) => c[0]).join('');
      translatedParts.push(piece);
    }

    const translated = translatedParts.join('');
    return NextResponse.json({ translated });
  } catch (err: any) {
    return NextResponse.json({ error: 'Translation failed', detail: String(err) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // simple GET wrapper for convenience (q and target as query params)
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') || '';
    const target = url.searchParams.get('target') || 'hi';
    const source = url.searchParams.get('source') || 'auto';

    if (!q) return NextResponse.json({ error: 'Missing q query param' }, { status: 400 });

    const cachedValue = getCachedTranslation(q, target, source);
    if (cachedValue) {
      return NextResponse.json({ translated: cachedValue, cached: true });
    }

    // reuse chunking logic for GET cases
    const MAX_CHUNK = 1500;
    const chunkText = (input: string) => {
      const sentences = input.match(/[^.!?]+[.!?]*/g);
      if (!sentences) {
        const parts: string[] = [];
        let start = 0;
        while (start < input.length) {
          parts.push(input.slice(start, Math.min(start + MAX_CHUNK, input.length)));
          start += MAX_CHUNK;
        }
        return parts;
      }
      const chunks: string[] = [];
      let current = '';
      for (const s of sentences) {
        if ((current + s).length > MAX_CHUNK) {
          if (current.length > 0) {
            chunks.push(current);
            current = s;
          } else {
            let pos = 0;
            while (pos < s.length) {
              chunks.push(s.slice(pos, pos + MAX_CHUNK));
              pos += MAX_CHUNK;
            }
            current = '';
          }
        } else {
          current += s;
        }
      }
      if (current.length > 0) chunks.push(current);
      return chunks;
    };

    const chunks = chunkText(q);
    const translatedParts: string[] = [];

    for (const chunk of chunks) {
      const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
        source
      )}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(chunk)}`;

      const res = await fetch(apiUrl);
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return NextResponse.json({ error: 'Translate API error', detail: txt }, { status: 502 });
      }
      const parsed = await res.json();
      translatedParts.push((parsed[0] || []).map((c: any) => c[0]).join(''));
    }

    const translated = translatedParts.join('');
    return NextResponse.json({ translated });
  } catch (err: any) {
    return NextResponse.json({ error: 'Translation failed', detail: String(err) }, { status: 500 });
  }
}
