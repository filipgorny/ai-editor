import { Dialog, DialogTitle, DialogContent, Button, Stack } from '@mui/material'

// AskUserPrompt — pytanie zadane przez agenta (skill ask_user) z wariantami odpowiedzi.
export type AskUserPrompt = { id: string; question: string; options: string[] }

// AiAskModal pokazuje pytanie agenta i warianty do wyboru. Wybór wraca jako wynik skilla,
// dzięki czemu agent kontynuuje pracę z odpowiedzią użytkownika (zamiast zgadywać).
export default function AiAskModal({
  ask,
  onChoose
}: {
  ask: AskUserPrompt | null
  onChoose: (answer: string) => void
}) {
  if (!ask) {
    return null
  }

  return (
    <Dialog open maxWidth="sm" fullWidth onClose={() => undefined}>
      <DialogTitle sx={{ whiteSpace: 'pre-wrap' }}>{ask.question}</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 1, pb: 2 }}>
          {ask.options.map((o, i) => (
            <Button
              key={i}
              variant="outlined"
              onClick={() => onChoose(o)}
              sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
            >
              {o}
            </Button>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
