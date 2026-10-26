import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.notelin.android',
  appName: 'Notelin',
  webDir: 'dist-android',
  android: {
    allowMixedContent: false,
    backgroundColor: '#f4f7ff',
    initialFocus: false,
  },
  server: { androidScheme: 'https' },
};

export default config;
