import AsyncStorage from '@react-native-async-storage/async-storage';
import { Slot } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { I18nManager } from 'react-native';
export default function RootLayout() {
  useEffect(() => {
    const enforceRTL = async () => {
      const rtlSet = await AsyncStorage.getItem('rtl-applied');

      if (!I18nManager.isRTL && rtlSet !== 'true') {
        I18nManager.allowRTL(true);
        I18nManager.forceRTL(true);
        I18nManager.swapLeftAndRightInRTL(false);
        await AsyncStorage.setItem('rtl-applied', 'true');

        try {
          await Updates.reloadAsync(); // Reload only once
        } catch (e) {
          console.error('Failed to reload app after setting RTL', e);
        }
      }
    };

    enforceRTL();
  }, []);
  return <Slot />;
}
