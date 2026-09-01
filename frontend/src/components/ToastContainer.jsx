import Flashbar from "@cloudscape-design/components/flashbar";
import ProgressBar from "@cloudscape-design/components/progress-bar";

import { useToast } from "../context/ToastContext";

export default function ToastContainer() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  const items = toasts.map((toast) => ({
    id: toast.id,
    type: toast.type,
    header: toast.header,
    content:
      toast.progress != null ? (
        <>
          {toast.content}
          <ProgressBar value={toast.progress} variant="flash" />
        </>
      ) : (
        toast.content
      ),
    dismissible: true,
    onDismiss: () => dismissToast(toast.id),
  }));

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 5000,
        width: 400,
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <Flashbar items={items} />
    </div>
  );
}
