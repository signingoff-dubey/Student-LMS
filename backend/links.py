"""Safe fetch of a teacher-connected spreadsheet link or admin server file path.

Rewrites a normal share link into a direct, whole-workbook download, and re-checks the host
allowlist + https on every redirect hop (urllib's default redirect handling would otherwise
follow a 30x to any host, which is the SSRF hole a link-fetch feature invites).
"""
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MAX_HOPS = 5


class LinkError(ValueError):
    pass


def _no_redirect_opener():
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None  # let the 30x surface so we can validate Location ourselves

    return urllib.request.build_opener(NoRedirect)


def _request(url, allowed_hosts, hops=0):
    if hops > MAX_HOPS:
        raise LinkError("the link redirected too many times")
    u = urllib.parse.urlparse(url)
    if u.scheme != "https":
        raise LinkError("only https links are allowed")
    if u.hostname not in allowed_hosts:
        raise LinkError(f"link host '{u.hostname}' is not allowed; use a Google Sheets or OneDrive share link")
    try:
        with _no_redirect_opener().open(url, timeout=20) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            loc = e.headers.get("Location")
            if not loc:
                raise LinkError("the link redirected with no destination")
            return _request(urllib.parse.urljoin(url, loc), allowed_hosts, hops + 1)
        raise LinkError(f"the server returned HTTP {e.code} fetching that link")
    except urllib.error.URLError as e:
        raise LinkError(f"could not reach that link ({e.reason})")


def to_export_url(url):
    """Share link -> a direct download of the WHOLE workbook (every tab/section/batch), not one sheet."""
    u = urllib.parse.urlparse(url)
    if u.hostname == "docs.google.com":
        m = re.search(r"/spreadsheets/d/([\w-]+)", u.path)
        if m:
            return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=xlsx"
    if u.hostname in ("onedrive.live.com", "1drv.ms"):
        q = dict(urllib.parse.parse_qsl(u.query))
        q["download"] = "1"
        return u._replace(query=urllib.parse.urlencode(q)).geturl()
    return url


def fetch(location, allowed_hosts, max_bytes):
    """Bytes of the linked workbook, or of a server file path (admin only; caller checks that)."""
    if re.match(r"https?://", location):
        data = _request(to_export_url(location), allowed_hosts)
    else:
        try:
            data = Path(location).read_bytes()
        except OSError as e:
            raise LinkError(f"could not read {location}: {e.strerror or e}")
    if len(data) > max_bytes:
        raise LinkError("file too large (10 MB max)")
    return data
