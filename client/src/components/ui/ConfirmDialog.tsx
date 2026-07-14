import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  loading?: boolean
}

/** Confirmation modal for destructive actions. Stays open while `loading`; the caller closes it on success. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  loading,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{message}</p>
    </Modal>
  )
}
