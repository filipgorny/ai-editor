import { useEffect, useState } from 'react'
import { Snackbar, Alert } from '@mui/material'
import { toast, type ToastItem } from '@/toast'

// ToastHost renders the global toast stack. Mount it ONCE (in App). It subscribes to the
// `toast` module and shows one MUI Snackbar per item, stacked from the bottom-right corner.
export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => toast.subscribe(setItems), [])

  return (
    <>
      {items.map((it, i) => (
        <Snackbar
          key={it.id}
          open
          autoHideDuration={it.duration}
          onClose={(_e, reason) => {
            if (reason !== 'clickaway') {
              toast.dismiss(it.id)
            }
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          sx={{ mb: `${i * 56}px` }} // stack multiple toasts so they don't overlap
        >
          <Alert
            severity={it.severity}
            variant="filled"
            onClose={() => toast.dismiss(it.id)}
            sx={{ width: '100%' }}
          >
            {it.message}
          </Alert>
        </Snackbar>
      ))}
    </>
  )
}
