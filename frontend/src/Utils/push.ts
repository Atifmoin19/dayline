/** Browser web-push helpers — VAPID subscribe/unsubscribe against the service worker at /sw.js. */

export const isPushSupported = (): boolean =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Base64url (VAPID public key format) -> Uint8Array, as required by pushManager.subscribe(). */
const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
};

export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!isPushSupported()) return null;
  return navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });
};

export const getExistingPushSubscription = async (): Promise<PushSubscription | null> => {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
};

/** Requests Notification permission (must be called from a user gesture) then subscribes. */
export const subscribeToPush = async (vapidPublicKey: string): Promise<PushSubscription | null> => {
  if (!isPushSupported()) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;

  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
};

export const unsubscribeFromPush = async (): Promise<PushSubscription | null> => {
  const sub = await getExistingPushSubscription();
  if (sub) await sub.unsubscribe();
  return sub;
};

/** Shape the frontend sends to POST /push/subscribe (mirrors PushSubscription.toJSON()). */
export const subscriptionToPayload = (sub: PushSubscription) => {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint as string,
    keys: { p256dh: json.keys?.p256dh as string, auth: json.keys?.auth as string },
  };
};
