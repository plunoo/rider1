self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload = { title: "Notification", message: event.data.text() };
    }
  }
  const title = payload.title || "Notification";
  const options = {
    body: payload.message || "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: {
      url: payload.link || "/",
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        const normalizedTarget = new URL(targetUrl, self.location.origin).href;
        for (const client of clientList) {
          if (client.url === normalizedTarget && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(normalizedTarget);
        }
        return undefined;
      })
  );
});
