import AsyncStorage from '@react-native-async-storage/async-storage';
import { Slot } from 'expo-router';
import * as Updates from 'expo-updates';
import React, { useEffect, useState } from 'react';
import { I18nManager, Platform, View } from 'react-native';

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const enforceRTL = async () => {
      try {
        const key = 'rtl-applied';
        const wasApplied = await AsyncStorage.getItem(key);

        // If RTL not active yet and we haven't applied it before — enable it
        if (!I18nManager.isRTL && wasApplied !== 'true') {
          I18nManager.allowRTL(true);
          I18nManager.forceRTL(true);
          // Let React Native swap margin/padding 'left'/'right' automatically in RTL:
          I18nManager.swapLeftAndRightInRTL(true);

          await AsyncStorage.setItem(key, 'true');

          // A full app reload is required for forceRTL to take effect natively.
          // Avoid loops: only if Updates is enabled (standalone/EAS builds).
          if (Updates.isEnabled) {
            await Updates.reloadAsync();
            return; // app will relaunch
          }
        }

        // If we reach here, either RTL is already set or we're in a dev env without Updates
        setReady(true);
      } catch (e) {
        console.warn('RTL setup error:', e);
        // Even if something failed, continue rendering to avoid a blank screen
        setReady(true);
      }
    };

    enforceRTL();
  }, []);

  // Optional: avoid a one-frame LTR flash while we decide/apply RTL
  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: '#fff' }} />;
  }

  // Wrap the app in an RTL container too. This helps in dev/hot reloads.
  return (
    <View style={{ flex: 1, direction: 'rtl' }}>
      <Slot />
    </View>
  );
}
