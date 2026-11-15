import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import 'pdfjs-dist/web/pdf_viewer.css'
import './index.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
