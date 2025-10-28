self.addEventListener("push", (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || "Notification";
    const body  = data.body  || "";
    const payload = { data: data.data || {} };
    event.waitUntil(self.registration.showNotification(title, { body, data: payload.data }));
  } catch (e) {
    event.waitUntil(self.registration.showNotification("Notification", { body: "" }));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(clients.openWindow(url));
});
