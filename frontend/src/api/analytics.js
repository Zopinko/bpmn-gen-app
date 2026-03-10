const ANALYTICS_TRACK_URL = "https://www.bpmngen.com/api/analytics/track";

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
  } catch {
    // Analytics must never block signup.
  }
}
