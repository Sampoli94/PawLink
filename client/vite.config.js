// Configurazione di Vite (lo strumento che costruisce l'app). Di solito non va toccata.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
