import os
import re
import urllib.request
import urllib.parse
import logging
from typing import Optional, Set

logger = logging.getLogger("lucid.url_shortener")

# In-memory cache for shortened URLs
_URL_CACHE = {}

# Feature flag: external third-party URL shortening disabled by default for privacy/security
ENABLE_EXTERNAL_URL_SHORTENING: bool = (
    os.getenv("ENABLE_EXTERNAL_URL_SHORTENING", "false").strip().lower() in ("true", "1", "yes")
)

# Allowed domains that are safe to shorten externally (configured via env var or safe defaults)
_DEFAULT_ALLOWED_DOMAINS: Set[str] = {
    "workfloww.ai",
    "lucid.workfloww.ai",
}


def get_allowed_domains() -> Set[str]:
    raw = os.getenv("URL_SHORTENER_ALLOWED_DOMAINS", "").strip()
    if not raw:
        return _DEFAULT_ALLOWED_DOMAINS
    domains = {d.strip().lower() for d in raw.split(",") if d.strip()}
    return domains or _DEFAULT_ALLOWED_DOMAINS


# Sensitive patterns that indicate signed, secret, or internal URLs
SENSITIVE_PARAM_PATTERNS = [
    re.compile(r"(?:^|[?&])(?:token|sig|signature|apikey|api_key|secret|auth|credential|key|jwt)=", re.IGNORECASE),
    re.compile(r"(?:^|[?&])x-amz-", re.IGNORECASE),
]

SENSITIVE_PATH_PATTERNS = [
    re.compile(r"/(?:sign|signed)/", re.IGNORECASE),
    re.compile(r"/storage/v1/object/sign/", re.IGNORECASE),
]

PRIVATE_HOST_PATTERNS = [
    re.compile(r"^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?$", re.IGNORECASE),
    re.compile(r"\.local$", re.IGNORECASE),
]


def is_safe_to_shorten(url: str) -> bool:
    """
    Validates whether a URL is safe to send to a third-party shortening service.
    
    Guards against:
    1. Feature flag gating (disabled by default).
    2. Private/internal hosts (localhost, 127.0.0.1, internal IPs).
    3. Signed / secret URLs (Supabase signed URLs, AWS S3 signatures, auth tokens).
    4. Domain allowlist (only approved, non-sensitive public domains allowed).
    """
    if not ENABLE_EXTERNAL_URL_SHORTENING:
        logger.debug("[URL Shortener] Third-party shortening is disabled by feature flag.")
        return False

    if not url or not isinstance(url, str):
        return False

    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False

    if parsed.scheme.lower() not in ("http", "https"):
        return False

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return False

    # Block localhost, private IPs, internal network
    for pat in PRIVATE_HOST_PATTERNS:
        if pat.search(hostname):
            logger.warning(f"[URL Shortener] Blocked shortening internal/private URL: {hostname}")
            return False

    # Block sensitive path patterns (signed URLs)
    for pat in SENSITIVE_PATH_PATTERNS:
        if pat.search(parsed.path):
            logger.warning(f"[URL Shortener] Blocked shortening signed storage URL: {parsed.path}")
            return False

    # Block sensitive query params (signatures, tokens, credentials)
    if parsed.query:
        for pat in SENSITIVE_PARAM_PATTERNS:
            if pat.search(parsed.query):
                logger.warning("[URL Shortener] Blocked shortening URL containing signed credentials or tokens.")
                return False

    # Validate against domain allowlist
    allowed = get_allowed_domains()
    domain_matched = False
    for allowed_domain in allowed:
        if hostname == allowed_domain or hostname.endswith("." + allowed_domain):
            domain_matched = True
            break

    if not domain_matched:
        logger.debug(f"[URL Shortener] Domain '{hostname}' is not in allowlist {allowed}; bypassing external shortener.")
        return False

    return True


def shorten_url_sync(long_url: str, timeout: float = 4.0) -> str:
    """
    Synchronously shortens a long URL using TinyURL, clck.ru, or da.gd.
    Gated behind feature flag, domain allowlist, and signed/secret URL check.
    Returns the shortened URL, or the original long_url if gating fails or shorteners fail.
    """
    if not long_url or len(long_url) < 30:
        return long_url

    if not is_safe_to_shorten(long_url):
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
    Gated behind feature flag, domain allowlist, and signed/secret URL check.
    Returns the shortened URL, or the original long_url if gating fails or shorteners fail.
    """
    if not long_url or len(long_url) < 30:
        return long_url

    if not is_safe_to_shorten(long_url):
        return long_url

    if long_url in _URL_CACHE:
        return _URL_CACHE[long_url]

    try:
        import httpx
    except ImportError:
        logger.debug("[URL Shortener] httpx not installed; skipping async shortening.")
        return long_url

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
    with short links (only if safe and permitted by gating policies).
    """
    if not text or "http" not in text:
        return text

    if not ENABLE_EXTERNAL_URL_SHORTENING:
        return text

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
