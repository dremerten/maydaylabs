"use client";
interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title, message, confirmLabel = "Confirm", onConfirm, onCancel,
}: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-cyber-surface border border-cyber-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h2 className="font-mono text-lg text-cyber-text font-bold mb-2">{title}</h2>
        <p className="font-mono text-sm text-cyber-muted mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 font-mono text-sm text-cyber-muted hover:text-cyber-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 font-mono text-sm bg-cyber-red text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
