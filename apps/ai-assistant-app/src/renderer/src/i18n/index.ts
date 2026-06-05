import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en'
import pl from './pl'

export const languages = [
  { code: 'en', label: 'English' },
  { code: 'pl', label: 'Polski' }
]

// Domyślny język to angielski; wybór zapamiętujemy w localStorage.
const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    pl: { translation: pl }
  },
  lng: stored || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

// changeLanguage zmienia język w locie i zapisuje wybór.
export function changeLanguage(code: string): void {
  i18n.changeLanguage(code)
  localStorage.setItem('lang', code)
}

export default i18n
