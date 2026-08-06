// Fallback for browsers without Declarative Web Push (Chrome, Firefox,
// older Safari). Safari 18.4+ can render the same payload natively without
// this handler running.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  const n = payload.notification ?? payload;
  if (!n?.title) return;

  event.waitUntil(
    self.registration.showNotification(n.title, {
      body: n.body,
      icon: n.icon ?? "./icon-192.png",
      badge: n.badge ?? "./icon-192.png",
      data: { navigate: n.navigate },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.navigate;
  if (!url) return;
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
              return;
            } catch {
              /* fall through to openWindow */
            }
          }
        }
      }
      await clients.openWindow(url);
    })(),
  );
});
