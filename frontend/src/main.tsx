import { createQueryClient } from './api/queryClient'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from './app/router'
import '@fontsource/pt-sans/400.css'
import '@fontsource/pt-sans/700.css'
import '@fontsource-variable/jetbrains-mono'
import './app/reset.css'
import './app/theme.css'

const queryClient = createQueryClient()

const router = createAppRouter(queryClient)
const root = document.getElementById('root')
if (!root) {
  throw new Error('root element is missing')
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ queryClient }} />
    </QueryClientProvider>
  </StrictMode>,
)
