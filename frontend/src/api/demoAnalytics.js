import { buildAnalyticsApiUrl } from "./config";

/**
 * Demo analytics.
 *
 * The marketing site (bpmngen.com) owns analytics consent. The demo therefore never decides
 * on its own whether to track:
 * - Embedded on the website (iframe): we announce ourselves to the parent page and it sends
 *   back its analytics session id via postMessage, but only if the visitor allowed
 *   analytics (and null again if they revoke it).
 * - Opened in its own tab: the website adds ?sid= to the link only with consent.
 * Without a session id nothing is sent. With one, milestones go straight to the website's
 * analytics API, and "Create account" carries the id into registration.
 */

const DEMO_MESSAGE_SOURCE = "bpmngen-demo";
const WEB_MESSAGE_SOURCE = "bpmngen-web";
const SID_STORAGE_KEY = "bpmngen_demo_sid";
const MAX_SID_LENGTH = 128;

export const DEMO_EVENTS = {
  started: "demo_started",
  completed: "demo_completed",
  signupClicked: "demo_signup_clicked",
};

const PRODUCTION_WEB_ORIGINS = [
  "https://bpmngen.com",
  "https://www.bpmngen.com",
  "https://bpmngen-web-app.onrender.com",
];
const DEV_WEB_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const ALLOWED_WEB_ORIGINS = new Set(
  import.meta.env.DEV ? [...PRODUCTION_WEB_ORIGINS, ...DEV_WEB_ORIGINS] : PRODUCTION_WEB_ORIGINS,
);

let sessionId = null;
const sentOnce = new Set();

function isValidSid(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SID_LENGTH && /^[\w-]+$/.test(value);
}

function readStoredSid() {
  try {
    const stored = window.sessionStorage.getItem(SID_STORAGE_KEY);
    return isValidSid(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeSid(value) {
  try {
    if (value) {
      window.sessionStorage.setItem(SID_STORAGE_KEY, value);
    } else {
      window.sessionStorage.removeItem(SID_STORAGE_KEY);
    }
  } catch {
    // storage may be unavailable; the in-memory value still works for this page view
  }
}

export function isEmbeddedDemo() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Origin of the page embedding us, but only if it is one of our own websites. */
function getTrustedParentOrigin() {
  if (!isEmbeddedDemo()) return null;
  const candidates = [];
  const ancestors = window.location.ancestorOrigins;
  if (ancestors && ancestors.length > 0) candidates.push(ancestors[0]);
  if (document.referrer) {
    try {
      candidates.push(new URL(document.referrer).origin);
    } catch {
      // ignore malformed referrer
    }
  }
  return candidates.find((origin) => ALLOWED_WEB_ORIGINS.has(origin)) || null;
}

export function getDemoSessionId() {
  return sessionId;
}

/**
 * Call once when the demo mounts. Picks up ?sid= (own tab) or listens for the session id
 * from the embedding website. Returns a cleanup function.
 */
export function initDemoAnalytics() {
  if (typeof window === "undefined") return () => {};

  const fromUrl = new URLSearchParams(window.location.search).get("sid");
  if (isValidSid(fromUrl)) {
    sessionId = fromUrl;
    storeSid(fromUrl);
  } else {
    sessionId = readStoredSid();
  }

  const parentOrigin = getTrustedParentOrigin();
  if (!parentOrigin) return () => {};

  const handleMessage = (event) => {
    if (event.origin !== parentOrigin || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== WEB_MESSAGE_SOURCE || data.type !== "session") return;
    // null means the visitor has not allowed (or has revoked) analytics.
    sessionId = isValidSid(data.sid) ? data.sid : null;
    storeSid(sessionId);
  };
  window.addEventListener("message", handleMessage);
  window.parent.postMessage({ source: DEMO_MESSAGE_SOURCE, type: "ready" }, parentOrigin);

  return () => window.removeEventListener("message", handleMessage);
}

/**
 * Records a demo milestone. Sent straight to the website's analytics API, and only when we
 * hold a session id from the website (= the visitor allowed analytics there). `fetch` with
 * keepalive also survives the navigation to registration. `once` limits it to one send
 * per page view.
 */
export function trackDemoEvent(eventName, { once = false } = {}) {
  if (typeof window === "undefined" || !sessionId) return;
  if (once) {
    if (sentOnce.has(eventName)) return;
    sentOnce.add(eventName);
  }

  const source = isEmbeddedDemo() ? "embedded" : "app";
  try {
    void fetch(buildAnalyticsApiUrl("/api/analytics/track"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_name: eventName, path: `/demo?source=${source}`, session_id: sessionId }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // analytics must never break the demo
  }
}

/**
 * Opens registration from the demo, carrying the analytics session id when we have one.
 * Inside the website's iframe it takes over the whole tab instead of the small frame.
 * Must be called from a click handler (top navigation needs a user gesture).
 */
export function openDemoSignup(navigate) {
  trackDemoEvent(DEMO_EVENTS.signupClicked);
  const path = sessionId ? `/register?sid=${encodeURIComponent(sessionId)}` : "/register";
  if (isEmbeddedDemo()) {
    window.open(`${window.location.origin}${path}`, "_top");
    return;
  }
  navigate(path);
}
