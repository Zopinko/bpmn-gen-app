"""CSRF protection based on the Origin header.

Session cookies are sent cross-site in production (SameSite=None), so a foreign page could
trigger state-changing requests with the user's cookie. Browsers always attach an ``Origin``
header to cross-origin POST/PUT/PATCH/DELETE requests (fetch and HTML forms), so rejecting
unsafe requests whose Origin is not on the CORS allowlist blocks that attack. Requests without
an Origin header (server-to-server clients, tests, same-origin navigations in old browsers) are
allowed, because they cannot carry a victim's browser cookie from a foreign site.
"""

from __future__ import annotations

import json

from core.auth_config import get_auth_config

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class OriginCheckMiddleware:
    def __init__(self, app, allowed_origins: list[str] | None = None) -> None:
        self.app = app
        self._allowed_origins = allowed_origins

    def _allowed(self) -> set[str]:
        origins = self._allowed_origins
        if origins is None:
            origins = get_auth_config().cors_allowed_origins
        return {origin.rstrip("/") for origin in origins}

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method", "").upper() not in UNSAFE_METHODS:
            await self.app(scope, receive, send)
            return

        origin = None
        for key, value in scope.get("headers") or []:
            if key == b"origin":
                origin = value.decode("latin-1").strip()
                break

        if origin is None or origin.rstrip("/") in self._allowed():
            await self.app(scope, receive, send)
            return

        body = json.dumps({"detail": "Origin not allowed."}).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
