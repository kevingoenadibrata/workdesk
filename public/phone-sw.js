// Service worker for the phone mirror's home-screen app (src/phone/app.ts).
// It only shows notifications pushed by Workdesk (src-tauri/src/phone.rs) and
// opens the right terminal when one is tapped. Nothing is cached offline: the
// app is only useful while it can reach the Mac.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || "Workdesk", {
      body: msg.body || "",
      tag: msg.tag,
      icon: "/phone-icon-192.png",
      data: { pty: msg.pty ?? null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const pty = event.notification.data && event.notification.data.pty;
  const url = pty != null ? `/#pty=${pty}` : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        w.postMessage({ open: pty });
        return w.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
