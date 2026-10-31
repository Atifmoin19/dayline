// Dayline web-push service worker. Scope: / (matches Vite `base`).
// Two jobs: show a notification when a push arrives, and route a click on it into the app.
const APP_HOME = "/app";

const targetFor = (data) =>
  data && data.task_id ? `/tasks/${encodeURIComponent(data.task_id)}` : (data && data.url) || APP_HOME;

self.addEventListener("push", (event) => {
  let payload = { title: "Dayline", body: "You have a new update." };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    /* non-JSON payload: fall back to the default text */
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Dayline", {
      body: payload.body || "",
      icon: "/dayline.svg",
      badge: "/dayline.svg",
      data: { url: payload.url, task_id: payload.task_id },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(targetFor(event.notification.data), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.focus().then((c) => ("navigate" in c ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
