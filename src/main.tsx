import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait'
import './index.css'
import App from './App.tsx'

// 로컬 브라우저(devtools mock)에서는 mock 식별키가 서버 검증을 통과하지 못하므로,
// .env.local의 실제 키를 주입한다. DEV 전용이라 프로덕션 번들에는 포함되지 않는다.
async function boot() {
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_ANON_KEY) {
    const { aitState } = await import('@apps-in-toss/devtools')
    aitState.patch('auth', { anonymousKeyHash: import.meta.env.VITE_DEV_ANON_KEY })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TDSMobileAITProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TDSMobileAITProvider>
    </StrictMode>,
  )
}

boot()
