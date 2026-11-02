import urllib.request
import urllib.parse
import httpx
import logging
from typing import Optional

logger = logging.getLogger("lucid.url_shortener")

# In-memory cache for shortened URLs
_URL_CACHE = {}


def shorten_url_sync(long_url: str, timeout: float = 4.0) -> str:
    """
    Synchronously shortens a long URL using TinyURL, clck.ru, or da.gd.
    Returns the shortened URL, or the original long_url if all shorteners fail.
    """
    if not long_url or len(long_url) < 30:
        return long_url

    if long_url in _URL_CACHE:
        return _URL_CACHE[long_url]

    # Provider 1: TinyURL
    try:
        api_url = f"https://tinyurl.com/api-create.php?url={urllib.parse.quote(long_url)}"
        req = urllib.request.Request(api_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            short = resp.read().decode("utf-8").strip()
            if short.startswith("http"):
                _URL_CACHE[long_url] = short
                return short
    except Exception as e:
        logger.debug(f"[URL Shortener] TinyURL sync error: {e}")

    # Provider 2: clck.ru
    try:
        api_url = f"https://clck.ru/--?url={urllib.parse.quote(long_url)}"
        req = urllib.request.Request(api_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            short = resp.read().decode("utf-8").strip()
            if short.startswith("http"):
                _URL_CACHE[long_url] = short
                return short
    except Exception as e:
        logger.debug(f"[URL Shortener] clck.ru sync error: {e}")

    # Provider 3: da.gd
    try:
        api_url = f"https://da.gd/s?url={urllib.parse.quote(long_url)}"
        req = urllib.request.Request(api_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            short = resp.read().decode("utf-8").strip()
            if short.startswith("http"):
                _URL_CACHE[long_url] = short
                return short
    except Exception as e:
        logger.debug(f"[URL Shortener] da.gd sync error: {e}")

    return long_url


async def shorten_url_async(long_url: str, timeout: float = 4.0) -> str:
    """
    Asynchronously shortens a long URL using TinyURL, clck.ru, or da.gd.
    Returns the shortened URL, or the original long_url if all shorteners fail.
    """
    if not long_url or len(long_url) < 30:
        return long_url

    if long_url in _URL_CACHE:
        return _URL_CACHE[long_url]

    async with httpx.AsyncClient(timeout=timeout) as client:
        # Provider 1: TinyURL
        try:
            api_url = f"https://tinyurl.com/api-create.php?url={urllib.parse.quote(long_url)}"
            resp = await client.get(api_url)
            if resp.status_code == 200:
                short = resp.text.strip()
                if short.startswith("http"):
                    _URL_CACHE[long_url] = short
                    return short
        except Exception as e:
            logger.debug(f"[URL Shortener] TinyURL async error: {e}")

        # Provider 2: clck.ru
        try:
            api_url = f"https://clck.ru/--?url={urllib.parse.quote(long_url)}"
            resp = await client.get(api_url)
            if resp.status_code == 200:
                short = resp.text.strip()
                if short.startswith("http"):
                    _URL_CACHE[long_url] = short
                    return short
        except Exception as e:
            logger.debug(f"[URL Shortener] clck.ru async error: {e}")

        # Provider 3: da.gd
        try:
            api_url = f"https://da.gd/s?url={urllib.parse.quote(long_url)}"
            resp = await client.get(api_url)
            if resp.status_code == 200:
                short = resp.text.strip()
                if short.startswith("http"):
                    _URL_CACHE[long_url] = short
                    return short
        except Exception as e:
            logger.debug(f"[URL Shortener] da.gd async error: {e}")

    return long_url


def replace_long_urls_with_short(text: str) -> str:
    """
    Finds all URLs in text with length > 40 characters and replaces them
    with short links.
    """
    if not text or "http" not in text:
        return text

    import re

    def _replace(match):
        raw_url = match.group(0)
        # Keep trailing punctuation outside
        trailing = ""
        while raw_url and raw_url[-1] in [".", ",", ")", "]", ";", ":"]:
            trailing = raw_url[-1] + trailing
            raw_url = raw_url[:-1]

        if len(raw_url) > 35:
            short = shorten_url_sync(raw_url)
            return short + trailing
        return raw_url + trailing

    return re.sub(r"https?://[^\s<>\"']+", _replace, text)
