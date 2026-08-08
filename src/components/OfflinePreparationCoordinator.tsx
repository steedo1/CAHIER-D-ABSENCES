"use client";

import { useEffect } from "react";
import {
  runCoordinatedOfflinePreparation,
  setOfflinePreparationContext,
  subscribeOfflinePreparation,
} from "@/lib/offline-preparation-coordinator";
import { createOfflinePreparationTriggerController } from "@/lib/offline-preparation-triggers";
import type {
  ClassDeviceAssessmentContext,
  OfflineRole,
} from "@/lib/offline-readiness";

export default function OfflinePreparationCoordinator({
  role,
  classDeviceContext,
}: {
  role: OfflineRole;
  classDeviceContext?: ClassDeviceAssessmentContext;
}) {
  useEffect(() => {
    setOfflinePreparationContext(role, classDeviceContext);

    const subscribeWindow = (eventName: "online" | "focus") =>
      (listener: EventListener) => {
        window.addEventListener(eventName, listener);
        return () => window.removeEventListener(eventName, listener);
      };
    const subscribeVisibility = (listener: EventListener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    };
    const subscribeServiceWorker = (listener: EventListener) => {
      navigator.serviceWorker?.addEventListener("controllerchange", listener);
      return () =>
        navigator.serviceWorker?.removeEventListener(
          "controllerchange",
          listener,
        );
    };

    const controller = createOfflinePreparationTriggerController({
      run: async (trigger) => {
        const result = classDeviceContext
          ? await runCoordinatedOfflinePreparation(role, {
              trigger,
              classDeviceContext,
            })
          : await runCoordinatedOfflinePreparation(role, { trigger });
        return result.snapshot;
      },
      subscribeOnline: subscribeWindow("online"),
      subscribeFocus: subscribeWindow("focus"),
      subscribeVisibility,
      subscribeServiceWorker,
      subscribeSnapshot: (listener) =>
        subscribeOfflinePreparation(role, listener),
      isVisible: () => document.visibilityState === "visible",
      initialDelayMs: 250,
      intervalMs: 5 * 60_000,
    });

    return controller.start();
  }, [
    role,
    classDeviceContext?.institutionId,
    classDeviceContext?.classId,
    classDeviceContext?.actorProfileId,
    classDeviceContext?.relayBaseUrl,
    classDeviceContext?.relayAccessToken,
  ]);

  return null;
}
