import { buildApiUrl } from "./config";

const ANALYTICS_TRACK_URL = buildApiUrl("/api/analytics/track");

export async function trackSignupCompleted(sessionId) {
  const payload = {
    event_name: "signup_completed",
    path: "/signup?source=app",
  };

  if (sessionId) {
    payload.session_id = sessionId;
  }

  try {
    await fetch(ANALYTICS_TRACK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (error) {
    // Analytics must never block signup.
    console.warn("Analytics tracking failed:", error);
  }
}
