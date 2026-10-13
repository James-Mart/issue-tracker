import { useEffect } from "react";
import { toast } from "sonner";
import { subscribeTopic, type TopicMessage } from "@/lib/ws/transport";
import { CURSOR_SERVICE_TOPIC } from "@server/services/cursor-service-topic";

export const CURSOR_UNAVAILABLE_TOAST_ID = "cursor-unavailable";

export const CURSOR_UNAVAILABLE_MESSAGE =
  "Cursor's servers are having issues. Running agents may fail until they recover.";

function isCursorUnavailable(message: TopicMessage): boolean {
  if (message.type !== "event") return false;
  const event = message.event;
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { type?: unknown }).type === "cursor-unavailable"
  );
}

/** Toast when the server reports Cursor's backend answered `unavailable`. */
export function useCursorServiceNotices(): void {
  useEffect(() => {
    return subscribeTopic(CURSOR_SERVICE_TOPIC, (message) => {
      if (!isCursorUnavailable(message)) return;
      toast.error(CURSOR_UNAVAILABLE_MESSAGE, { id: CURSOR_UNAVAILABLE_TOAST_ID });
    });
  }, []);
}
