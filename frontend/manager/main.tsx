import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ManagerApp } from './ManagerApp'
import '@fontsource/pt-sans/400.css'
import '@fontsource/pt-sans/700.css'
import '../src/app/reset.css'
import '../src/app/theme.css'

const root = document.getElementById('root')
if (!root) throw new Error('root element is missing')

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnMount: false } },
})
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <ManagerApp />
    </QueryClientProvider>
  </StrictMode>,
)
