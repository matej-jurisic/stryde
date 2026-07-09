import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.stryde.app',
  appName: 'Stryde',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
