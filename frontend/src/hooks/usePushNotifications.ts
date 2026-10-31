import { useCallback, useEffect, useState } from "react";
import { useAppSelector } from "app/hooks";
import {
  useLazyVapidPublicKeyQuery,
  useSubscribePushMutation,
  useUnsubscribePushMutation,
} from "Services/user.api";
import {
  isPushSupported,
  registerServiceWorker,
  getExistingPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  subscriptionToPayload,
} from "Utils/push";

/**
 * Registers the push service worker on mount (silent — no permission prompt) and exposes
 * `enable`/`disable` for an explicit user action (browser permission prompts require a user
 * gesture, so these must be called from a click handler, not an effect).
 */
export const usePushNotifications = () => {
  const currentUser = useAppSelector((s) => s.scheduler?.currentUser);
  const [supported] = useState(isPushSupported());
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : "denied"
  );
  const [fetchVapidKey] = useLazyVapidPublicKeyQuery();
  const [subscribePush] = useSubscribePushMutation();
  const [unsubscribePush] = useUnsubscribePushMutation();

  useEffect(() => {
    if (!currentUser || !supported) return;
    registerServiceWorker()
      .then(() => getExistingPushSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => setSubscribed(false));
  }, [currentUser, supported]);

  const enable = useCallback(async () => {
    if (!supported) return false;
    const { data } = await fetchVapidKey();
    if (!data?.public_key) return false;
    const sub = await subscribeToPush(data.public_key);
    setPermission(Notification.permission);
    if (!sub) return false;
    await subscribePush(subscriptionToPayload(sub));
    setSubscribed(true);
    return true;
  }, [supported, fetchVapidKey, subscribePush]);

  const disable = useCallback(async () => {
    const sub = await unsubscribeFromPush();
    if (sub) await unsubscribePush(subscriptionToPayload(sub));
    setSubscribed(false);
  }, [unsubscribePush]);

  return { supported, subscribed, permission, enable, disable };
};
