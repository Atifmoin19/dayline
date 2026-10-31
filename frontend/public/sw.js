// TaskBoard web-push service worker. Scope: / (matches Vite `base`).
// Two jobs: show a notification when a push arrives, and route a click on it into the app.

self.addEventListener("push", (event) => {
  let payload = { title: "TaskBoard", body: "You have a new update." };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    /* non-JSON payload — fall back to the default text */
  }

  const url = payload.url || "/";
  event.waitUntil(
    self.registration.showNotification(payload.title || "TaskBoard", {
      body: payload.body || "",
      icon: "/vite.svg",
      badge: "/vite.svg",
      data: { url, task_id: payload.task_id },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/") && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
