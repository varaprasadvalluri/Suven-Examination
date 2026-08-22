import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.suvenexam.app',
  appName: 'Suven Edu Exam Portal',
  webDir: 'dist',
  server: {
    url: 'https://www.suvenexam.com',
    androidScheme: 'https'
  }
};

export default config;
